import { createId } from "@/lib/draw/shared";
import { z } from "zod";
import {
  type CommentThread,
  type InteractionStyle,
  persistedAsciiBlockSchema,
  persistedShapeElementSchema,
  type PersistedAsciiBlock,
  type PersistedShapeElement
} from "@/lib/draw/elements";
import {
  drawModelPlanSchema,
  type RawModelEvent,
  type DrawStreamEvent,
  type DrawTurnRequest,
  modelPlanEventSchema
} from "@/lib/draw/protocol";
import { inferCommentIntent, getTargetComment } from "@/lib/draw/comments";
import { drawShapeSchema, getShapeBounds, sanitizeShape } from "@/lib/draw/shapes";
import { buildDrawSystemPrompt, buildDrawUserPayload } from "@/lib/draw/prompts";
import { getActiveRegionBounds } from "@/lib/draw/rendering";
import {
  getAttachmentCandidates,
  type AttachmentCandidate
} from "@/lib/draw/scene-candidates";
import {
  realizeRelationPlan,
  relationPlanSchema,
  relationStyleSchema
} from "@/lib/draw/relations";
import { type DrawModelAdapter, type DrawModelTurnInput } from "@/lib/ai/adapter";
import { sleep, type AnimatedVisual } from "@/lib/draw/animation";
import { stripCodeFence } from "@/lib/draw/parsing";

type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  usageMetadata?: GeminiUsageMetadata;
};

class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status;
  }
}

function extractRoot(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;

  if ("plan" in record) {
    return extractRoot(record.plan);
  }
  if ("result" in record) {
    return extractRoot(record.result);
  }
  if ("response" in record) {
    return extractRoot(record.response);
  }
  if ("data" in record) {
    return extractRoot(record.data);
  }

  return value;
}

function extractFirstJsonValue(rawText: string) {
  const text = stripCodeFence(rawText).trim();
  const start = text.search(/[{[]/);
  if (start < 0) {
    return null;
  }

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) {
      depth += 1;
      continue;
    }

    if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function getGeminiConfig() {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"
  };
}

function splitDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Canvas snapshot must be a base64 image data URL.");
  }

  return {
    mimeType: match[1],
    data: match[2]
  };
}

async function callGemini(options: {
  input: DrawTurnRequest;
  systemText: string;
  userText: string;
}) {
  const gemini = getGeminiConfig();
  if (!gemini) {
    return null;
  }

  const image = splitDataUrl(options.input.image);
  const focusImage = options.input.focusImage ? splitDataUrl(options.input.focusImage) : null;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${gemini.model}:generateContent?key=${gemini.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: options.systemText }]
        },
        generationConfig: {
          temperature: options.input.providerOptions?.temperature ?? 0.34,
          responseMimeType: "application/json",
          maxOutputTokens: options.input.providerOptions?.maxOutputTokens ?? 3072
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: options.userText },
              {
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data
                }
              },
              ...(focusImage
                ? [
                    {
                      inlineData: {
                        mimeType: focusImage.mimeType,
                        data: focusImage.data
                      }
                    }
                  ]
                : [])
            ]
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new GeminiRequestError(
      response.status,
      `Gemini request failed with ${response.status}${errorText ? `: ${errorText}` : ""}`
    );
  }

  const payload = (await response.json()) as GeminiGenerateResponse;
  const text =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ??
    "";

  if (!text) {
    throw new Error("Gemini returned an empty drawing plan.");
  }

  return {
    text,
    usage: payload.usageMetadata
  };
}

