import { z } from "zod";

export const paletteSets = [
  ["#262523", "#0069d3", "#d66b54", "#f4a261", "#2a9d8f"],
  ["#262523", "#3a86ff", "#ff006e", "#fb5607", "#ffbe0b"],
  ["#262523", "#1d3557", "#457b9d", "#e63946", "#f1faee"],
  ["#262523", "#7f5539", "#b08968", "#ddb892", "#ede0d4"],
  ["#262523", "#5f0f40", "#9a031e", "#fb8b24", "#e36414"]
] as const;

export const semanticGridColumns = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L"
] as const;

export const semanticGridRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export type Palette = (typeof paletteSets)[number];
export type SemanticGridColumn = (typeof semanticGridColumns)[number];
export type SemanticGridRow = (typeof semanticGridRows)[number];
export type SemanticGridCell = [SemanticGridColumn, SemanticGridRow];
export type ToolMode = "draw" | "erase" | "ascii" | "comment";
export type CanvasBackground = "dots" | "grid";
export type TurnState =
  | "idle"
  | "humanDrawing"
  | "commenting"
  | "awaitingModel"
  | "modelStreaming"
  | "modelAnimating";

export type Point = {
  x: number;
  y: number;
  pressure?: number;
};

export type DrawingBase = {
  id: string;
  createdAt: number;
  color: string;
  opacity?: number;
};

export type StrokeTiming = {
  speed?: number;
  pauseAfterMs?: number;
};

export type ObjectBoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SvgViewBox = {
  width: number;
  height: number;
};

export type ObjectFamily = string;
export type OrientationHint =
  | "horizontal"
  | "vertical"
  | "diagonal_left"
  | "diagonal_right"
  | "arched"
  | "floating"
  | "upright";

export type SizeHint = "small" | "medium" | "large";

export type SceneSubject = {
  id: string;
  family: ObjectFamily;
  label: string;
  occupiedGridCells: SemanticGridCell[];
  bbox: ObjectBoundingBox;
};

export type SceneAddition = {
  id: string;
  family: ObjectFamily;
  gridCells: SemanticGridCell[];
  targetSubjectId?: string;
  sizeHint?: SizeHint;
  orientationHint?: OrientationHint;
  reason: string;
  priority: number;
};

export type SceneAnalysis = {
  scene: string;
  why: string;
  subjects: SceneSubject[];
  additions: SceneAddition[];
};

export type CompiledObjectAction = {
  tool: "brush";
  color: string;
  width: number;
  opacity: number;
  points: [number, number][];
  timing?: StrokeTiming;
};

export type RenderedRecipe = {
  addition: SceneAddition;
  targetSubject?: SceneSubject | null;
  actions: CompiledObjectAction[];
};

export type PlannedStrokeEvent = {
  type: "stroke";
  color: string;
  width: number;
  opacity?: number;
  svgPath: string;
  gridCells: SemanticGridCell[];
  viewBox?: SvgViewBox;
  timing?: StrokeTiming;
  label?: string;
  objectLabel?: string;
};

export type PlannedShapeEvent = {
  type: "shape";
  shape: ShapeKind;
  color: string;
  gridCells: SemanticGridCell[];
  rotation?: number;
  fill?: string;
  strokeWidth?: number;
};

export type PlannedAsciiBlockEvent = {
  type: "ascii_block";
  color: string;
  gridCells: SemanticGridCell[];
  text: string;
  fontSize: number;
};

export type PlannedSayEvent = {
  type: "say";
  text: string;
};

export type PlannedSetPaletteEvent = {
  type: "set_palette";
  index: number;
};

export type PlannedCommentReplyEvent = {
  type: "comment_reply";
  text: string;
};

export type PlannedDrawEvent =
  | PlannedStrokeEvent
  | PlannedShapeEvent
  | PlannedAsciiBlockEvent
  | PlannedSayEvent
  | PlannedSetPaletteEvent
  | PlannedCommentReplyEvent;

export type GeminiDrawPlan = {
  thinking?: string;
  narration?: string;
  summary?: string;
  previewSaw?: string;
  previewDrawing?: string;
  events: PlannedDrawEvent[];
};

export type HumanStroke = DrawingBase & {
  kind: "humanStroke";
  tool: "draw" | "erase";
  size: number;
  points: Point[];
};

export type AiStroke = DrawingBase & {
  kind: "aiStroke";
  size: number;
  points: Point[];
  label?: string;
  objectId?: string;
  objectLabel?: string;
  timing?: StrokeTiming;
};

export type ShapeKind =
  | "rect"
  | "circle"
  | "line"
  | "arrow"
  | "scribble"
  | "triangle"
  | "trapezoid";

export type ShapeElement = DrawingBase & {
  kind: "shape";
  shape: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  fill?: string;
  strokeWidth?: number;
};

export type AsciiBlock = DrawingBase & {
  kind: "asciiBlock";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  width?: number;
};

export type DrawingElement = HumanStroke | AiStroke | ShapeElement | AsciiBlock;

