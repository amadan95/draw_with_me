import { z } from "zod";
import {
  createId,
  drawRequestSchema,
  geminiDrawPlanSchema,
  objectBoundingBoxSchema,
  objectFamilySchema,
  orientationHintSchema,
  placementRelationSchema,
  placementHintSchema,
  plannedDrawEventSchema,
  scaleHintSchema,
  sceneAdditionSchema,
  sceneAnalysisSchema,
  sceneSubjectSchema,
  type ObjectBoundingBox,
  type ObjectFamily,
  type GeminiDrawPlan,
  type OrientationHint,
  type PlacementRelation,
  type PlacementHint,
  type PlannedDrawEvent,
  type ScaleHint,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject
} from "@/lib/draw-types";

type DrawRequest = z.infer<typeof drawRequestSchema>;
type JsonObject = Record<string, unknown>;

const relationValues = placementRelationSchema.options;

class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status;
  }
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

function stripCodeFence(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getRequestedTemperature(input: DrawRequest, fallback: number) {
  return clamp(
    typeof input.aiTemperature === "number" ? input.aiTemperature : fallback,
    0,
    1
  );
}

function getRequestedMaxOutputTokens(
  input: DrawRequest,
  fallback: number,
  ceiling = 8192
) {
  return Math.round(
    clamp(
      typeof input.aiMaxOutputTokens === "number"
        ? input.aiMaxOutputTokens
        : fallback,
      512,
      ceiling
    )
  );
}

function clampFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRoot(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }

  if ("analysis" in value) {
    return extractRoot(value.analysis);
  }

  if ("result" in value) {
    return extractRoot(value.result);
  }

  if ("response" in value) {
    return extractRoot(value.response);
  }

  if ("data" in value) {
    return extractRoot(value.data);
  }

  if ("plan" in value) {
    return extractRoot(value.plan);
  }

  if ("turn" in value) {
    return extractRoot(value.turn);
  }

  return value;
}

function extractJsonStringField(rawText: string, field: string) {
  const match = rawText.match(
    new RegExp(`"${field}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`)
  );
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const value = JSON.parse(match[1]);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeFamily(
  value: unknown,
  fallbackText = "",
  mode: "subject" | "addition" = "addition"
): ObjectFamily | null {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized) {
    return objectFamilySchema.parse(normalized.slice(0, 80));
  }

  const fallback = fallbackText.trim().toLowerCase().replace(/\s+/g, " ");
  if (fallback) {
    return objectFamilySchema.parse(fallback.slice(0, 80));
  }

  if (mode === "addition") {
    return "detail";
  }

  return null;
}

function extractHumanBounds(input: DrawRequest) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const pushPoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const item of input.humanDelta) {
    if (item.kind === "humanStroke") {
      if (item.tool === "erase") {
        continue;
      }
      for (const [x, y] of item.points) {
        pushPoint(x, y);
      }
      continue;
    }

    if (item.kind === "asciiBlock") {
      pushPoint(item.x, item.y);
      continue;
    }

    pushPoint(item.x - item.width * 0.5, item.y - item.height * 0.5);
    pushPoint(item.x + item.width * 0.5, item.y + item.height * 0.5);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    const width = input.canvasWidth * 0.42;
    const height = input.canvasHeight * 0.34;
    return {
      minX: input.canvasWidth * 0.5 - width * 0.5,
      minY: input.canvasHeight * 0.5 - height * 0.55,
      maxX: input.canvasWidth * 0.5 + width * 0.5,
      maxY: input.canvasHeight * 0.5 + height * 0.45,
      width,
      height
    };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function normalizeBoundingBox(
  value: unknown,
  input: DrawRequest,
  fallback: ObjectBoundingBox
): ObjectBoundingBox {
  if (!isJsonObject(value)) {
    return objectBoundingBoxSchema.parse(fallback);
  }

  const width = clamp(clampFiniteNumber(value.width, fallback.width), 20, input.canvasWidth * 0.9);
  const height = clamp(clampFiniteNumber(value.height, fallback.height), 20, input.canvasHeight * 0.9);
  const x = clamp(clampFiniteNumber(value.x, fallback.x), 0, Math.max(0, input.canvasWidth - width));
  const y = clamp(clampFiniteNumber(value.y, fallback.y), 0, Math.max(0, input.canvasHeight - height));

  return objectBoundingBoxSchema.parse({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  });
}

function preferredTargetFamilies(family: ObjectFamily): ObjectFamily[] {
  if (includesAny(family, ["chimney", "flue", "stack"])) {
    return ["house"];
  }
  if (includesAny(family, ["path", "walkway", "trail", "road", "sidewalk"])) {
    return ["house"];
  }
  if (includesAny(family, ["smoke", "steam", "plume"])) {
    return ["chimney", "house"];
  }
  if (includesAny(family, ["flag", "shutter", "porch light", "window box", "antenna"])) {
    return ["house"];
  }
  if (includesAny(family, ["grass", "bush", "flower", "fence", "hedge", "shrub"])) {
    return ["house", "tree", "hill"];
  }
  if (includesAny(family, ["mailbox", "bench", "lamp", "garden", "pond", "vehicle"])) {
    return ["house", "tree", "hill"];
  }
  if (includesAny(family, ["tree"])) {
    return ["house", "hill"];
  }
  if (includesAny(family, ["animal", "cat", "dog", "birdhouse"])) {
    return ["house", "tree"];
  }
  if (includesAny(family, ["tool", "shovel", "watering can", "rake"])) {
    return ["house", "garden", "tree"];
  }

  return [];
}

function matchesSubjectFamily(subject: SceneSubject, preferred: string) {
  return (
    includesAny(subject.family, [preferred]) ||
    includesAny(subject.label, [preferred]) ||
    includesAny(preferred, [subject.family])
  );
}

function inferRelation(
  family: ObjectFamily,
  raw: unknown,
  target: SceneSubject | null
): PlacementRelation {
  if (typeof raw === "string" && relationValues.includes(raw as PlacementRelation)) {
    return raw as PlacementRelation;
  }

  if (includesAny(family, ["chimney", "antenna", "flag", "satellite"])) {
    return "attach_roof_right";
  }
  if (includesAny(family, ["porch light", "shutter", "window box"])) {
    return "around_subject";
  }
  if (includesAny(family, ["smoke", "cloud", "bird", "kite"])) {
    return target ? "sky_above" : "sky_above_right";
  }
  if (includesAny(family, ["sun", "balloon"])) {
    return "sky_above_right";
  }
  if (includesAny(family, ["moon", "star"])) {
    return "sky_above_left";
  }
  if (includesAny(family, ["grass", "fence", "path", "water", "hill", "pond", "river"])) {
    return "ground_front";
  }
  if (includesAny(family, ["bush", "flower", "shrub", "hedge", "garden"])) {
    return target ? "ground_right" : "ground_front";
  }
  if (includesAny(family, ["tree", "house", "mailbox", "bench", "lamp", "sign"])) {
    return "beside_right";
  }

  return "around_subject";
}

function normalizePlacementHint(value: unknown): PlacementHint | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const normalized: PlacementHint = {
    xRatio:
      typeof value.xRatio === "number" && Number.isFinite(value.xRatio)
        ? clamp(value.xRatio, 0, 1)
        : undefined,
    yRatio:
      typeof value.yRatio === "number" && Number.isFinite(value.yRatio)
        ? clamp(value.yRatio, 0, 1)
        : undefined,
    biasX:
      typeof value.biasX === "number" && Number.isFinite(value.biasX)
        ? clamp(value.biasX, -1, 1)
        : undefined,
    biasY:
      typeof value.biasY === "number" && Number.isFinite(value.biasY)
        ? clamp(value.biasY, -1, 1)
        : undefined
  };

  if (
    normalized.xRatio === undefined &&
    normalized.yRatio === undefined &&
    normalized.biasX === undefined &&
    normalized.biasY === undefined
  ) {
    return undefined;
  }

  return placementHintSchema.parse(normalized);
}

