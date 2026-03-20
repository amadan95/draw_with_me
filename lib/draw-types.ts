import { z } from "zod";

export const paletteSets = [
  ["#262523", "#0069d3", "#d66b54", "#f4a261", "#2a9d8f"],
  ["#262523", "#3a86ff", "#ff006e", "#fb5607", "#ffbe0b"],
  ["#262523", "#1d3557", "#457b9d", "#e63946", "#f1faee"],
  ["#262523", "#7f5539", "#b08968", "#ddb892", "#ede0d4"],
  ["#262523", "#5f0f40", "#9a031e", "#fb8b24", "#e36414"]
] as const;

export type Palette = (typeof paletteSets)[number];
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
  timing?: StrokeTiming;
};

export type ShapeKind = "rect" | "circle" | "line" | "arrow" | "scribble";

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
  shape: z.enum(["rect", "circle", "line", "arrow", "scribble"]),
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

const plannerHumanStrokeContextSchema = z.object({
  kind: z.literal("humanStroke"),
  tool: z.union([z.literal("draw"), z.literal("erase")]),
  color: z.string(),
  size: z.number().positive(),
  points: z.array(plannerPointTupleSchema).min(1).max(24)
});

const plannerAsciiContextSchema = z.object({
  kind: z.literal("asciiBlock"),
  color: z.string(),
  fontSize: z.number().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  text: z.string().max(80)
});

const plannerShapeContextSchema = z.object({
  kind: z.literal("shape"),
  shape: z.enum(["rect", "circle", "line", "arrow", "scribble"]),
  color: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  strokeWidth: z.number().finite()
});

const plannerAiStrokeContextSchema = z.object({
  color: z.string(),
  width: z.number().positive(),
  opacity: z.number().min(0.05).max(1),
  points: z.array(plannerPointTupleSchema).min(1).max(24)
});

export const drawRequestSchema = z.object({
  snapshotBase64: z.string().startsWith("data:image/"),
  canvasWidth: z.number().positive(),
  canvasHeight: z.number().positive(),
  palette: z.array(z.string()).min(2).max(8),
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
