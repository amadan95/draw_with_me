export {
  aiCursorPresenceSchema,
  commentMessageSchema,
  commentThreadSchema,
  drawTurnHistorySchema,
  drawingSyncStateSchema,
  humanStrokeSchema,
  persistedAsciiBlockSchema,
  persistedShapeElementSchema,
  pointSchema,
  sessionUsageSchema,
  speechDraftSchema,
  type AiCursorPresence,
  type CanvasBackground,
  type CommentMessage,
  type CommentThread,
  type CursorPhase,
  type DrawTurnHistory,
  type DrawingSyncState,
  type HumanStroke,
  type InteractionStyle,
  type PersistedAsciiBlock,
  type PersistedShapeElement,
  type Point,
  type RenderableElement,
  type SessionUsage,
  type SpeechDraft,
  type ToolMode,
  type TurnState
} from "@/lib/draw/elements";
export {
  drawModelPlanSchema,
  drawStreamEventSchema,
  drawTurnRequestSchema,
  interactionStyleSchema,
  modelPlanEventSchema,
  type DrawModelPlan,
  type RawModelEvent,
  type RawModelPlan,
  type DrawRequestMode,
  type DrawStreamEvent,
  type DrawTurnRequest
} from "@/lib/draw/protocol";
export {
  colorStringSchema,
  drawShapeSchema,
  eraseShapeSchema,
  pointTupleSchema,
  type DrawShape,
  type PointTuple
} from "@/lib/draw/shapes";
export { drawingDiffSchema, type DrawingDiff } from "@/lib/draw/diff";
export { PAPER_COLOR, createId, getPalette, paletteSets, type Palette } from "@/lib/draw/shared";