function normalizeScaleHint(value: unknown): ScaleHint | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const normalized: ScaleHint = {
    widthRatio:
      typeof value.widthRatio === "number" && Number.isFinite(value.widthRatio)
        ? clamp(value.widthRatio, 0.05, 1.25)
        : undefined,
    heightRatio:
      typeof value.heightRatio === "number" && Number.isFinite(value.heightRatio)
        ? clamp(value.heightRatio, 0.05, 1.25)
        : undefined
  };

  if (normalized.widthRatio === undefined && normalized.heightRatio === undefined) {
    return undefined;
  }

  return scaleHintSchema.parse(normalized);
}

function normalizeOrientationHint(value: unknown): OrientationHint | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  const allowed = orientationHintSchema.options;
  return allowed.includes(normalized as OrientationHint)
    ? orientationHintSchema.parse(normalized)
    : undefined;
}

function normalizeSubject(
  value: unknown,
  input: DrawRequest,
  index: number
): SceneSubject | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const family = normalizeFamily(
    value.family ?? value.label ?? value.type ?? value.name,
    `${value.label ?? ""}`,
    "subject"
  );
  if (!family) {
    return null;
  }

  const humanBounds = extractHumanBounds(input);
  const fallbackWidth = clamp(humanBounds.width * 0.36, 60, input.canvasWidth * 0.5);
  const fallbackHeight = clamp(humanBounds.height * 0.34, 60, input.canvasHeight * 0.5);
  const fallbackX = clamp(
    humanBounds.minX + humanBounds.width * 0.5 - fallbackWidth * 0.5,
    0,
    Math.max(0, input.canvasWidth - fallbackWidth)
  );
  const fallbackY = clamp(
    humanBounds.minY + humanBounds.height * 0.5 - fallbackHeight * 0.5,
    0,
    Math.max(0, input.canvasHeight - fallbackHeight)
  );

  return sceneSubjectSchema.parse({
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim().slice(0, 64)
        : createId(`subject-${index + 1}`),
    family,
    label:
      typeof value.label === "string" && value.label.trim()
        ? value.label.trim().slice(0, 80)
        : family,
    bbox: normalizeBoundingBox(value.bbox, input, {
      x: fallbackX,
      y: fallbackY,
      width: fallbackWidth,
      height: fallbackHeight
    })
  });
}

