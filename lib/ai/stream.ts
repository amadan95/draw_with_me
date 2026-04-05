import { type DrawStreamEvent } from "@/lib/draw/protocol";

export function createNdjsonStream(source: {
  signal?: AbortSignal;
  iterator: AsyncIterable<DrawStreamEvent>;
}) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of source.iterator) {
          if (source.signal?.aborted) {
            break;
          }

          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed while streaming the draw turn."
            })}\n`
          )
        );
      } finally {
        controller.close();
      }
    }
  });
}