function buildSpeechAnchor(targetComment: CommentThread | null, input: DrawTurnRequest) {
  if (targetComment) {
    return {
      x: targetComment.x,
      y: targetComment.y - 26
    };
  }

  return {
    x: input.canvasWidth * 0.18,
    y: input.canvasHeight * 0.16
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNormalizationRegion(input: DrawTurnRequest) {
  return getActiveRegionBounds({
    syncState: input.elements,
    targetComment: getTargetComment(input.comments, input.targetCommentId),
    fallbackBounds: {
      minX: 0,
      minY: 0,
      maxX: input.canvasWidth,
      maxY: input.canvasHeight,
      width: input.canvasWidth,
      height: input.canvasHeight
    },
    padding: 120
  });
}

function constrainShapeToRegion(shape: ReturnType<typeof sanitizeShape>, input: DrawTurnRequest) {
  const region = getNormalizationRegion(input);
  const maxWidth = Math.max(region.width * 1.35, 40);
  const maxHeight = Math.max(region.height * 1.35, 40);
  const bounds = getShapeBounds(shape);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);

  let nextShape = shape;

  if (width > maxWidth || height > maxHeight) {
    const scale = Math.min(maxWidth / width, maxHeight / height, 1);
    const centerX = bounds.minX + width * 0.5;
    const centerY = bounds.minY + height * 0.5;

    const scalePoint = (x: number, y: number) => [
      centerX + (x - centerX) * scale,
      centerY + (y - centerY) * scale
    ] as [number, number];

    switch (shape.kind) {
      case "line":
        nextShape = {
          ...shape,
          x1: scalePoint(shape.x1, shape.y1)[0],
          y1: scalePoint(shape.x1, shape.y1)[1],
          x2: scalePoint(shape.x2, shape.y2)[0],
          y2: scalePoint(shape.x2, shape.y2)[1]
        };
        break;
      case "curve":
      case "polygon":
      case "erase":
        nextShape = {
          ...shape,
          points: shape.points.map(([x, y]) => scalePoint(x, y))
        };
        break;
      case "circle":
        nextShape = {
          ...shape,
          r: shape.r * scale
        };
        break;
      case "ellipse":
        nextShape = {
          ...shape,
          rx: shape.rx * scale,
          ry: shape.ry * scale
        };
        break;
      case "rect":
        nextShape = {
          ...shape,
          x: centerX - (shape.width * scale) * 0.5,
          y: centerY - (shape.height * scale) * 0.5,
          width: shape.width * scale,
          height: shape.height * scale
        };
        break;
      case "path":
        break;
    }
  }

  const adjustedBounds = getShapeBounds(nextShape);
  const adjustedCenterX = adjustedBounds.minX + (adjustedBounds.maxX - adjustedBounds.minX) * 0.5;
  const adjustedCenterY = adjustedBounds.minY + (adjustedBounds.maxY - adjustedBounds.minY) * 0.5;
  const regionCenterX = region.minX + region.width * 0.5;
  const regionCenterY = region.minY + region.height * 0.5;

  const dx = clamp(regionCenterX - adjustedCenterX, region.minX - adjustedBounds.minX, region.maxX - adjustedBounds.maxX);
  const dy = clamp(regionCenterY - adjustedCenterY, region.minY - adjustedBounds.minY, region.maxY - adjustedBounds.maxY);

  switch (nextShape.kind) {
    case "line":
      return {
        ...nextShape,
        x1: nextShape.x1 + dx,
        y1: nextShape.y1 + dy,
        x2: nextShape.x2 + dx,
        y2: nextShape.y2 + dy
      };
    case "curve":
    case "polygon":
    case "erase":
      return {
        ...nextShape,
        points: nextShape.points.map(([x, y]) => [x + dx, y + dy] as [number, number])
      };
    case "circle":
      return {
        ...nextShape,
        cx: nextShape.cx + dx,
        cy: nextShape.cy + dy
      };
    case "ellipse":
      return {
        ...nextShape,
        cx: nextShape.cx + dx,
        cy: nextShape.cy + dy
      };
    case "rect":
      return {
        ...nextShape,
        x: nextShape.x + dx,
        y: nextShape.y + dy
      };
    default:
      return nextShape;
  }
}

type ShapeNormalizationOptions = {
  preservePlacement?: boolean;
};

function sanitizeShapeElement(
  raw: PersistedShapeElement,
  input: DrawTurnRequest,
  options: ShapeNormalizationOptions = {}
): PersistedShapeElement {
  const sanitized = sanitizeShape(raw.shape, input.canvasWidth, input.canvasHeight);
  const constrained =
    raw.source === "ai" && !options.preservePlacement
      ? constrainShapeToRegion(sanitized, input)
      : sanitized;
  return persistedShapeElementSchema.parse({
    ...raw,
    source: "ai",
    shape: constrained
  });
}

function sanitizeAsciiBlock(
  raw: PersistedAsciiBlock
): PersistedAsciiBlock {
  return persistedAsciiBlockSchema.parse({
    ...raw,
    source: "ai"
  });
}

const rawAsciiBlockSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  color: z.string().trim().min(1).max(48),
  text: z.string().trim().min(1).max(800),
  fontSize: z.number().finite().min(8).max(120),
  width: z.number().finite().min(0).max(2400).optional(),
  label: z.string().max(160).optional()
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundsOverlap(a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

function getTurnAttachmentCandidates(input: DrawTurnRequest) {
  return getAttachmentCandidates({
    syncState: input.elements,
    targetComment: getTargetComment(input.comments, input.targetCommentId),
    limit: 8
  });
}

function isShapeReasonable(shape: ReturnType<typeof sanitizeShape>, input: DrawTurnRequest) {
  const region = getNormalizationRegion(input);
  const bounds = getShapeBounds(shape);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const canvasArea = input.canvasWidth * input.canvasHeight;
  const shapeArea = width * height;

  if (shape.kind === "path") {
    return shape.d.length <= 2200;
  }

  if (shapeArea > canvasArea * 0.55) {
    return false;
  }

  if (width > input.canvasWidth * 0.92 || height > input.canvasHeight * 0.92) {
    return false;
  }

  if ((shape.kind === "curve" || shape.kind === "polygon" || shape.kind === "erase") && shape.points.length > 80) {
    return false;
  }

  const centerX = bounds.minX + width * 0.5;
  const centerY = bounds.minY + height * 0.5;
  const regionCenterX = region.minX + region.width * 0.5;
  const regionCenterY = region.minY + region.height * 0.5;
  const distance = Math.hypot(centerX - regionCenterX, centerY - regionCenterY);
  const maxDistance = Math.max(region.width, region.height) * 1.1 + 80;

  if (distance > maxDistance) {
    return false;
  }

  const attachmentCandidates = getTurnAttachmentCandidates(input);

  if (attachmentCandidates.length > 0) {
    const overlapsExisting = attachmentCandidates.some((candidate) => boundsOverlap(bounds, candidate));
    const closeToExisting = attachmentCandidates.some((candidate) => {
      const existingCenterX = candidate.minX + candidate.width * 0.5;
      const existingCenterY = candidate.minY + candidate.height * 0.5;
      return Math.hypot(centerX - existingCenterX, centerY - existingCenterY) < Math.max(region.width, region.height) * 0.55;
    });

    if (!overlapsExisting && !closeToExisting) {
      return false;
    }
  }

  return true;
}

function normalizeShapePayload(
  value: unknown,
  input: DrawTurnRequest,
  fallbackLabel?: string,
  options: ShapeNormalizationOptions = {}
): PersistedShapeElement {
  const persisted = persistedShapeElementSchema.safeParse(value);
  if (persisted.success) {
    return sanitizeShapeElement(persisted.data, input, options);
  }

  const primitive = drawShapeSchema.parse(value);
  const next = sanitizeShapeElement(
    {
      id: createId("shape"),
      createdAt: Date.now(),
      kind: "shapeElement",
      source: "ai",
      label: fallbackLabel,
      shape: primitive
    },
    input,
    options
  );

  if (!isShapeReasonable(next.shape, input)) {
    throw new Error("Rejected unreasonable AI shape.");
  }

  return next;
}

function normalizeBlockPayload(
  value: unknown,
  fallbackLabel?: string
): PersistedAsciiBlock {
  const persisted = persistedAsciiBlockSchema.safeParse(value);
  if (persisted.success) {
    return sanitizeAsciiBlock(persisted.data);
  }

  const raw = rawAsciiBlockSchema.parse(value);
  return sanitizeAsciiBlock({
    id: createId("block"),
    createdAt: Date.now(),
    kind: "asciiBlock",
    source: "ai",
    x: raw.x,
    y: raw.y,
    color: raw.color,
    text: raw.text,
    fontSize: raw.fontSize,
    width: raw.width,
    label: raw.label ?? fallbackLabel
  });
}

type NormalizedShapeEvent = {
  type: "shape";
  shape: PersistedShapeElement;
};

type NormalizedBlockEvent = {
  type: "block";
  block: PersistedAsciiBlock;
};

type NormalizedSayEvent = {
  type: "say";
  text: string;
  sayX?: number;
  sayY?: number;
  replyToId?: string;
};

type NormalizedSetPaletteEvent = {
  type: "set_palette";
  index: number;
};

type NormalizedDismissEvent = {
  type: "dismiss";
  threadId?: string;
  index?: number;
};

type RawModelPlan = {
  interactionStyle?: InteractionStyle;
  thinking?: string;
  previewSaw?: string;
  previewDrawing?: string;
  narration?: string;
  summary?: string;
  setPaletteIndex?: number;
  events: unknown[];
};

type NormalizedModelEvent =
  | NormalizedShapeEvent
  | NormalizedBlockEvent
  | NormalizedSayEvent
  | NormalizedSetPaletteEvent
  | NormalizedDismissEvent;

type NormalizedModelPlan = {
  interactionStyle?: InteractionStyle;
  thinking?: string;
  previewSaw?: string;
  previewDrawing?: string;
  narration?: string;
  summary?: string;
  setPaletteIndex?: number;
  events: NormalizedModelEvent[];
};

type OutgoingModelStreamEvent = Extract<
  DrawStreamEvent,
  | { type: "shape" }
  | { type: "block" }
  | { type: "say" }
  | { type: "set_palette" }
  | { type: "dismiss" }
>;

const normalizedSayEventSchema = z.object({
  type: z.literal("say"),
  text: z.string().max(360),
  sayX: z.number().finite().optional(),
  sayY: z.number().finite().optional(),
  replyToId: z.string().optional()
});

const normalizedSetPaletteEventSchema = z.object({
  type: z.literal("set_palette"),
  index: z.number().int().min(0).max(12)
});

const normalizedDismissEventSchema = z.object({
  type: z.literal("dismiss"),
  threadId: z.string().optional(),
  index: z.number().int().nonnegative().optional()
});

type CanonicalRelationPlan = z.infer<typeof relationPlanSchema>;

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function normalizePlacementMode(
  value: unknown
): CanonicalRelationPlan["placementMode"] | undefined {
  const normalized = readOptionalString(value)
    ?.toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");

  switch (normalized) {
    case "attach":
    case "attached":
    case "attachment":
      return "attach";
    case "inside":
    case "interior":
    case "inner":
    case "within":
      return "inside";
    case "overlap":
    case "overlapping":
      return "overlap";
    case "adjacent":
    case "outside":
    case "beside":
    case "beside-edge":
      return "adjacent";
    case "centered":
    case "centred":
    case "center":
    case "centre":
      return "centered";
    case "edge-aligned":
    case "edgealigned":
    case "aligned":
    case "aligned-edge":
      return "edge-aligned";
    default:
      return undefined;
  }
}

function normalizeAnchor(
  value: unknown,
  placementMode: CanonicalRelationPlan["placementMode"],
  candidate?: AttachmentCandidate
): CanonicalRelationPlan["anchor"] {
  const normalized = readOptionalString(value)
    ?.toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");

  if (normalized) {
    switch (normalized) {
      case "center":
      case "centre":
      case "middle":
      case "middle-center":
        return "center";
      case "interior":
      case "inside":
      case "inner":
      case "middle-inside":
        return placementMode === "inside" ? "center" : "center";
      case "top":
      case "top-edge":
      case "upper-edge":
        return "top-edge";
      case "bottom":
      case "bottom-edge":
      case "lower-edge":
        return "bottom-edge";
      case "left":
      case "left-edge":
        return "left-edge";
      case "right":
      case "right-edge":
        return "right-edge";
      case "top-left":
      case "top-left-corner":
      case "upper-left":
      case "upper-left-corner":
        return "top-left-corner";
      case "top-right":
      case "top-right-corner":
      case "upper-right":
      case "upper-right-corner":
        return "top-right-corner";
      case "bottom-left":
      case "bottom-left-corner":
      case "lower-left":
      case "lower-left-corner":
        return "bottom-left-corner";
      case "bottom-right":
      case "bottom-right-corner":
      case "lower-right":
      case "lower-right-corner":
        return "bottom-right-corner";
      case "upper-half":
      case "upperhalf":
      case "top-half":
      case "upper":
        return "upper-half";
      case "lower-half":
      case "lowerhalf":
      case "bottom-half":
      case "lower":
        return "lower-half";
    }

    if (normalized.includes("top") && normalized.includes("left")) {
      return "top-left-corner";
    }
    if (normalized.includes("top") && normalized.includes("right")) {
      return "top-right-corner";
    }
    if (normalized.includes("bottom") && normalized.includes("left")) {
      return "bottom-left-corner";
    }
    if (normalized.includes("bottom") && normalized.includes("right")) {
      return "bottom-right-corner";
    }
  }

  if (placementMode === "inside" || placementMode === "centered") {
    return "center";
  }

  if (candidate?.orientationHints.hasRoofLikePeak) {
    return "top-edge";
  }

  return candidate?.orientationHints.dominantAxis === "vertical"
    ? "right-edge"
    : "top-edge";
}

function normalizePrimitive(
  value: unknown
): CanonicalRelationPlan["primitive"] {
  const normalized = readOptionalString(value)
    ?.toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(" ", "-");

  switch (normalized) {
    case "rect":
    case "rectangle":
    case "box":
      return "rect";
    case "circle":
    case "dot":
      return "circle";
    case "ellipse":
    case "oval":
      return "ellipse";
    case "line":
    case "segment":
      return "line";
    case "curve":
    case "arc":
    case "squiggle":
      return "curve";
    case "polygon":
    case "triangle":
      return "polygon";
    default:
      return "rect";
  }
}

function normalizeSizeRatio(
  value: unknown,
  candidate?: AttachmentCandidate
) {
  const numeric = readOptionalNumber(value);
  if (typeof numeric !== "number") {
    return 0.18;
  }

  if (numeric > 1 && numeric <= 100) {
    return clamp(numeric / 100, 0.05, 0.9);
  }

  if (numeric > 1 && candidate) {
    return clamp(numeric / Math.max(Math.min(candidate.width, candidate.height), 1), 0.05, 0.9);
  }

  return clamp(numeric, 0.05, 0.9);
}

function normalizeAspectRatio(value: unknown) {
  const numeric = readOptionalNumber(value);
  return typeof numeric === "number"
    ? clamp(numeric, 0.15, 6)
    : undefined;
}

function normalizeOffsetAxis(
  value: unknown,
  axisSpan: number | undefined
) {
  const numeric = readOptionalNumber(value);
  if (typeof numeric !== "number") {
    return undefined;
  }

  if (Math.abs(numeric) <= 1) {
    return clamp(numeric, -1, 1);
  }

  if (typeof axisSpan === "number" && axisSpan > 0) {
    return clamp(numeric / Math.max(axisSpan * 0.18, 12), -1, 1);
  }

  return clamp(numeric / 20, -1, 1);
}

function normalizeOffset(
  value: unknown,
  candidate?: AttachmentCandidate
): CanonicalRelationPlan["offset"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const x = normalizeOffsetAxis(value.x, candidate?.width);
  const y = normalizeOffsetAxis(value.y, candidate?.height);

  if (typeof x !== "number" && typeof y !== "number") {
    return undefined;
  }

  return {
    x: x ?? 0,
    y: y ?? 0
  };
}

function normalizeRotationHint(value: unknown) {
  const numeric = readOptionalNumber(value);
  if (typeof numeric !== "number") {
    return undefined;
  }

  const wrapped = ((numeric + 180) % 360 + 360) % 360 - 180;
  return clamp(wrapped, -180, 180);
}

function normalizeSemanticRole(
  value: unknown
): CanonicalRelationPlan["semanticRole"] | undefined {
  const normalized = readOptionalString(value)?.toLowerCase();

  switch (normalized) {
    case "part":
    case "detail":
    case "attachment":
    case "accent":
      return normalized;
    default:
      return undefined;
  }
}

function normalizeRelationStyle(value: unknown) {
  if (!isRecord(value)) {
    return undefined;
  }

  const parsed = relationStyleSchema.safeParse({
    stroke: readOptionalString(value.stroke),
    strokeWidth: readOptionalNumber(value.strokeWidth),
    fill: readOptionalString(value.fill),
    opacity: readOptionalNumber(value.opacity)
  });

  return parsed.success ? parsed.data : undefined;
}

function coerceRelationPlan(
  value: unknown,
  input: DrawTurnRequest
): CanonicalRelationPlan {
  if (!isRecord(value)) {
    throw new Error("relation_shape relation must be an object.");
  }

  const hostCandidateId =
    readOptionalString(value.hostCandidateId) ??
    readOptionalString(value.hostId) ??
    readOptionalString(value.candidateId);

  if (!hostCandidateId) {
    throw new Error("relation_shape relation is missing hostCandidateId.");
  }

  const candidates = getTurnAttachmentCandidates(input);
  const candidate = candidates.find((item) => item.id === hostCandidateId);
  const placementMode =
    normalizePlacementMode(value.placementMode) ??
    normalizePlacementMode(value.mode) ??
    (readOptionalString(value.anchor)?.toLowerCase().includes("interior") ? "inside" : "attach");

  return relationPlanSchema.parse({
    hostCandidateId,
    placementMode,
    anchor: normalizeAnchor(value.anchor, placementMode, candidate),
    primitive: normalizePrimitive(value.primitive),
    sizeRatio: normalizeSizeRatio(value.sizeRatio, candidate),
    aspectRatio: normalizeAspectRatio(value.aspectRatio),
    offset: normalizeOffset(value.offset, candidate),
    rotationHint: normalizeRotationHint(value.rotationHint),
    style: normalizeRelationStyle(value.style),
    semanticRole: normalizeSemanticRole(value.semanticRole),
    label: readOptionalString(value.label)
  });
}

function parseRawModelEvent(event: unknown): RawModelEvent | null {
  const parsed = modelPlanEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}

function realizeNormalizedRelationShape(
  relation: z.infer<typeof relationPlanSchema>,
  input: DrawTurnRequest
): PersistedShapeElement | null {
  const realized = realizeRelationPlan({
    relation,
    candidates: getTurnAttachmentCandidates(input),
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight
  });

  if (!realized) {
    return null;
  }

  return normalizeShapePayload(realized, input, relation.label, {
    preservePlacement: true
  });
}

function normalizeModelEvent(
  event: unknown,
  input: DrawTurnRequest
): NormalizedModelEvent | null {
  const rawModelEvent = parseRawModelEvent(event);
  if (rawModelEvent) {
    switch (rawModelEvent.type) {
      case "shape": {
        const persisted = persistedShapeElementSchema.safeParse(rawModelEvent.shape);
        const shape = persisted.success
          ? sanitizeShapeElement(persisted.data, input)
          : normalizeShapePayload(rawModelEvent.shape, input);
        return {
          type: "shape",
          shape
        };
      }
      case "block": {
        const persisted = persistedAsciiBlockSchema.safeParse(rawModelEvent.block);
        const block = persisted.success
          ? sanitizeAsciiBlock(persisted.data)
          : normalizeBlockPayload(rawModelEvent.block);
        return {
          type: "block",
          block
        };
      }
      case "relation_shape": {
        const shape = realizeNormalizedRelationShape(rawModelEvent.relation, input);
        return shape
          ? {
              type: "shape",
              shape
            }
          : null;
      }
      case "say":
        return rawModelEvent;
      case "set_palette":
        return rawModelEvent;
      case "dismiss":
        return rawModelEvent;
    }
  }

  if (!isRecord(event) || typeof event.type !== "string") {
    return null;
  }

  if (event.type === "relation_shape") {
    const relation = coerceRelationPlan(event.relation ?? event, input);
    const shape = realizeNormalizedRelationShape(relation, input);
    return shape
      ? {
          type: "shape",
          shape
        }
      : null;
  }

  if (event.type === "shape") {
    const shapePayload = "shape" in event && event.shape !== undefined ? event.shape : event;
    const shape = normalizeShapePayload(
      shapePayload,
      input,
      typeof event.label === "string" ? event.label : undefined
    );
    return {
      type: "shape",
      shape
    };
  }

  if (event.type === "block") {
    const blockPayload = "block" in event && event.block !== undefined ? event.block : event;
    const block = normalizeBlockPayload(
      blockPayload,
      typeof event.label === "string" ? event.label : undefined
    );
    return {
      type: "block",
      block
    };
  }

  if (event.type === "say") {
    return normalizedSayEventSchema.parse(event);
  }

  if (event.type === "set_palette") {
    return normalizedSetPaletteEventSchema.parse(event);
  }

  if (event.type === "dismiss") {
    return normalizedDismissEventSchema.parse(event);
  }

  return null;
}

function parseRawModelPlan(parsed: unknown): RawModelPlan {
  const root = extractRoot(parsed);
  const parsedRecord = isRecord(parsed) ? parsed : null;
  const rootRecord = isRecord(root) ? root : {};

  return drawModelPlanSchema.parse({
    ...rootRecord,
    events: Array.isArray(parsedRecord?.events)
      ? parsedRecord.events
      : Array.isArray(rootRecord.events)
        ? rootRecord.events
        : []
  });
}

function normalizeModelPlan(
  rawPlan: RawModelPlan,
  input: DrawTurnRequest
): NormalizedModelPlan {
  return {
    interactionStyle: rawPlan.interactionStyle,
    thinking: rawPlan.thinking,
    previewSaw: rawPlan.previewSaw,
    previewDrawing: rawPlan.previewDrawing,
    narration: rawPlan.narration,
    summary: rawPlan.summary,
    setPaletteIndex: rawPlan.setPaletteIndex,
    events: rawPlan.events.flatMap((event) => {
      try {
        const normalized = normalizeModelEvent(event, input);
        return normalized ? [normalized] : [];
      } catch (error) {
        console.warn(
          "[draw-ai] dropping malformed model event",
          error instanceof Error ? error.message : error
        );
        return [];
      }
    })
  };
}

function parseGeminiPlanText(rawText: string): RawModelPlan {
  const normalizedText = stripCodeFence(rawText);
  const extracted = extractFirstJsonValue(rawText);
  const candidates = [
    extracted,
    normalizedText
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      return parseRawModelPlan(parsed);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to parse Gemini JSON plan.");
}

function toOutgoingModelStreamEvent(event: NormalizedModelEvent): OutgoingModelStreamEvent {
  switch (event.type) {
    case "shape":
      return {
        type: "shape",
        shape: event.shape
      };
    case "block":
      return {
        type: "block",
        block: event.block
      };
    case "say":
      return {
        type: "say",
        text: event.text,
        sayX: event.sayX,
        sayY: event.sayY,
        replyToId: event.replyToId
      };
    case "set_palette":
      return {
        type: "set_palette",
        index: event.index
      };
    case "dismiss":
      return {
        type: "dismiss",
        threadId: event.threadId,
        index: event.index
      };
  }
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildFallbackPlan(input: DrawTurnRequest): NormalizedModelPlan {
  const targetComment = getTargetComment(input.comments, input.targetCommentId);
  const commentIntent = inferCommentIntent(targetComment);
  const latestStroke =
    input.elements?.humanStrokes[input.elements.humanStrokes.length - 1] ??
    input.diff?.humanStrokes.created[input.diff.humanStrokes.created.length - 1] ??
    null;

  const anchor = targetComment
    ? { x: targetComment.x, y: targetComment.y }
    : latestStroke?.points[Math.floor(latestStroke.points.length * 0.5)] ?? {
        x: input.canvasWidth * 0.5,
        y: input.canvasHeight * 0.5
      };
  const paletteColor = input.paletteColors[Math.min(1, input.paletteColors.length - 1)] ?? input.paletteColors[0];
  const accentColor = input.paletteColors[Math.min(3, input.paletteColors.length - 1)] ?? paletteColor;
  const speechAnchor = buildSpeechAnchor(targetComment, input);
  const variantSeed = hashSeed(
    `${Math.round(anchor.x)}:${Math.round(anchor.y)}:${input.turnCount}:${commentIntent}`
  );
  const variant = variantSeed % 4;

  const events: NormalizedModelEvent[] = [];

  if (false && (commentIntent === "draw" || input.drawMode === "turn")) {
    if (variant === 0) {
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "supporting flourish",
          shape: {
            kind: "curve",
            points: [
              [anchor.x - 48, anchor.y + 12],
              [anchor.x - 12, anchor.y - 34],
              [anchor.x + 30, anchor.y - 22],
              [anchor.x + 62, anchor.y + 10]
            ],
            stroke: paletteColor,
            strokeWidth: 4,
            opacity: 0.92
          }
        }
      });
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "tiny echo circle",
          shape: {
            kind: "circle",
            cx: anchor.x + 18,
            cy: anchor.y - 18,
            r: 18,
            stroke: accentColor,
            strokeWidth: 3,
            opacity: 0.88
          }
        }
      });
    } else if (variant === 1) {
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "frame accent",
          shape: {
            kind: "rect",
            x: anchor.x - 34,
            y: anchor.y - 26,
            width: 74,
            height: 52,
            rx: 14,
            ry: 14,
            stroke: paletteColor,
            strokeWidth: 3,
            opacity: 0.9
          }
        }
      });
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "dot accent",
          shape: {
            kind: "circle",
            cx: anchor.x + 22,
            cy: anchor.y + 12,
            r: 10,
            fill: accentColor,
            stroke: accentColor,
            strokeWidth: 1,
            opacity: 0.86
          }
        }
      });
    } else if (variant === 2) {
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "spark triangle",
          shape: {
            kind: "polygon",
            points: [
              [anchor.x, anchor.y - 34],
              [anchor.x + 28, anchor.y + 18],
              [anchor.x - 28, anchor.y + 18]
            ],
            stroke: paletteColor,
            strokeWidth: 3,
            opacity: 0.9
          }
        }
      });
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "underline echo",
          shape: {
            kind: "line",
            x1: anchor.x - 30,
            y1: anchor.y + 26,
            x2: anchor.x + 34,
            y2: anchor.y + 22,
            stroke: accentColor,
            strokeWidth: 3,
            opacity: 0.84
          }
        }
      });
    } else {
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "orbit accent",
          shape: {
            kind: "ellipse",
            cx: anchor.x,
            cy: anchor.y,
            rx: 38,
            ry: 22,
            stroke: paletteColor,
            strokeWidth: 3,
            opacity: 0.9
          }
        }
      });
      events.push({
        type: "shape",
        shape: {
          id: createId("shape"),
          createdAt: Date.now(),
          kind: "shapeElement",
          source: "ai",
          label: "tail accent",
          shape: {
            kind: "curve",
            points: [
              [anchor.x + 12, anchor.y + 18],
              [anchor.x + 36, anchor.y + 34],
              [anchor.x + 54, anchor.y + 16]
            ],
            stroke: accentColor,
            strokeWidth: 3,
            opacity: 0.86
          }
        }
      });
    }
  }

  if (targetComment) {
    events.push({
      type: "say",
      text:
        commentIntent === "reply"
          ? "I can answer here without changing the drawing."
          : "I lost confidence in the draw plan, so I am keeping this response minimal.",
      sayX: speechAnchor.x,
      sayY: speechAnchor.y,
      replyToId: targetComment.id
    });
  } else {
    events.push({
      type: "say",
      text: "I was not confident enough to place a real drawing here.",
      sayX: speechAnchor.x,
      sayY: speechAnchor.y
    });
  }

  return {
    interactionStyle: "collaborative",
    thinking: "Reading the page and choosing a small next move.",
    previewSaw: targetComment ? "A local note asking for help near the sketch." : "A shared sketch with room for one more move.",
    previewDrawing:
      commentIntent === "reply" ? "Replying in place without redrawing the board." : "Adding one compact visual echo instead of a big takeover.",
    narration: "Keeping the addition small and in conversation with your marks.",
    summary: targetComment
      ? commentIntent === "reply"
        ? "Replied to the comment without drawing."
        : "Fallback reply used because the draw plan was not trustworthy."
      : "Fallback reply used because the draw plan was not trustworthy.",
    events
  };
}