function normalizeAddition(
  value: unknown,
  subjects: SceneSubject[],
  index: number
): SceneAddition | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const family = normalizeFamily(
    value.family ?? value.label ?? value.type ?? value.name,
    `${value.reason ?? ""}`,
    "addition"
  );
  if (!family) {
    return null;
  }

  let targetSubject =
    typeof value.targetSubjectId === "string"
      ? subjects.find((subject) => subject.id === value.targetSubjectId) ?? null
      : null;

  if (!targetSubject) {
    const preferred = preferredTargetFamilies(family);
    for (const preferredFamily of preferred) {
      const match = subjects.find((subject) => matchesSubjectFamily(subject, preferredFamily));
      if (match) {
        targetSubject = match;
        break;
      }
    }
  }

  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 160)
      : `adds ${family} to the scene`;

  return sceneAdditionSchema.parse({
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim().slice(0, 64)
        : createId(`addition-${index + 1}`),
    family,
    targetSubjectId: targetSubject?.id,
    relation: inferRelation(family, value.relation, targetSubject),
    placementHint: normalizePlacementHint(value.placementHint),
    scaleHint: normalizeScaleHint(value.scaleHint),
    orientationHint: normalizeOrientationHint(value.orientationHint),
    reason,
    priority: Math.round(clamp(clampFiniteNumber(value.priority, index + 1), 1, 9))
  });
}

function sanitizeSceneAnalysis(value: unknown, input: DrawRequest): SceneAnalysis {
  const root = extractRoot(value);
  if (!isJsonObject(root)) {
    return sceneAnalysisSchema.parse({
      scene: "current sketch",
      why: "I could not read the scene reliably enough to choose a confident addition.",
      subjects: [],
      additions: []
    });
  }

  const rawSubjects = Array.isArray(root.subjects)
    ? root.subjects
    : Array.isArray(root.objects)
      ? root.objects
      : Array.isArray(root.sceneObjects)
        ? root.sceneObjects
        : [];

  const subjects = rawSubjects
    .map((item, index) => normalizeSubject(item, input, index))
    .filter((item): item is SceneSubject => item !== null)
    .slice(0, 12);

  const rawAdditions = Array.isArray(root.additions)
    ? root.additions
    : Array.isArray(root.proposals)
      ? root.proposals
      : Array.isArray(root.suggestions)
        ? root.suggestions
        : [];

  const additions = rawAdditions
    .map((item, index) => normalizeAddition(item, subjects, index))
    .filter((item): item is SceneAddition => item !== null)
    .slice(0, 5);

  return sceneAnalysisSchema.parse({
    scene:
      typeof root.scene === "string" && root.scene.trim()
        ? root.scene.trim().slice(0, 160)
        : "current sketch",
    why:
      typeof root.why === "string" && root.why.trim()
        ? root.why.trim().slice(0, 200)
        : "it has room for a small related addition",
    subjects,
    additions
  });
}

function buildFallbackSceneAnalysis(reason?: string): SceneAnalysis {
  return sceneAnalysisSchema.parse({
    scene: "current sketch",
    why: reason ?? "I could not read the scene reliably enough to choose a confident addition.",
    subjects: [],
    additions: []
  });
}

function buildAnalysisSystemPrompt(input: DrawRequest) {
  return [
    "You analyze a live collaborative whiteboard drawing.",
    "Return only strict JSON.",
    'Return exactly this shape: {"scene":"house with trees","why":"why the scene reads this way","subjects":[{"id":"subj_house_1","family":"house","label":"house","bbox":{"x":220,"y":180,"width":260,"height":240}}],"additions":[{"id":"add_1","family":"chimney","targetSubjectId":"subj_house_1","relation":"attach_roof_right","placementHint":{"xRatio":0.72,"yRatio":0.18},"scaleHint":{"widthRatio":0.12,"heightRatio":0.24},"orientationHint":"vertical","reason":"adds a lived-in roof detail","priority":1}]}.',
    "Do not return markdown, explanations, or stroke geometry.",
    "family is a short object label like chimney, mailbox, porch light, hedge, cat, pond, fence, cloud, or flag.",
    `relation must be one of: ${relationValues.join(", ")}.`,
    "subjects are things already present in the user's drawing.",
    "additions are 1 to 5 new objects or scene elements that fit naturally in the picture.",
    "Use more additions when the page is sparse or when several small related details belong together.",
    "Use targetSubjectId when the addition belongs to a specific subject.",
    "Choose a relation that describes placement semantically, not numerically.",
    "placementHint gives coarse local placement within the target subject or scene cluster using xRatio and yRatio from 0 to 1 plus optional biasX and biasY from -1 to 1.",
    "scaleHint gives coarse size intent using widthRatio and heightRatio relative to the target subject or local scene area.",
    "orientationHint should be one of horizontal, vertical, diagonal_left, diagonal_right, arched, floating, or upright.",
    "These hints should be coarse and approximate, not pixel-perfect.",
    input.mode === "comment"
      ? "If there is a target comment, prioritize an addition near the commented subject."
      : "Address the whole page naturally and choose what genuinely fits best in the picture."
  ].join(" ");
}

function buildAnalysisUserPayload(input: DrawRequest) {
  const targetComment =
    input.mode === "comment" && input.targetCommentId
      ? input.comments.find((comment) => comment.id === input.targetCommentId) ?? null
      : null;

  return JSON.stringify(
    {
      mode: input.mode,
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      supportedRelations: relationValues,
      palette: input.palette,
      recentHumanMarks: input.humanDelta,
      recentAiMarks: input.aiDelta,
      recentTurnHistory: input.turnHistory.slice(-4).map((entry) => ({
        role: entry.role,
        summary: entry.summary
      })),
      targetComment:
        targetComment
          ? {
              id: targetComment.id,
              x: targetComment.x,
              y: targetComment.y,
              text: targetComment.text
            }
          : null
    },
    null,
    2
  );
}

