import {
  type DrawRequestMode,
  type DrawStreamEvent,
  aiStrokeSchema,
  commentPinSchema,
  createId,
  drawRequestSchema,
  type ObjectProposal,
  type SceneAnalysis
} from "@/lib/draw-types";
import {
  analyzeScene,
  compileObjectDrawing,
  type CompiledObjectResult
} from "@/lib/ai";
import { getRequestIdentity } from "@/lib/auth";
import { loadingMessages } from "@/lib/loading-messages";
import { consumeDailyQuota } from "@/lib/quota";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickLoadingMessage() {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

function ensureInBounds(value: number, limit: number, label: string) {
  if (value < 0 || value > limit) {
    throw new Error(`${label} is outside the canvas bounds.`);
  }
}

function ensureColor(color: string, palette: string[]) {
  if (!palette.includes(color)) {
    throw new Error(`Color ${color} is not in the active palette.`);
  }
}

function formatLabelList(labels: string[]) {
  if (labels.length === 0) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function buildSceneThinking(analysis: SceneAnalysis) {
  return `I read this as ${analysis.scene}. ${analysis.why}`;
}

function buildRenderedSummary(
  mode: DrawRequestMode,
  analysis: SceneAnalysis,
  rendered: CompiledObjectResult[]
) {
  const labels = rendered.map((result) => result.proposal.label);
  if (labels.length === 0) {
    return `I read this as ${analysis.scene}, but no reliable addition was rendered.`;
  }

  const labelText = formatLabelList(labels);
  if (mode === "comment") {
    return `I read this as ${analysis.scene} and replied with ${labelText} because ${analysis.why}.`;
  }

  return `I read this as ${analysis.scene} and added ${labelText} because ${analysis.why}.`;
}

function buildCommentReplyText(
  analysis: SceneAnalysis,
  rendered: CompiledObjectResult[]
) {
  const labels = rendered.map((result) => result.proposal.label);
  if (labels.length === 0) {
    return "I couldn't render a reliable addition yet.";
  }

  return `I added ${formatLabelList(labels)} because ${analysis.why}.`;
}

function pointDistance(a: [number, number], b: { x: number; y: number }) {
  return Math.hypot(a[0] - b.x, a[1] - b.y);
}

function selectAdditions(
  analysis: SceneAnalysis,
  input: ReturnType<typeof drawRequestSchema.parse>
) {
  const additions = [...analysis.additions];
  if (input.mode === "comment" && input.targetCommentId) {
    const target = input.comments.find((comment) => comment.id === input.targetCommentId);
    if (!target) {
      return additions
        .sort((left, right) => left.priority - right.priority)
        .slice(0, 1);
    }

    return additions
      .sort((left, right) => {
        const distanceDelta =
          pointDistance(left.anchor, target) - pointDistance(right.anchor, target);
        if (Math.abs(distanceDelta) > 1) {
          return distanceDelta;
        }
        return left.priority - right.priority;
      })
      .slice(0, 1);
  }

  return additions.sort((left, right) => left.priority - right.priority).slice(0, 2);
}

function compiledResultToEvents(
  result: CompiledObjectResult,
  input: ReturnType<typeof drawRequestSchema.parse>
) {
  const events: DrawStreamEvent[] = [];

  for (const action of result.plan.actions) {
    ensureColor(action.color, input.palette);
    const strokePoints = action.points.map(([x, y]) => {
      ensureInBounds(x, input.canvasWidth, "Point x");
      ensureInBounds(y, input.canvasHeight, "Point y");
      return { x, y };
    });

    const stroke = aiStrokeSchema.parse({
      id: createId("ai-stroke"),
      createdAt: Date.now(),
      kind: "aiStroke",
      color: action.color,
      opacity: action.opacity,
      size: action.width,
      points: strokePoints,
      label: result.proposal.reason,
      objectId: result.proposal.id,
      objectLabel: result.proposal.label,
      timing: action.timing
    });

    events.push({
      type: "stroke",
      stroke
    });
  }

  return events;
}

export async function handleDrawRequest(
  request: Request,
  mode: DrawRequestMode
) {
  let input: ReturnType<typeof drawRequestSchema.parse>;
  try {
    input = drawRequestSchema.parse(await request.json());
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Invalid request body."
      },
      { status: 400 }
    );
  }

  const identity = await getRequestIdentity();
  if (identity.status === "unconfigured") {
    return Response.json(
      {
        error: "Clerk is not configured. Set Clerk keys before using AI turns."
      },
      { status: 503 }
    );
  }

  if (identity.status !== "authenticated" || !identity.userId) {
    return Response.json(
      {
        error: "Sign in to draw with AI."
      },
      { status: 401 }
    );
  }

  if (mode === "comment" && input.targetCommentId) {
    commentPinSchema.array().parse(input.comments);
  }

  const quota = await consumeDailyQuota(identity.userId);
  if (!quota.allowed) {
    return Response.json(
      {
        error: "Daily quota reached.",
        usage: {
          used: quota.used,
          limit: quota.limit
        }
      },
      { status: 429 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: DrawStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const turnInput = {
          ...input,
          mode
        } as const;

        push({
          type: "thinking",
          text: pickLoadingMessage()
        });

        const analysis = await analyzeScene(turnInput);
        const selectedAdditions = selectAdditions(analysis, turnInput);

        push({
          type: "thinking",
          text: buildSceneThinking(analysis)
        });

        const rendered: CompiledObjectResult[] = [];

        for (const proposal of selectedAdditions) {
          if (request.signal.aborted) {
            break;
          }

          const compiled = await compileObjectDrawing(turnInput, analysis, proposal);
          if (!compiled) {
            continue;
          }

          rendered.push(compiled);
          const events = compiledResultToEvents(compiled, turnInput);

          for (const event of events) {
            if (request.signal.aborted) {
              break;
            }

            push(event);
            await sleep(18);
          }
        }

        if (mode === "comment" && input.targetCommentId) {
          push({
            type: "comment_reply",
            commentId: input.targetCommentId,
            text: buildCommentReplyText(analysis, rendered)
          });
        }

        push({
          type: "done",
          summary: buildRenderedSummary(mode, analysis, rendered),
          usage: {
            used: quota.used,
            limit: quota.limit
          }
        });
      } catch (error) {
        push({
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to generate a draw turn."
        });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
