import {
  type DrawTurnHistory,
  type PersistedAsciiBlock,
  type PersistedShapeElement
} from "@/lib/draw/elements";
import { createId } from "@/lib/draw/shared";

export function createHumanHistoryEntry(description: string): DrawTurnHistory {
  return {
    id: createId("turn"),
    who: "human",
    createdAt: Date.now(),
    description
  };
}

export function createAiHistoryEntry(options: {
  description?: string;
  shapes?: PersistedShapeElement[];
  blocks?: PersistedAsciiBlock[];
  commentSummary?: string;
}): DrawTurnHistory {
  return {
    id: createId("turn"),
    who: "ai",
    createdAt: Date.now(),
    description: options.description,
    shapes: options.shapes?.slice(0, 24),
    blocks: options.blocks?.slice(0, 24),
    commentSummary: options.commentSummary
  };
}