function sanitizeShortText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizePaletteColor(color: unknown, palette: string[]) {
  if (typeof color === "string") {
    const normalized = color.trim().toLowerCase();
    const exactMatch = palette.find((entry) => entry.toLowerCase() === normalized);
    if (exactMatch) {
      return exactMatch;
    }

    const semanticMatches: Array<[string[], string | undefined]> = [
      [["black", "ink", "dark", "outline"], palette[0]],
      [["blue", "sky"], palette[1]],
      [["red", "pink", "coral"], palette[2]],
      [["orange", "gold", "yellow", "sun"], palette[3]],
      [["green", "teal", "grass", "leaf"], palette[4]]
    ];

    for (const [needles, target] of semanticMatches) {
      if (target && needles.some((needle) => normalized.includes(needle))) {
        return target;
      }
    }
  }

  return palette[0];
}

function clampTuplePoint(
  point: unknown,
  input: DrawRequest
): [number, number] | null {
  if (Array.isArray(point) && point.length >= 2) {
    const x = clamp(clampFiniteNumber(point[0], NaN), 0, input.canvasWidth);
    const y = clamp(clampFiniteNumber(point[1], NaN), 0, input.canvasHeight);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [Math.round(x), Math.round(y)];
    }
  }

  if (isJsonObject(point)) {
    const x = clamp(clampFiniteNumber(point.x, NaN), 0, input.canvasWidth);
    const y = clamp(clampFiniteNumber(point.y, NaN), 0, input.canvasHeight);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [Math.round(x), Math.round(y)];
    }
  }

  return null;
}

function downsamplePoints(points: [number, number][], limit: number) {
  if (points.length <= limit) {
    return points;
  }

  const stride = (points.length - 1) / (limit - 1);
  const sampled: [number, number][] = [];

  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(index * stride);
    sampled.push(points[Math.min(points.length - 1, sourceIndex)]);
  }

  return sampled;
}

function getPointBounds(points: [number, number][]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function normalizeShapeKind(rawShape: string) {
  switch (rawShape) {
    case "rectangle":
    case "square":
      return "rect";
    case "ellipse":
    case "oval":
      return "circle";
    case "path":
    case "curve":
      return "scribble";
    case "triangle":
      return "triangle";
    case "trapezoid":
    case "roof":
      return "trapezoid";
    default:
      return rawShape;
  }
}

function sanitizeShapeFill(
  rawFill: unknown,
  shape: string,
  color: string,
  width: number,
  height: number,
  input: DrawRequest
) {
  if (rawFill === "transparent") {
    return "transparent";
  }

  if (typeof rawFill !== "string") {
    return undefined;
  }

  const normalizedFill = normalizePaletteColor(rawFill, input.palette);
  const areaRatio =
    (Math.max(1, width) * Math.max(1, height)) /
    Math.max(1, input.canvasWidth * input.canvasHeight);
  const isStructuralShape =
    shape === "rect" || shape === "triangle" || shape === "trapezoid";
  const isLargeShape =
    areaRatio > 0.035 ||
    width > input.canvasWidth * 0.22 ||
    height > input.canvasHeight * 0.22;

  if (isLargeShape && (isStructuralShape || normalizedFill === color)) {
    return "transparent";
  }

  return normalizedFill;
}

function isLargeOpaqueShapeEvent(
  event: Extract<PlannedDrawEvent, { type: "shape" }>,
  input: DrawRequest
) {
  const isOpaque = Boolean(event.fill && event.fill !== "transparent");
  if (!isOpaque) {
    return false;
  }

  const areaRatio =
    (Math.max(1, event.width) * Math.max(1, event.height)) /
    Math.max(1, input.canvasWidth * input.canvasHeight);

  return areaRatio > 0.05;
}

function assertPlanLooksDrawable(plan: GeminiDrawPlan, input: DrawRequest) {
  const visualEvents = plan.events.filter(
    (event) =>
      event.type === "stroke" ||
      event.type === "shape" ||
      event.type === "ascii_block"
  );

  if (visualEvents.length === 0) {
    return;
  }

  const largeOpaqueShapes = visualEvents.filter(
    (
      event
    ): event is Extract<PlannedDrawEvent, { type: "shape" }> =>
      event.type === "shape" && isLargeOpaqueShapeEvent(event, input)
  );

  const hasStructureOutlines = visualEvents.some((event) => {
    if (event.type === "stroke" || event.type === "ascii_block") {
      return true;
    }

    return !event.fill || event.fill === "transparent";
  });

  const hasLargeOpaqueStructuralShape = largeOpaqueShapes.some((event) =>
    ["rect", "triangle", "trapezoid"].includes(event.shape)
  );

  if (hasLargeOpaqueStructuralShape || (largeOpaqueShapes.length > 1 && !hasStructureOutlines)) {
    throw new Error("Draw plan relies on large opaque primitive blocks instead of drawable structure.");
  }
}

function getStrokeTravel(points: [number, number][]) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]
    );
  }
  return total;
}

function isSceneWideLabel(label: string | undefined) {
  return includesAny(label, [
    "hill",
    "water",
    "river",
    "pond",
    "path",
    "road",
    "fence",
    "grass",
    "ground",
    "horizon",
    "cloud",
    "smoke",
    "sun rays"
  ]);
}