async function generatePlan(input: DrawTurnRequest) {
  const payload = await callGemini({
    input,
    systemText: buildDrawSystemPrompt(input),
    userText: buildDrawUserPayload(input)
  }).catch((error) => {
    if (error instanceof Error) {
      console.warn("[draw-ai] gemini draw plan failed", error.message);
    }
    return null;
  });

  if (!payload) {
    return {
      plan: buildFallbackPlan(input),
      usage: null,
      source: "fallback-provider-error" as const
    };
  }

  try {
    return {
      plan: normalizeModelPlan(parseGeminiPlanText(payload.text), input),
      usage: payload.usage ?? null,
      source: "gemini" as const
    };
  } catch (error) {
    console.warn(
      "[draw-ai] gemini draw plan parse failed",
      error instanceof Error ? error.message : error,
      payload.text.slice(0, 800)
    );
    return {
      plan: buildFallbackPlan(input),
      usage: payload.usage ?? null,
      source: "fallback-parse-error" as const
    };
  }
}

export class GeminiDrawAdapter implements DrawModelAdapter {
  readonly name = "gemini";

  isConfigured() {
    return Boolean(getGeminiConfig());
  }

  async *streamTurn(input: DrawModelTurnInput): AsyncIterable<DrawStreamEvent> {
    const targetComment = getTargetComment(input.comments, input.targetCommentId);
    const speechAnchor = buildSpeechAnchor(targetComment, input);
    const { plan, usage, source } = await generatePlan(input);

    yield {
      type: "source",
      value: source
    };

    yield {
      type: "narration",
      text:
        source === "gemini"
          ? "Using Gemini draw plan."
          : "Using fallback because the Gemini draw plan was unusable."
    };

    if (plan.interactionStyle) {
      yield {
        type: "interaction_style",
        style: plan.interactionStyle
      };
    }
    if (plan.thinking) {
      yield {
        type: "thinking",
        text: plan.thinking
      };
    }
    if (plan.previewSaw) {
      yield {
        type: "preview_saw",
        saw: plan.previewSaw
      };
    }
    if (plan.previewDrawing) {
      yield {
        type: "preview_drawing",
        drawing: plan.previewDrawing
      };
    }
    if (plan.narration) {
      yield {
        type: "narration",
        text: plan.narration
      };
    }
    if (typeof plan.setPaletteIndex === "number") {
      yield {
        type: "set_palette",
        index: plan.setPaletteIndex
      };
      await sleep(80);
    }

    let summary = plan.summary ?? "Completed the turn.";

    for (const event of plan.events) {
      if (event.type === "say") {
        yield {
          type: "say_start",
          sayX: event.sayX ?? speechAnchor.x,
          sayY: event.sayY ?? speechAnchor.y,
          replyToId: event.replyToId
        };

        const chunks = event.text.match(/.{1,28}(\s|$)/g) ?? [event.text];
        for (const chunk of chunks) {
          yield {
            type: "say_chunk",
            text: chunk.trim()
          };
          await sleep(70);
        }

        yield toOutgoingModelStreamEvent({
          ...event,
          sayX: event.sayX ?? speechAnchor.x,
          sayY: event.sayY ?? speechAnchor.y
        });
        await sleep(60);
        continue;
      }

      yield toOutgoingModelStreamEvent(event);
      await sleep(event.type === "shape" ? 84 : event.type === "block" ? 60 : 36);
    }

    if (usage) {
      yield {
        type: "usage",
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0
      };
    }

    yield {
      type: "done",
      summary
    };
  }
}
