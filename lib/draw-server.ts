import {
  type DrawRequestMode,
  type DrawStreamEvent,
  aiStrokeSchema,
  commentPinSchema,
  createId,
  drawRequestSchema
} from "@/lib/draw-types";
import { buildFallbackAssistantPlan, generateAssistantPlan } from "@/lib/ai";
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

function normalizeEvents(
  plan: Awaited<ReturnType<typeof generateAssistantPlan>>,
  input: ReturnType<typeof drawRequestSchema.parse>
) {
  const events: DrawStreamEvent[] = [];
  const knownCommentIds = new Set(input.comments.map((comment) => comment.id));

  for (const event of plan.events) {
    switch (event.type) {
      case "stroke": {
        ensureColor(event.color, input.palette);
        for (const point of event.points) {
          ensureInBounds(point.x, input.canvasWidth, "Point x");
          ensureInBounds(point.y, input.canvasHeight, "Point y");
        }

        const stroke = aiStrokeSchema.parse({
          id: createId("ai-stroke"),
          createdAt: Date.now(),
          kind: "aiStroke",
          color: event.color,
          opacity: event.opacity,
          size: event.size,
          points: event.points,
          label: event.label,
          timing: event.timing
        });

        events.push({ type: "stroke", stroke });
        break;
      }
      case "comment_reply": {
        if (!knownCommentIds.has(event.commentId)) {
          throw new Error(`Comment ${event.commentId} does not exist.`);
        }
        events.push(event);
        break;
      }
    }
  }

  return events;
}

function hasRenderableCanvasEvent(events: DrawStreamEvent[]) {
  return events.some(
    (event) =>
      event.type === "stroke" ||
      event.type === "shape" ||
      event.type === "ascii_block"
  );
}

function hasUsefulCommentEvent(events: DrawStreamEvent[]) {
  return events.some(
    (event) =>
      event.type === "comment_reply" ||
      event.type === "stroke" ||
      event.type === "shape" ||
      event.type === "ascii_block"
  );
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
        push({
          type: "thinking",
          text: pickLoadingMessage()
        });

        let plan = await generateAssistantPlan({
          ...input,
          mode
        });

        let normalizedEvents = normalizeEvents(plan, {
          ...input,
          mode
        });

        const missingUsefulOutput =
          (mode === "turn" && !hasRenderableCanvasEvent(normalizedEvents)) ||
          (mode === "comment" && !hasUsefulCommentEvent(normalizedEvents));

        if (missingUsefulOutput) {
          plan = buildFallbackAssistantPlan({
            ...input,
            mode
          });
          normalizedEvents = normalizeEvents(plan, {
            ...input,
            mode
          });
        }

        if (plan.thinking) {
          push({ type: "thinking", text: plan.thinking });
        }

        if (plan.say) {
          push({ type: "say", text: plan.say });
        }

        for (const event of normalizedEvents) {
          if (request.signal.aborted) {
            break;
          }

          push(event);
          await sleep(event.type === "stroke" ? 18 : 12);
        }

        push({
          type: "done",
          summary: plan.summary,
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