function splitStrokeRuns(
  points: [number, number][],
  jumpLimit: number
) {
  const runs: [number, number][][] = [];
  let currentRun: [number, number][] = [];

  for (const point of points) {
    if (currentRun.length === 0) {
      currentRun.push(point);
      continue;
    }

    const previous = currentRun[currentRun.length - 1];
    const jump = Math.hypot(point[0] - previous[0], point[1] - previous[1]);

    if (jump > jumpLimit) {
      if (currentRun.length >= 2) {
        runs.push(currentRun);
      }
      currentRun = [point];
      continue;
    }

    currentRun.push(point);
  }

  if (currentRun.length >= 2) {
    runs.push(currentRun);
  }

  return runs;
}

function sanitizeStrokePoints(
  points: [number, number][],
  input: DrawRequest,
  label?: string
) {
  const deduped: [number, number][] = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous) {
      deduped.push(point);
      continue;
    }

    const distance = Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    if (distance >= 2) {
      deduped.push(point);
    }
  }

  if (deduped.length < 2) {
    return null;
  }

  const canvasDiagonal = Math.hypot(input.canvasWidth, input.canvasHeight);
  const jumpLimit = Math.max(84, canvasDiagonal * 0.18);
  const runs = splitStrokeRuns(deduped, jumpLimit);
  if (runs.length === 0) {
    return null;
  }

  const bestRun = runs.sort((left, right) => {
    if (right.length !== left.length) {
      return right.length - left.length;
    }
    return getStrokeTravel(right) - getStrokeTravel(left);
  })[0];

  const boundedRun = downsamplePoints(bestRun, 48);
  const bounds = getPointBounds(boundedRun);
  const travel = getStrokeTravel(boundedRun);
  const sceneWide = isSceneWideLabel(label);

  if (!sceneWide) {
    if (
      bounds.width > input.canvasWidth * 0.62 ||
      bounds.height > input.canvasHeight * 0.62 ||
      travel > canvasDiagonal * 0.9
    ) {
      return null;
    }
  }

  if (travel < 8 && boundedRun.length < 3) {
    return null;
  }

  return boundedRun;
}

function extractJsonArrayField(rawText: string, field: string) {
  const fieldIndex = rawText.indexOf(`"${field}"`);
  if (fieldIndex < 0) {
    return undefined;
  }

  const bracketIndex = rawText.indexOf("[", fieldIndex);
  if (bracketIndex < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = bracketIndex; index < rawText.length; index += 1) {
    const char = rawText[index];

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

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return rawText.slice(bracketIndex, index + 1);
      }
    }
  }

  return undefined;
}

function normalizePlannedEvent(
  value: unknown,
  input: DrawRequest
): PlannedDrawEvent | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const rawType =
    typeof value.type === "string"
      ? value.type.trim().toLowerCase().replace(/\s+/g, "_")
      : typeof value.kind === "string"
        ? value.kind.trim().toLowerCase().replace(/\s+/g, "_")
        : "";

  const eventType =
    rawType === "block" || rawType === "ascii" ? "ascii_block" :
    rawType === "palette" ? "set_palette" :
    rawType === "reply" ? "comment_reply" :
    rawType === "narration" ? "say" :
    rawType;

  if (eventType === "stroke") {
    const rawPoints = Array.isArray(value.points) ? value.points : [];
    const points = sanitizeStrokePoints(
      rawPoints
        .map((point) => clampTuplePoint(point, input))
        .filter((point): point is [number, number] => point !== null),
      input,
      sanitizeShortText(value.label ?? value.objectLabel, 120)
    );

    if (!points || points.length < 2) {
      return null;
    }

    return plannedDrawEventSchema.parse({
      type: "stroke",
      color: normalizePaletteColor(value.color, input.palette),
      width: input.activeStrokeSize,
      opacity: clamp(clampFiniteNumber(value.opacity, 0.92), 0.05, 1),
      points,
      timing: isJsonObject(value.timing)
        ? {
            speed:
              value.timing.speed === undefined
                ? undefined
                : clamp(clampFiniteNumber(value.timing.speed, 0.7), 0.2, 3),
            pauseAfterMs:
              value.timing.pauseAfterMs === undefined
                ? undefined
                : Math.round(clamp(clampFiniteNumber(value.timing.pauseAfterMs, 90), 0, 1200))
          }
        : undefined,
      label: sanitizeShortText(value.label, 120),
      objectLabel: sanitizeShortText(value.objectLabel, 80)
    });
  }

  if (eventType === "shape") {
    const rawShape =
      typeof value.shape === "string"
        ? value.shape.trim().toLowerCase()
        : "scribble";
    const shape = normalizeShapeKind(rawShape);
    const color = normalizePaletteColor(value.color, input.palette);
    const width = clamp(
      Math.abs(clampFiniteNumber(value.width, input.canvasWidth * 0.12)),
      12,
      input.canvasWidth * 0.62
    );
    const height = clamp(
      Math.abs(clampFiniteNumber(value.height, input.canvasHeight * 0.12)),
      12,
      input.canvasHeight * 0.62
    );

    return plannedDrawEventSchema.parse({
      type: "shape",
      shape: ["rect", "circle", "line", "arrow", "scribble", "triangle", "trapezoid"].includes(shape)
        ? shape
        : "scribble",
      color,
      x: Math.round(clamp(clampFiniteNumber(value.x, input.canvasWidth * 0.5), 0, input.canvasWidth)),
      y: Math.round(clamp(clampFiniteNumber(value.y, input.canvasHeight * 0.5), 0, input.canvasHeight)),
      width,
      height,
      rotation:
        value.rotation === undefined
          ? undefined
          : clamp(clampFiniteNumber(value.rotation, 0), -Math.PI * 2, Math.PI * 2),
      fill: sanitizeShapeFill(value.fill, shape, color, width, height, input),
      strokeWidth: input.activeStrokeSize
    });
  }

  if (eventType === "ascii_block") {
    const text = sanitizeShortText(value.text ?? value.block, 240);
    if (!text) {
      return null;
    }

    return plannedDrawEventSchema.parse({
      type: "ascii_block",
      color: normalizePaletteColor(value.color, input.palette),
      x: Math.round(clamp(clampFiniteNumber(value.x, input.canvasWidth * 0.5), 0, input.canvasWidth)),
      y: Math.round(clamp(clampFiniteNumber(value.y, input.canvasHeight * 0.5), 0, input.canvasHeight)),
      text,
      fontSize: clamp(clampFiniteNumber(value.fontSize, 28), 12, 96),
      width:
        value.width === undefined
          ? undefined
          : clamp(clampFiniteNumber(value.width, 120), 24, input.canvasWidth)
    });
  }

  if (eventType === "say") {
    const text = sanitizeShortText(value.text, 240);
    return text
      ? plannedDrawEventSchema.parse({
          type: "say",
          text
        })
      : null;
  }

  if (eventType === "set_palette") {
    return plannedDrawEventSchema.parse({
      type: "set_palette",
      index: Math.round(clamp(clampFiniteNumber(value.index, 0), 0, input.palette.length - 1))
    });
  }

  if (eventType === "comment_reply") {
    const text = sanitizeShortText(value.text, 240);
    return text
      ? plannedDrawEventSchema.parse({
          type: "comment_reply",
          text
        })
      : null;
  }

  return null;
}