export type CommentMessage = {
  id: string;
  author: "user" | "ai";
  text: string;
  createdAt: number;
};

export type CommentPin = {
  id: string;
  x: number;
  y: number;
  author: string;
  text: string;
  status: "open" | "resolved";
  thread: CommentMessage[];
};

export type TurnSummary = {
  id: string;
  role: "user" | "ai";
  summary: string;
  createdAt: number;
};

export type DrawRequestMode = "turn" | "comment";

export type DrawStreamEvent =
  | {
      type: "thinking";
      text: string;
    }
  | {
      type: "say";
      text: string;
    }
  | {
      type: "stroke";
      stroke: AiStroke;
    }
  | {
      type: "shape";
      shape: ShapeElement;
    }
  | {
      type: "ascii_block";
      block: AsciiBlock;
    }
  | {
      type: "comment_reply";
      commentId: string;
      text: string;
    }
  | {
      type: "set_palette";
      index: number;
    }
  | {
      type: "done";
      summary: string;
      usage?: {
        used: number;
        limit: number;
      };
    }
  | {
      type: "error";
      message: string;
    };

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  pressure: z.number().finite().optional()
});

export const semanticGridColumnSchema = z.enum(semanticGridColumns);
export const semanticGridRowSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
  z.literal(9),
  z.literal(10),
  z.literal(11),
  z.literal(12)
]);
export const semanticGridCellSchema = z.tuple([
  semanticGridColumnSchema,
  semanticGridRowSchema
]);
export const semanticGridCellsSchema = z.array(semanticGridCellSchema).min(1).max(16);
export const objectFamilySchema = z.string().min(1).max(80);
export const orientationHintSchema = z.enum([
  "horizontal",
  "vertical",
  "diagonal_left",
  "diagonal_right",
  "arched",
  "floating",
  "upright"
]);
export const sizeHintSchema = z.enum(["small", "medium", "large"]);

export const objectBoundingBoxSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive()
});

export const svgViewBoxSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive()
});

export const sceneSubjectSchema = z.object({
  id: z.string(),
  family: objectFamilySchema,
  label: z.string().min(1).max(80),
  occupiedGridCells: z.array(semanticGridCellSchema).min(1).max(48),
  bbox: objectBoundingBoxSchema
});

export const sceneAdditionSchema = z.object({
  id: z.string(),
  family: objectFamilySchema,
  gridCells: semanticGridCellsSchema,
  targetSubjectId: z.string().optional(),
  sizeHint: sizeHintSchema.optional(),
  orientationHint: orientationHintSchema.optional(),
  reason: z.string().min(1).max(160),
  priority: z.number().int().min(1).max(9)
});

export const sceneAnalysisSchema = z.object({
  scene: z.string().min(1).max(160),
  why: z.string().min(1).max(200),
  subjects: z.array(sceneSubjectSchema).max(12),
  additions: z.array(sceneAdditionSchema).max(5)
});

export const compiledObjectActionSchema = z.object({
  tool: z.literal("brush"),
  color: z.string(),
  width: z.number().positive().max(24),
  opacity: z.number().min(0.05).max(1),
  points: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(320),
  timing: z
    .object({
      speed: z.number().min(0.2).max(3).optional(),
      pauseAfterMs: z.number().int().min(0).max(1200).optional()
    })
    .optional()
});

export const plannedStrokeEventSchema = z.object({
  type: z.literal("stroke"),
  color: z.string(),
  width: z.number().positive().max(24),
  opacity: z.number().min(0.05).max(1).optional(),
  svgPath: z.string().min(1).max(4000),
  gridCells: semanticGridCellsSchema,
  viewBox: svgViewBoxSchema.optional(),
  timing: z
    .object({
      speed: z.number().min(0.2).max(3).optional(),
      pauseAfterMs: z.number().int().min(0).max(1200).optional()
    })
    .optional(),
  label: z.string().max(120).optional(),
  objectLabel: z.string().max(80).optional()
});

export const plannedShapeEventSchema = z.object({
  type: z.literal("shape"),
  shape: z.enum(["rect", "circle", "line", "arrow", "scribble", "triangle", "trapezoid"]),
  color: z.string(),
  gridCells: semanticGridCellsSchema,
  rotation: z.number().finite().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().positive().max(24).optional()
});

export const plannedAsciiBlockEventSchema = z.object({
  type: z.literal("ascii_block"),
  color: z.string(),
  gridCells: semanticGridCellsSchema,
  text: z.string().min(1).max(240),
  fontSize: z.number().positive().max(96)
});

export const plannedSayEventSchema = z.object({
  type: z.literal("say"),
  text: z.string().min(1).max(240)
});

export const plannedSetPaletteEventSchema = z.object({
  type: z.literal("set_palette"),
  index: z.number().int().min(0).max(7)
});

export const plannedCommentReplyEventSchema = z.object({
  type: z.literal("comment_reply"),
  text: z.string().min(1).max(240)
});

