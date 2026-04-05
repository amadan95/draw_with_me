import { drawStreamEventSchema, type DrawStreamEvent } from "@/lib/draw/protocol";
import {
  type PersistedAsciiBlock,
  type PersistedShapeElement
} from "@/lib/draw/elements";

export async function parseNdjsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: DrawStreamEvent) => Promise<void> | void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      await onEvent(drawStreamEventSchema.parse(JSON.parse(trimmed)));
    }
  }

  if (buffer.trim()) {
    await onEvent(drawStreamEventSchema.parse(JSON.parse(buffer)));
  }
}

function translateShapeElement(
  shape: PersistedShapeElement,
  originX: number,
  originY: number
): PersistedShapeElement {
  const translatedShape = (() => {
    switch (shape.shape.kind) {
      case "path":
        return shape.shape;
      case "line":
        return {
          ...shape.shape,
          x1: shape.shape.x1 + originX,
          y1: shape.shape.y1 + originY,
          x2: shape.shape.x2 + originX,
          y2: shape.shape.y2 + originY
        };
      case "curve":
      case "polygon":
      case "erase":
        return {
          ...shape.shape,
          points: shape.shape.points.map(([x, y]) => [x + originX, y + originY] as [number, number])
        };
      case "circle":
        return {
          ...shape.shape,
          cx: shape.shape.cx + originX,
          cy: shape.shape.cy + originY
        };
      case "ellipse":
        return {
          ...shape.shape,
          cx: shape.shape.cx + originX,
          cy: shape.shape.cy + originY
        };
      case "rect":
        return {
          ...shape.shape,
          x: shape.shape.x + originX,
          y: shape.shape.y + originY
        };
    }
  })();

  return {
    ...shape,
    shape: translatedShape
  };
}

function translateAsciiBlock(
  block: PersistedAsciiBlock,
  originX: number,
  originY: number
): PersistedAsciiBlock {
  return {
    ...block,
    x: block.x + originX,
    y: block.y + originY
  };
}

export function translateStreamEvent(
  event: DrawStreamEvent,
  originX: number,
  originY: number
): DrawStreamEvent {
  switch (event.type) {
    case "shape":
      return {
        ...event,
        shape: translateShapeElement(event.shape, originX, originY)
      };
    case "block":
      return {
        ...event,
        block: translateAsciiBlock(event.block, originX, originY)
      };
    case "say":
      return {
        ...event,
        sayX: typeof event.sayX === "number" ? event.sayX + originX : event.sayX,
        sayY: typeof event.sayY === "number" ? event.sayY + originY : event.sayY
      };
    case "say_start":
      return {
        ...event,
        sayX: typeof event.sayX === "number" ? event.sayX + originX : event.sayX,
        sayY: typeof event.sayY === "number" ? event.sayY + originY : event.sayY
      };
    default:
      return event;
  }
}

export function stripCodeFence(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