function sanitizeGeminiDrawPlan(value: unknown, input: DrawRequest): GeminiDrawPlan {
  const root = extractRoot(value);
  const container = isJsonObject(root) ? root : {};
  const rawEvents = Array.isArray(root)
    ? root
    : Array.isArray(container.events)
      ? container.events
      : Array.isArray(container.actions)
        ? container.actions
      : Array.isArray(container.drawEvents)
          ? container.drawEvents
          : [];

  let sayCount = 0;
  let paletteCount = 0;
  let replyCount = 0;

  const events = rawEvents
    .map((event) => normalizePlannedEvent(event, input))
    .filter((event): event is PlannedDrawEvent => event !== null)
    .filter((event) => {
      if (event.type === "say") {
        sayCount += 1;
        return sayCount <= 1;
      }

      if (event.type === "set_palette") {
        paletteCount += 1;
        return paletteCount <= 1;
      }

      if (event.type === "comment_reply") {
        replyCount += 1;
        return replyCount <= 1;
      }

      return true;
    })
    .slice(0, 24);

  return geminiDrawPlanSchema.parse({
    thinking: sanitizeShortText(container.thinking, 240),
    narration:
      sanitizeShortText(container.narration, 240) ??
      sanitizeShortText(container.say, 240),
    summary: sanitizeShortText(container.summary, 240),
    previewSaw: sanitizeShortText(container.previewSaw ?? container.saw, 240),
    previewDrawing: sanitizeShortText(container.previewDrawing ?? container.drawing, 240),
    events
  });
}

function buildDrawSystemPrompt(input: DrawRequest) {
  return [
    "You are a collaborative drawing agent controlling a live whiteboard.",
    "Return only strict JSON. Do not use markdown.",
    'Return this exact top-level shape: {"thinking":"short hidden planning note","narration":"what you are adding","summary":"what you added overall","previewSaw":"what you see in the picture","previewDrawing":"what you plan to add","events":[...]}',
    "events must be an array of drawing operations that the client will render.",
    'Allowed event types: stroke, shape, ascii_block, say, set_palette, comment_reply.',
    'stroke event shape: {"type":"stroke","color":"#262523","width":6,"opacity":0.92,"points":[[120,80],[140,96],[162,120]],"timing":{"speed":0.7,"pauseAfterMs":90},"label":"tree"}',
    'shape event shape: {"type":"shape","shape":"circle","color":"#f4a261","x":320,"y":120,"width":90,"height":90,"strokeWidth":4,"fill":"transparent"}',
    'You may also use {"shape":"triangle"} or {"shape":"trapezoid"} for roofs and simple outlined structures.',
    'ascii_block event shape: {"type":"ascii_block","color":"#262523","x":220,"y":140,"text":"^^","fontSize":28}',
    'say event shape: {"type":"say","text":"I added a tree beside the house."}',
    'set_palette event shape: {"type":"set_palette","index":2}',
    'comment_reply event shape: {"type":"comment_reply","text":"I added something near your note."}',
    "Do not return explanation outside the JSON object.",
    "You are drawing, not describing a future drawing.",
    "Prefer actual visual events over narration.",
    "Stay inside the canvas bounds.",
    "Choose colors adaptively from the provided palette based on what fits the drawing best.",
    "Do not default every mark to the same dark outline color unless the picture genuinely calls for it.",
    "Use only colors from the provided palette.",
    "Match every stroke width and every shape outline width to the provided active ink width.",
    "Prefer a few coherent additions that fit the picture.",
    "Think in objects and object parts, not random marks.",
    "If you add a tree, draw a trunk and canopy. If you add a chimney, attach it to the roof and optionally add smoke. If you add a path, start it near the doorway or foreground groundline. If you add a cloud, use a compact cluster instead of one huge line.",
    "Do not redraw the user's whole subject unless explicitly necessary.",
    "Do not place context objects inside windows, doors, or the middle of another object unless that is obviously intended.",
    "Use shape events when a circle, rectangle, triangle, trapezoid, or simple geometric form is cleaner than a stroke.",
    "For houses, roofs, buildings, windows, doors, and other structural objects, use transparent fill and draw the outline. Do not use large solid blocks of color as the whole object.",
    "Only use opaque fill for small accent shapes like a sun, berry, or tiny decorative detail.",
    "Keep each stroke local and continuous. Never teleport across the canvas in one stroke.",
    "For most objects, keep stroke point counts between 2 and 16. Only scene-wide elements like hills, water, or fences should use longer spans.",
    "A normal turn should usually contain 1 to 4 coherent additions built from several local events.",
    "If the picture is sparse, you may add up to 5 related details, but they should still feel like one scene.",
    "You may address the whole page naturally when it helps the composition.",
    "Use smooth, short point sequences, not huge coordinate dumps.",
    "Prefer 2 to 12 visual events, depending on the scene.",
    "For sparse scenes, it is okay to add several related details.",
    "If you are unsure where to place something, choose a smaller safer local addition rather than a large sweeping mark.",
    input.mode === "comment"
      ? "If this is a comment-triggered turn, include one comment_reply event if it helps."
      : "This is a normal drawing turn. Focus on adding visual content."
  ].join(" ");
}

