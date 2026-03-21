import {
  type DrawRequestMode,
  type DrawStreamEvent,
  type GeminiDrawPlan,
  type PlannedDrawEvent,
  type RenderedRecipe,
  type SceneAddition,
  aiStrokeSchema,
  asciiBlockSchema,
  commentPinSchema,
  createId,
  drawRequestSchema,
  shapeSchema,
  type SceneAnalysis
} from "@/lib/draw-types";
import { analyzeScene, generateDrawPlan } from "@/lib/ai";
import { describeRenderedAddition, renderSceneAddition } from "@/lib/sketch-renderer";
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
  rendered: RenderedRecipe[]
) {
  const descriptions = rendered.map((result) => describeRenderedAddition(result));
  if (descriptions.length === 0) {
    return `I read this as ${analysis.scene}, but no reliable addition was rendered.`;
  }

  const labelText = formatLabelList(descriptions);
  if (mode === "comment") {
    return `I read this as ${analysis.scene} and replied with ${labelText} because ${analysis.why}.`;
  }

  return `I read this as ${analysis.scene} and added ${labelText} because ${analysis.why}.`;
}

function buildCommentReplyText(
  analysis: SceneAnalysis,
  rendered: RenderedRecipe[]
) {
  const descriptions = rendered.map((result) => describeRenderedAddition(result));
  if (descriptions.length === 0) {
    return "I couldn't render a reliable addition yet.";
  }

  return `I added ${formatLabelList(descriptions)} because ${analysis.why}.`;
}

function pointDistance(a: [number, number], b: { x: number; y: number }) {
  return Math.hypot(a[0] - b.x, a[1] - b.y);
}

function getAdditionReferencePoint(
  addition: SceneAddition,
  analysis: SceneAnalysis,
  input: ReturnType<typeof drawRequestSchema.parse>
) {
  const target = addition.targetSubjectId
    ? analysis.subjects.find((subject) => subject.id === addition.targetSubjectId) ?? null
    : null;

  if (target) {
    return [
      target.bbox.x + target.bbox.width * 0.5,
      target.bbox.y + target.bbox.height * 0.5
    ] as [number, number];
  }

  if (analysis.subjects.length > 0) {
    const total = analysis.subjects.reduce(
      (sum, subject) => ({
        x: sum.x + subject.bbox.x + subject.bbox.width * 0.5,
        y: sum.y + subject.bbox.y + subject.bbox.height * 0.5
      }),
      { x: 0, y: 0 }
    );
    return [
      total.x / analysis.subjects.length,
      total.y / analysis.subjects.length
    ] as [number, number];
  }

  return [input.canvasWidth * 0.5, input.canvasHeight * 0.5] as [number, number];
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
          pointDistance(getAdditionReferencePoint(left, analysis, input), target) -
          pointDistance(getAdditionReferencePoint(right, analysis, input), target);
        if (Math.abs(distanceDelta) > 1) {
          return distanceDelta;
        }
        return left.priority - right.priority;
      })
      .slice(0, 1);
  }

  return additions.sort((left, right) => left.priority - right.priority).slice(0, 5);
}

function renderedRecipeToEvents(
  recipe: RenderedRecipe,
  input: ReturnType<typeof drawRequestSchema.parse>
) {
  const events: DrawStreamEvent[] = [];

  for (const action of recipe.actions) {
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
      label: recipe.addition.reason,
      objectId: recipe.addition.id,
      objectLabel: recipe.addition.family,
      timing: action.timing
    });

    events.push({
      type: "stroke",
      stroke
    });
  }

  return events;
}

function planHasVisualEvents(plan: GeminiDrawPlan) {
  return plan.events.some(
    (event) =>
      event.type === "stroke" ||
      event.type === "shape" ||
      event.type === "ascii_block"
  );
}

function buildPlanSummary(plan: GeminiDrawPlan) {
  if (plan.summary) {
    return plan.summary;
  }

  const visualLabels = plan.events
    .filter(
      (event): event is Extract<PlannedDrawEvent, { type: "stroke" }> =>
        event.type === "stroke"
    )
    .map((event) => event.label ?? event.objectLabel ?? "a drawing")
    .slice(0, 4);

  if (visualLabels.length > 0) {
    return `I added ${formatLabelList(visualLabels)}.`;
  }

  return plan.narration ?? "I added to the drawing.";
}

