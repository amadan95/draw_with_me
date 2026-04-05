import { z } from "zod";
import {
  drawingSyncStateSchema,
  humanStrokeSchema,
  persistedAsciiBlockSchema,
  persistedShapeElementSchema,
  type DrawingSyncState
} from "@/lib/draw/elements";

function diffCollection<T extends { id: string }>(
  previous: T[],
  next: T[]
) {
  const previousMap = new Map(previous.map((entry) => [entry.id, entry]));
  const nextMap = new Map(next.map((entry) => [entry.id, entry]));
  const created: T[] = [];
  const modified: T[] = [];
  const deleted: string[] = [];

  for (const entry of next) {
    const existing = previousMap.get(entry.id);
    if (!existing) {
      created.push(entry);
      continue;
    }

    if (JSON.stringify(existing) !== JSON.stringify(entry)) {
      modified.push(entry);
    }
  }

  for (const entry of previous) {
    if (!nextMap.has(entry.id)) {
      deleted.push(entry.id);
    }
  }

  return {
    created,
    modified,
    deleted
  };
}

export const drawingDiffSchema = z.object({
  humanStrokes: z.object({
    created: z.array(humanStrokeSchema),
    modified: z.array(humanStrokeSchema),
    deleted: z.array(z.string())
  }),
  drawingElements: z.object({
    created: z.array(persistedShapeElementSchema),
    modified: z.array(persistedShapeElementSchema),
    deleted: z.array(z.string())
  }),
  asciiBlocks: z.object({
    created: z.array(persistedAsciiBlockSchema),
    modified: z.array(persistedAsciiBlockSchema),
    deleted: z.array(z.string())
  })
});

export type DrawingDiff = z.infer<typeof drawingDiffSchema>;

export function computeDrawingDiff(
  previous: DrawingSyncState | null,
  next: DrawingSyncState
): DrawingDiff {
  if (!previous) {
    return {
      humanStrokes: {
        created: next.humanStrokes,
        modified: [],
        deleted: []
      },
      drawingElements: {
        created: next.drawingElements,
        modified: [],
        deleted: []
      },
      asciiBlocks: {
        created: next.asciiBlocks,
        modified: [],
        deleted: []
      }
    };
  }

  drawingSyncStateSchema.parse(previous);
  drawingSyncStateSchema.parse(next);

  return {
    humanStrokes: diffCollection(previous.humanStrokes, next.humanStrokes),
    drawingElements: diffCollection(previous.drawingElements, next.drawingElements),
    asciiBlocks: diffCollection(previous.asciiBlocks, next.asciiBlocks)
  };
}

export function diffHasChanges(diff: DrawingDiff) {
  return (
    diff.humanStrokes.created.length > 0 ||
    diff.humanStrokes.modified.length > 0 ||
    diff.humanStrokes.deleted.length > 0 ||
    diff.drawingElements.created.length > 0 ||
    diff.drawingElements.modified.length > 0 ||
    diff.drawingElements.deleted.length > 0 ||
    diff.asciiBlocks.created.length > 0 ||
    diff.asciiBlocks.modified.length > 0 ||
    diff.asciiBlocks.deleted.length > 0
  );
}
