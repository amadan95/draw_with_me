import { z } from "zod";
import {
  commentThreadSchema,
  drawTurnHistorySchema,
  drawingSyncStateSchema,
  persistedAsciiBlockSchema,
  persistedShapeElementSchema,
  sessionUsageSchema,
  type InteractionStyle
} from "@/lib/draw/elements";
import { drawingDiffSchema } from "@/lib/draw/diff";
import { colorStringSchema, drawShapeSchema } from "@/lib/draw/shapes";
import { relationPlanSchema } from "@/lib/draw/relations";

export type DrawRequestMode = "turn" | "comment";

export const interactionStyleSchema = z.union([
  z.literal("neutral"),
  z.literal("playful"),
  z.literal("collaborative")
]);

export const rawBlockPayloadSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  color: colorStringSchema,
  text: z.string().trim().min(1).max(800),
  fontSize: z.number().finite().min(8).max(120),
  width: z.number().finite().min(0).max(2400).optional(),
  label: z.string().max(160).optional()
});

export const blockEventSchema = z.object({
  type: z.literal("block"),
  block: persistedAsciiBlockSchema
});

export const rawBlockEventSchema = z.object({
  type: z.literal("block"),
  block: rawBlockPayloadSchema
});

export const shapeEventSchema = z.object({
  type: z.literal("shape"),
  shape: persistedShapeElementSchema
});

export const relationShapeEventSchema = z.object({
  type: z.literal("relation_shape"),
  relation: relationPlanSchema
});

export const rawShapeEventSchema = z.object({
  type: z.literal("shape"),
  shape: drawShapeSchema
});

export const drawStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thinking"),
    text: z.string().max(240)
  }),
  z.object({
    type: z.literal("narration"),
    text: z.string().max(240)
  }),
  z.object({
    type: z.literal("preview_saw"),
    saw: z.string().max(240)
  }),
  z.object({
    type: z.literal("preview_drawing"),
    drawing: z.string().max(240)
  }),
  z.object({
    type: z.literal("interaction_style"),
    style: interactionStyleSchema
  }),
  z.object({
    type: z.literal("set_palette"),
    index: z.number().int().min(0).max(12)
  }),
  z.object({
    type: z.literal("say_start"),
    sayX: z.number().finite().optional(),
    sayY: z.number().finite().optional(),
    replyToId: z.string().optional()
  }),
  z.object({
    type: z.literal("say_chunk"),
    text: z.string().max(140)
  }),
  z.object({
    type: z.literal("say"),
    text: z.string().max(360),
    sayX: z.number().finite().optional(),
    sayY: z.number().finite().optional(),
    replyToId: z.string().optional()
  }),
  z.object({
    type: z.literal("dismiss"),
    threadId: z.string().optional(),
    index: z.number().int().nonnegative().optional()
  }),
  shapeEventSchema,
  blockEventSchema,
  z.object({
    type: z.literal("usage"),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative()
  }),
  z.object({
    type: z.literal("source"),
    value: z.union([
      z.literal("gemini"),
      z.literal("fallback-provider-error"),
      z.literal("fallback-parse-error")
    ])
  }),
  z.object({
    type: z.literal("done"),
    summary: z.string().max(320),
    usage: sessionUsageSchema.optional()
  }),
  z.object({
    type: z.literal("error"),
    message: z.string().max(320)
  })
]);

export type DrawStreamEvent = z.infer<typeof drawStreamEventSchema>;

export const modelPlanEventSchema = z.union([
  shapeEventSchema,
  rawShapeEventSchema,
  relationShapeEventSchema,
  blockEventSchema,
  rawBlockEventSchema,
  z.object({
    type: z.literal("say"),
    text: z.string().max(360),
    sayX: z.number().finite().optional(),
    sayY: z.number().finite().optional(),
    replyToId: z.string().optional()
  }),
  z.object({
    type: z.literal("set_palette"),
    index: z.number().int().min(0).max(12)
  }),
  z.object({
    type: z.literal("dismiss"),
    threadId: z.string().optional(),
    index: z.number().int().nonnegative().optional()
  })
]);

export const drawTurnRequestSchema = z.object({
  image: z.string().startsWith("data:image/"),
  focusImage: z.string().startsWith("data:image/").optional(),
  canvasWidth: z.number().finite().positive().max(4096),
  canvasHeight: z.number().finite().positive().max(4096),
  history: z.array(drawTurnHistorySchema).max(24).default([]),
  comments: z.array(commentThreadSchema).max(64).default([]),
  elements: drawingSyncStateSchema.optional(),
  diff: drawingDiffSchema.optional(),
  turnCount: z.number().int().nonnegative().default(0),
  drawMode: z.union([z.literal("turn"), z.literal("comment")]),
  paletteColors: z.array(z.string()).min(2).max(8),
  paletteIndex: z.number().int().min(0).max(12),
  thinkingEnabled: z.boolean().default(true),
  targetCommentId: z.string().optional(),
  providerOptions: z
    .object({
      temperature: z.number().min(0).max(1).optional(),
      maxOutputTokens: z.number().int().min(256).max(8192).optional()
    })
    .optional()
});

export type DrawTurnRequest = z.infer<typeof drawTurnRequestSchema>;

export const drawModelPlanSchema = z.object({
  interactionStyle: interactionStyleSchema.optional(),
  thinking: z.string().max(240).optional(),
  previewSaw: z.string().max(240).optional(),
  previewDrawing: z.string().max(240).optional(),
  narration: z.string().max(240).optional(),
  summary: z.string().max(320).optional(),
  setPaletteIndex: z.number().int().min(0).max(12).optional(),
  events: z.array(z.unknown()).max(32).default([])
});

export type RawModelEvent = z.infer<typeof modelPlanEventSchema>;

export type RawModelPlan = {
  interactionStyle?: InteractionStyle;
  thinking?: string;
  previewSaw?: string;
  previewDrawing?: string;
  narration?: string;
  summary?: string;
  setPaletteIndex?: number;
  events: RawModelEvent[];
};

// Backwards-compatible aliases while the relation-first migration is in progress.
export type DrawModelEvent = RawModelEvent;
export type DrawModelPlan = RawModelPlan;