function plannedEventToStreamEvents(
  event: PlannedDrawEvent,
  input: ReturnType<typeof drawRequestSchema.parse>
): DrawStreamEvent[] {
  if (event.type === "stroke") {
    ensureColor(event.color, input.palette);
    const stroke = aiStrokeSchema.parse({
      id: createId("ai-stroke"),
      createdAt: Date.now(),
      kind: "aiStroke",
      color: event.color,
      opacity: event.opacity ?? 0.92,
      size: event.width,
      points: event.points.map(([x, y]) => {
        ensureInBounds(x, input.canvasWidth, "Point x");
        ensureInBounds(y, input.canvasHeight, "Point y");
        return { x, y };
      }),
      label: event.label,
      objectLabel: event.objectLabel,
      timing: event.timing
    });

    return [{ type: "stroke", stroke }];
  }

  if (event.type === "shape") {
    ensureColor(event.color, input.palette);
    const shape = shapeSchema.parse({
      id: createId("ai-shape"),
      createdAt: Date.now(),
      color: event.color,
      kind: "shape",
      shape: event.shape,
      x: event.x,
      y: event.y,
      width: event.width,
      height: event.height,
      rotation: event.rotation,
      fill: event.fill,
      strokeWidth: event.strokeWidth
    });

    ensureInBounds(shape.x, input.canvasWidth, "Shape x");
    ensureInBounds(shape.y, input.canvasHeight, "Shape y");

    return [{ type: "shape", shape }];
  }

  if (event.type === "ascii_block") {
    ensureColor(event.color, input.palette);
    const block = asciiBlockSchema.parse({
      id: createId("ai-ascii"),
      createdAt: Date.now(),
      color: event.color,
      kind: "asciiBlock",
      x: event.x,
      y: event.y,
      text: event.text,
      fontSize: event.fontSize,
      width: event.width
    });

    ensureInBounds(block.x, input.canvasWidth, "ASCII block x");
    ensureInBounds(block.y, input.canvasHeight, "ASCII block y");

    return [{ type: "ascii_block", block }];
  }

  if (event.type === "say") {
    return [{ type: "say", text: event.text }];
  }

  if (event.type === "set_palette") {
    return [{ type: "set_palette", index: event.index }];
  }

  if (event.type === "comment_reply" && input.targetCommentId) {
    return [
      {
        type: "comment_reply",
        commentId: input.targetCommentId,
        text: event.text
      }
    ];
  }

  return [];
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

        const plan = await generateDrawPlan(turnInput);

        if (plan?.thinking || plan?.previewSaw) {
          push({
            type: "thinking",
            text: plan.thinking ?? plan.previewSaw ?? pickLoadingMessage()
          });
        }

        if (plan?.narration || plan?.previewDrawing) {
          push({
            type: "say",
            text: plan.narration ?? plan.previewDrawing ?? ""
          });
        }

        if (plan && planHasVisualEvents(plan)) {
          let repliedInComment = false;

          for (const plannedEvent of plan.events) {
            if (request.signal.aborted) {
              break;
            }

            const events = plannedEventToStreamEvents(plannedEvent, turnInput);
            for (const event of events) {
              if (event.type === "comment_reply") {
                repliedInComment = true;
              }

              push(event);
              await sleep(
                event.type === "stroke" ? 14 : event.type === "shape" ? 26 : 20
              );
            }
          }

          if (mode === "comment" && input.targetCommentId && !repliedInComment) {
            push({
              type: "comment_reply",
              commentId: input.targetCommentId,
              text: buildPlanSummary(plan)
            });
          }

          push({
            type: "done",
            summary: buildPlanSummary(plan),
            usage: {
              used: quota.used,
              limit: quota.limit
            }
          });
          return;
        }

        const analysis = await analyzeScene(turnInput);
        const selectedAdditions = selectAdditions(analysis, turnInput);

        push({
          type: "thinking",
          text: buildSceneThinking(analysis)
        });

        const rendered: RenderedRecipe[] = [];

        for (const addition of selectedAdditions) {
          if (request.signal.aborted) {
            break;
          }

          const recipe = renderSceneAddition(analysis, addition, turnInput);
          if (!recipe) {
            continue;
          }

          rendered.push(recipe);
          const events = renderedRecipeToEvents(recipe, turnInput);

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