export const plannedDrawEventSchema = z.union([
  plannedStrokeEventSchema,
  plannedShapeEventSchema,
  plannedAsciiBlockEventSchema,
  plannedSayEventSchema,
  plannedSetPaletteEventSchema,
  plannedCommentReplyEventSchema
]);

export const geminiDrawPlanSchema = z.object({
  thinking: z.string().max(240).optional(),
  narration: z.string().max(240).optional(),
  summary: z.string().max(240).optional(),
  previewSaw: z.string().max(240).optional(),
  previewDrawing: z.string().max(240).optional(),
  events: z.array(plannedDrawEventSchema).max(32)
});

export const humanStrokeSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  color: z.string(),
  kind: z.literal("humanStroke"),
  tool: z.union([z.literal("draw"), z.literal("erase")]),
  size: z.number().positive(),
  points: z.array(pointSchema).min(1)
});

export const aiStrokeSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  color: z.string(),
  opacity: z.number().min(0.05).max(1).optional(),
  kind: z.literal("aiStroke"),
  size: z.number().positive(),
  points: z.array(pointSchema).min(2),
  label: z.string().optional(),
  objectId: z.string().optional(),
  objectLabel: z.string().optional(),
  timing: z
    .object({
      speed: z.number().min(0.2).max(3).optional(),
      pauseAfterMs: z.number().int().min(0).max(1200).optional()
    })
    .optional()
});

export const shapeSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  color: z.string(),
  kind: z.literal("shape"),
  shape: z.enum(["rect", "circle", "line", "arrow", "scribble", "triangle", "trapezoid"]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  rotation: z.number().finite().optional(),
  fill: z.string().optional(),
  strokeWidth: z.number().finite().optional()
});

export const asciiBlockSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  color: z.string(),
  kind: z.literal("asciiBlock"),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string(),
  fontSize: z.number().positive(),
  width: z.number().finite().optional()
});

export const commentMessageSchema = z.object({
  id: z.string(),
  author: z.union([z.literal("user"), z.literal("ai")]),
  text: z.string(),
  createdAt: z.number()
});

export const commentPinSchema = z.object({
  id: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  author: z.string(),
  text: z.string(),
  status: z.union([z.literal("open"), z.literal("resolved")]),
  thread: z.array(commentMessageSchema)
});

export const turnSummarySchema = z.object({
  id: z.string(),
  role: z.union([z.literal("user"), z.literal("ai")]),
  summary: z.string(),
  createdAt: z.number()
});

const plannerPointTupleSchema = z.tuple([z.number().finite(), z.number().finite()]);

export const plannerHumanStrokeContextSchema = z.object({
  kind: z.literal("humanStroke"),
  tool: z.union([z.literal("draw"), z.literal("erase")]),
  color: z.string(),
  size: z.number().positive(),
  points: z.array(plannerPointTupleSchema).min(1).max(24)
});

export const plannerAsciiContextSchema = z.object({
  kind: z.literal("asciiBlock"),
  color: z.string(),
  fontSize: z.number().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string().max(80)
});

export const plannerShapeContextSchema = z.object({
  kind: z.literal("shape"),
  shape: z.enum(["rect", "circle", "line", "arrow", "scribble", "triangle", "trapezoid"]),
  color: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  strokeWidth: z.number().finite()
});

export const plannerAiStrokeContextSchema = z.object({
  color: z.string(),
  width: z.number().positive(),
  opacity: z.number().min(0.05).max(1),
  points: z.array(plannerPointTupleSchema).min(1).max(24)
});

export type PlannerHumanStrokeContext = z.infer<typeof plannerHumanStrokeContextSchema>;
export type PlannerAsciiContext = z.infer<typeof plannerAsciiContextSchema>;
export type PlannerShapeContext = z.infer<typeof plannerShapeContextSchema>;
export type PlannerHumanContext =
  | PlannerHumanStrokeContext
  | PlannerAsciiContext
  | PlannerShapeContext;
export type PlannerAiContext = z.infer<typeof plannerAiStrokeContextSchema>;

export const drawRequestSchema = z.object({
  snapshotBase64: z.string().startsWith("data:image/"),
  canvasWidth: z.number().positive(),
  canvasHeight: z.number().positive(),
  activeStrokeSize: z.number().positive().max(24),
  palette: z.array(z.string()).min(2).max(8),
  aiTemperature: z.number().min(0).max(1).optional(),
  aiMaxOutputTokens: z.number().int().min(512).max(8192).optional(),
  humanDelta: z.array(
    z.union([
      plannerHumanStrokeContextSchema,
      plannerAsciiContextSchema,
      plannerShapeContextSchema
    ])
  ),
  aiDelta: z.array(plannerAiStrokeContextSchema).optional().default([]),
  comments: z.array(commentPinSchema),
  turnHistory: z.array(turnSummarySchema),
  mode: z.union([z.literal("turn"), z.literal("comment")]),
  targetCommentId: z.string().optional()
});

export function getPalette(index: number): Palette {
  return paletteSets[index % paletteSets.length];
}

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
