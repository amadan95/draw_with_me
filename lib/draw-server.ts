import { getRequestIdentity } from "@/lib/auth";
import { GeminiDrawAdapter } from "@/lib/ai/gemini-draw";
import { createNdjsonStream } from "@/lib/ai/stream";
import { loadingMessages } from "@/lib/loading-messages";
import { type DrawRequestMode, drawTurnRequestSchema, type DrawStreamEvent } from "@/lib/draw-types";
import { consumeDailyQuota } from "@/lib/quota";

function pickLoadingMessage() {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

const adapter = new GeminiDrawAdapter();

export async function handleDrawRequest(request: Request, mode: DrawRequestMode) {
  let input: ReturnType<typeof drawTurnRequestSchema.parse>;
  try {
    input = drawTurnRequestSchema.parse(await request.json());
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

  async function* streamEvents(): AsyncIterable<DrawStreamEvent> {
    if (input.thinkingEnabled !== false) {
      yield {
        type: "thinking",
        text: pickLoadingMessage()
      };
    }

    for await (const event of adapter.streamTurn({
      ...input,
      drawMode: mode
    })) {
      if (request.signal.aborted) {
        break;
      }

      if (event.type === "done") {
        yield {
          ...event,
          usage: {
            ...(event.usage ?? {}),
            used: quota.used,
            limit: quota.limit
          }
        };
        continue;
      }

      yield event;
    }
  }

  return new Response(
    createNdjsonStream({
      signal: request.signal,
      iterator: streamEvents()
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}