function buildDrawRepairSystemPrompt() {
  return [
    "You are repairing an invalid whiteboard drawing JSON response.",
    "Return only strict JSON.",
    "Preserve the same top-level shape with thinking, narration, summary, previewSaw, previewDrawing, and events.",
    "Fix malformed JSON, remove invalid events, and keep only drawable coherent events.",
    "Do not invent large new content. Prefer keeping fewer valid events over many questionable ones.",
    "For stroke events, ensure points are short continuous local polylines.",
    "For local objects like trees, chimneys, flowers, bushes, lamps, doors, and windows, avoid strokes that span most of the page.",
    "For houses, roofs, and other structures, prefer outlined rectangle/triangle/trapezoid shapes with transparent fill.",
    "Remove or convert any large solid filled primitive blocks that would render as featureless slabs.",
    "Use only the allowed event types: stroke, shape, ascii_block, say, set_palette, comment_reply."
  ].join(" ");
}

function buildDrawRepairUserPayload(input: DrawRequest, rawPlan: string) {
  return JSON.stringify(
    {
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      palette: input.palette,
      originalResponse: rawPlan
    },
    null,
    2
  );
}

function buildDrawUserPayload(input: DrawRequest) {
  const humanBounds = extractHumanBounds(input);
  const sceneCoverage =
    (humanBounds.width * humanBounds.height) /
    Math.max(1, input.canvasWidth * input.canvasHeight);
  const targetComment =
    input.mode === "comment" && input.targetCommentId
      ? input.comments.find((comment) => comment.id === input.targetCommentId) ?? null
      : null;

  return JSON.stringify(
    {
      mode: input.mode,
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      activeInk: {
        width: input.activeStrokeSize
      },
      pageContext: {
        sceneCoverage: Number(sceneCoverage.toFixed(3)),
        humanBounds: {
          x: Math.round(humanBounds.minX),
          y: Math.round(humanBounds.minY),
          width: Math.round(humanBounds.width),
          height: Math.round(humanBounds.height)
        },
        visualDensity:
          sceneCoverage < 0.12 ? "sparse" : sceneCoverage < 0.28 ? "medium" : "dense"
      },
      palette: input.palette,
      recentHumanMarks: input.humanDelta,
      recentAiMarks: input.aiDelta,
      comments: input.comments.slice(-6).map((comment) => ({
        id: comment.id,
        x: comment.x,
        y: comment.y,
        text: comment.text,
        lastReply: comment.thread.at(-1)?.text ?? null
      })),
      turnHistory: input.turnHistory.slice(-6).map((entry) => ({
        role: entry.role,
        summary: entry.summary
      })),
      targetComment:
        targetComment
          ? {
              id: targetComment.id,
              x: targetComment.x,
              y: targetComment.y,
              text: targetComment.text
            }
          : null
    },
    null,
    2
  );
}

