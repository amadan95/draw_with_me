import { z } from "zod";
import { colorStringSchema, drawShapeSchema } from "@/lib/draw/shapes";

export type ToolMode = "draw" | "erase" | "ascii" | "comment";
export type CanvasBackground = "dots" | "grid";
export type TurnState =
  | "idle"
  | "humanDrawing"
  | "awaitingModel"
  | "modelStreaming"
  | "modelAnimating"
  | "commenting"
  | "commentReply"
  | "error";
export type InteractionStyle = "neutral" | "playful" | "collaborative";
export type CursorPhase =
  | "idle"
  | "watching"
  | "hovering"
  | "gliding"
  | "tracing"
  | "settling"
  | "speaking";

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().finite().optional()
});

export type Point = z.infer<typeof pointSchema>;

export const humanStrokeSchema = z.object({
  id: z.string(),
  createdAt: z.number().int(),
  kind: z.literal("humanStroke"),
  tool: z.union([z.literal("draw"), z.literal("erase")]),
  color: colorStringSchema,
  size: z.number().finite().min(1).max(64),
  points: z.array(pointSchema).min(1).max(2400)
});

export const persistedShapeElementSchema = z.object({
  id: z.string(),
  createdAt: z.number().int(),
  kind: z.literal("shapeElement"),
  source: z.union([z.literal("human"), z.literal("ai")]),
  turnId: z.string().optional(),
  label: z.string().max(160).optional(),
  shape: drawShapeSchema
});

export const persistedAsciiBlockSchema = z.object({
  id: z.string(),
  createdAt: z.number().int(),
  kind: z.literal("asciiBlock"),
  source: z.union([z.literal("human"), z.literal("ai")]),
  turnId: z.string().optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  color: colorStringSchema,
  text: z.string().trim().min(1).max(800),
  fontSize: z.number().finite().min(8).max(120),
  width: z.number().finite().min(0).max(2400).optional(),
  label: z.string().max(160).optional()
});

export const commentMessageSchema = z.object({
  id: z.string(),
  author: z.union([z.literal("user"), z.literal("ai")]),
  text: z.string().trim().min(1).max(600),
  createdAt: z.number().int()
});

export const commentThreadSchema = z.object({
  id: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  author: z.string().min(1).max(120),
  text: z.string().trim().min(1).max(280),
  status: z.union([z.literal("open"), z.literal("resolved")]),
  thread: z.array(commentMessageSchema).min(1).max(32)
});

export const drawTurnHistorySchema = z.object({
  id: z.string(),
  who: z.union([z.literal("human"), z.literal("ai")]),
  createdAt: z.number().int(),
  description: z.string().max(280).optional(),
  shapes: z.array(persistedShapeElementSchema).max(24).optional(),
  blocks: z.array(persistedAsciiBlockSchema).max(24).optional(),
  commentSummary: z.string().max(280).optional()
});

export const sessionUsageSchema = z.object({
  used: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional()
});

export const aiCursorPresenceSchema = z.object({
  visible: z.boolean(),
  phase: z.union([
    z.literal("idle"),
    z.literal("watching"),
    z.literal("hovering"),
    z.literal("gliding"),
    z.literal("tracing"),
    z.literal("settling"),
    z.literal("speaking")
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  color: colorStringSchema.optional(),
  label: z.string().max(80).optional()
});

export const speechDraftSchema = z.object({
  text: z.string(),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  replyToId: z.string().optional()
});

export const drawingSyncStateSchema = z.object({
  humanStrokes: z.array(humanStrokeSchema).max(400),
  drawingElements: z.array(persistedShapeElementSchema).max(400),
  asciiBlocks: z.array(persistedAsciiBlockSchema).max(200)
});

export type HumanStroke = z.infer<typeof humanStrokeSchema>;
export type PersistedShapeElement = z.infer<typeof persistedShapeElementSchema>;
export type PersistedAsciiBlock = z.infer<typeof persistedAsciiBlockSchema>;
export type CommentMessage = z.infer<typeof commentMessageSchema>;
export type CommentThread = z.infer<typeof commentThreadSchema>;
export type DrawTurnHistory = z.infer<typeof drawTurnHistorySchema>;
export type SessionUsage = z.infer<typeof sessionUsageSchema>;
export type AiCursorPresence = z.infer<typeof aiCursorPresenceSchema>;
export type SpeechDraft = z.infer<typeof speechDraftSchema>;
export type DrawingSyncState = z.infer<typeof drawingSyncStateSchema>;

export type RenderableElement =
  | HumanStroke
  | PersistedShapeElement
  | PersistedAsciiBlock;