async function callGeminiJson(options: {
  gemini: NonNullable<ReturnType<typeof getGeminiConfig>>;
  systemText: string;
  userText: string;
  imageDataUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}) {
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: options.userText }];

  if (options.imageDataUrl) {
    const image = splitDataUrl(options.imageDataUrl);
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data
      }
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.gemini.model}:generateContent?key=${options.gemini.apiKey}`,
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
          temperature: options.temperature ?? 0.18,
          responseMimeType: "application/json",
          maxOutputTokens: options.maxOutputTokens ?? 1536
        },
        contents: [
          {
            role: "user",
            parts
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new GeminiRequestError(
      response.status,
      `Gemini request failed with ${response.status}${errorText ? `: ${errorText}` : "."}`
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const rawText =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  return rawText;
}

function parseSceneAnalysis(rawText: string, input: DrawRequest): SceneAnalysis {
  const parsed = JSON.parse(stripCodeFence(rawText));
  return sanitizeSceneAnalysis(parsed, input);
}

function parseGeminiDrawPlan(rawText: string, input: DrawRequest): GeminiDrawPlan {
  const parsed = JSON.parse(stripCodeFence(rawText));
  const plan = sanitizeGeminiDrawPlan(parsed, input);
  assertPlanLooksDrawable(plan, input);
  return plan;
}

export async function generateDrawPlan(input: DrawRequest): Promise<GeminiDrawPlan | null> {
  const gemini = getGeminiConfig();
  if (!gemini) {
    console.info("[draw-ai] Gemini not configured; skipping direct draw plan");
    return null;
  }

  let rawPlan = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      rawPlan = await callGeminiJson({
        gemini,
        systemText: buildDrawSystemPrompt(input),
        userText: buildDrawUserPayload(input),
        imageDataUrl: input.snapshotBase64,
        temperature: getRequestedTemperature(input, 0.22),
        maxOutputTokens: getRequestedMaxOutputTokens(input, 4096)
      });
      break;
    } catch (error) {
      const isTransient =
        error instanceof GeminiRequestError &&
        [429, 500, 503].includes(error.status);

      if (isTransient && attempt === 0) {
        console.warn("[draw-ai] transient draw-plan error; retrying once", {
          status: error.status
        });
        await sleep(450);
        continue;
      }

      console.error(
        "[draw-ai] draw-plan request failed",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  if (!rawPlan) {
    return null;
  }

  console.info("[draw-ai] raw direct draw plan", rawPlan.slice(0, 2000));

  try {
    const plan = parseGeminiDrawPlan(rawPlan, input);
    console.info("[draw-ai] direct draw plan accepted", {
      eventCount: plan.events.length,
      hasThinking: Boolean(plan.thinking),
      hasSummary: Boolean(plan.summary)
    });
    return plan;
  } catch (error) {
    console.warn(
      "[draw-ai] direct draw plan validation failed",
      error instanceof Error ? error.message : error
    );

    try {
      const repairedRaw = await callGeminiJson({
        gemini,
        systemText: buildDrawRepairSystemPrompt(),
        userText: buildDrawRepairUserPayload(input, rawPlan),
        temperature: 0.05,
        maxOutputTokens: Math.min(
          3072,
          getRequestedMaxOutputTokens(input, 3072)
        )
      });

      console.info("[draw-ai] raw repaired draw plan", repairedRaw.slice(0, 2000));

      const repaired = parseGeminiDrawPlan(repairedRaw, input);
      console.info("[draw-ai] repaired draw plan accepted", {
        eventCount: repaired.events.length
      });
      return repaired;
    } catch (repairError) {
      console.warn(
        "[draw-ai] draw plan repair failed",
        repairError instanceof Error ? repairError.message : repairError
      );
    }

    try {
      const extractedEvents = extractJsonArrayField(rawPlan, "events");
      const salvaged = sanitizeGeminiDrawPlan(
        {
          thinking: extractJsonStringField(rawPlan, "thinking"),
          narration:
            extractJsonStringField(rawPlan, "narration") ??
            extractJsonStringField(rawPlan, "say"),
          summary: extractJsonStringField(rawPlan, "summary"),
          previewSaw:
            extractJsonStringField(rawPlan, "previewSaw") ??
            extractJsonStringField(rawPlan, "saw"),
          previewDrawing:
            extractJsonStringField(rawPlan, "previewDrawing") ??
            extractJsonStringField(rawPlan, "drawing"),
          events: extractedEvents ? JSON.parse(extractedEvents) : []
        },
        input
      );
      assertPlanLooksDrawable(salvaged, input);
      return salvaged;
    } catch {
      return null;
    }
  }
}

export async function analyzeScene(input: DrawRequest): Promise<SceneAnalysis> {
  const gemini = getGeminiConfig();
  if (!gemini) {
    console.info("[draw-ai] Gemini not configured; skipping scene analysis");
    return buildFallbackSceneAnalysis("Gemini is not configured.");
  }

  let rawAnalysis = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      rawAnalysis = await callGeminiJson({
        gemini,
        systemText: buildAnalysisSystemPrompt(input),
        userText: buildAnalysisUserPayload(input),
        imageDataUrl: input.snapshotBase64,
        temperature: getRequestedTemperature(input, 0.16),
        maxOutputTokens: Math.min(
          3072,
          getRequestedMaxOutputTokens(input, 2048)
        )
      });
      break;
    } catch (error) {
      const isTransient =
        error instanceof GeminiRequestError &&
        [429, 500, 503].includes(error.status);

      if (isTransient && attempt === 0) {
        console.warn("[draw-ai] transient scene analysis error; retrying once", {
          status: error.status
        });
        await sleep(450);
        continue;
      }

      console.error(
        "[draw-ai] scene analysis request failed",
        error instanceof Error ? error.message : error
      );
      return buildFallbackSceneAnalysis("The model was unavailable, so no addition was rendered.");
    }
  }

  if (!rawAnalysis) {
    return buildFallbackSceneAnalysis("The model was unavailable, so no addition was rendered.");
  }

  console.info("[draw-ai] raw scene analysis response", rawAnalysis.slice(0, 1600));

  try {
    const analysis = parseSceneAnalysis(rawAnalysis, input);
    console.info("[draw-ai] scene analysis accepted", {
      scene: analysis.scene,
      subjectCount: analysis.subjects.length,
      additionCount: analysis.additions.length
    });
    return analysis;
  } catch (error) {
    console.warn(
      "[draw-ai] scene analysis validation failed",
      error instanceof Error ? error.message : error
    );

    return sceneAnalysisSchema.parse({
      scene: extractJsonStringField(rawAnalysis, "scene") ?? "current sketch",
      why:
        extractJsonStringField(rawAnalysis, "why") ??
        "I could not parse a reliable scene plan, so no addition was rendered.",
      subjects: [],
      additions: []
    });
  }
}
