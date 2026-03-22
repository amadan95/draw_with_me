import { z } from "zod";
import {
  createId,
  drawRequestSchema,
  geminiDrawPlanSchema,
  objectBoundingBoxSchema,
  objectFamilySchema,
  orientationHintSchema,
  plannedDrawEventSchema,
  sceneAdditionSchema,
  sceneAnalysisSchema,
  sceneSubjectSchema,
  semanticGridCellSchema,
  semanticGridCellsSchema,
  sizeHintSchema,
  svgViewBoxSchema,
  type GeminiDrawPlan,
  type ObjectBoundingBox,
  type ObjectFamily,
  type OrientationHint,
  type PlannedDrawEvent,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject,
  type SemanticGridCell,
  type SizeHint,
  type SvgViewBox
} from "@/lib/draw-types";
import {
  calculateUnitScale,
  dedupeGridCells,
  getHumanContextBoundingBox,
  gridCellsToBounds,
  mapBoundsToGridCells,
  pointToGridCell,
  semanticGridCellLabel,
  summarizeHumanContextGrid
} from "@/lib/scene-anchors";
import { getPointBounds, svgPathToFramePoints } from "@/lib/svg-path";

type DrawRequest = z.infer<typeof drawRequestSchema>;
type JsonObject = Record<string, unknown>;

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

function clampFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeShortText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
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

  return mode === "addition" ? "detail" : null;
}

function normalizePaletteColor(color: unknown, palette: string[]) {
  if (typeof color === "string") {
    const normalized = color.trim().toLowerCase();
    const exactMatch = palette.find((entry) => entry.toLowerCase() === normalized);
    if (exactMatch) {
      return exactMatch;
    }

    const semanticMatches: Array<[string[], string | undefined]> = [
      [["black", "ink", "dark", "outline", "charcoal"], palette[0]],
      [["blue", "sky", "water"], palette[1]],
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

function normalizeOrientationHint(value: unknown): OrientationHint | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return orientationHintSchema.options.includes(normalized as OrientationHint)
    ? orientationHintSchema.parse(normalized)
    : undefined;
}

function normalizeSizeHint(value: unknown): SizeHint | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return sizeHintSchema.options.includes(normalized as SizeHint)
    ? sizeHintSchema.parse(normalized)
    : undefined;
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

  const bounds = gridCellsToBounds(event.gridCells, input.canvasWidth, input.canvasHeight);
  const areaRatio =
    (Math.max(1, bounds.width) * Math.max(1, bounds.height)) /
    Math.max(1, input.canvasWidth * input.canvasHeight);

  return areaRatio > 0.05;
}

function normalizeViewBox(value: unknown): SvgViewBox | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  return svgViewBoxSchema.parse({
    width: clamp(clampFiniteNumber(value.width, 100), 1, 10000),
    height: clamp(clampFiniteNumber(value.height, 100), 1, 10000)
  });
}

function normalizeBoundingBox(
  value: unknown,
  input: DrawRequest,
  fallback: ObjectBoundingBox
) {
  if (!isJsonObject(value)) {
    return objectBoundingBoxSchema.parse(fallback);
  }

  const width = clamp(clampFiniteNumber(value.width, fallback.width), 12, input.canvasWidth);
  const height = clamp(clampFiniteNumber(value.height, fallback.height), 12, input.canvasHeight);
  const x = clamp(clampFiniteNumber(value.x, fallback.x), 0, Math.max(0, input.canvasWidth - width));
  const y = clamp(clampFiniteNumber(value.y, fallback.y), 0, Math.max(0, input.canvasHeight - height));

  return objectBoundingBoxSchema.parse({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  });
}

function parseSemanticGridCellString(value: string): SemanticGridCell | null {
  const match = value.trim().toUpperCase().match(/^([A-L])\s*([1-9]|1[0-2])$/);
  if (!match) {
    return null;
  }

  return semanticGridCellSchema.parse([match[1], Number(match[2])]);
}

function normalizeSemanticGridCell(value: unknown): SemanticGridCell | null {
  if (typeof value === "string") {
    return parseSemanticGridCellString(value);
  }

  if (Array.isArray(value) && value.length >= 2) {
    const column = typeof value[0] === "string" ? value[0].trim().toUpperCase() : "";
    const row = typeof value[1] === "number" ? value[1] : Number(value[1]);
    if (column && Number.isInteger(row)) {
      try {
        return semanticGridCellSchema.parse([column, row]);
      } catch {
        return null;
      }
    }
  }

  if (isJsonObject(value)) {
    const columnValue =
      typeof value.column === "string"
        ? value.column
        : typeof value.col === "string"
          ? value.col
          : typeof value.x === "string"
            ? value.x
            : "";
    const rowValue =
      typeof value.row === "number" || typeof value.row === "string"
        ? Number(value.row)
        : typeof value.y === "number" || typeof value.y === "string"
          ? Number(value.y)
          : NaN;
    if (columnValue && Number.isInteger(rowValue)) {
      try {
        return semanticGridCellSchema.parse([columnValue.trim().toUpperCase(), rowValue]);
      } catch {
        return null;
      }
    }
  }

  return null;
}

function normalizeSemanticGridCells(
  value: unknown,
  input: DrawRequest,
  fallbackBounds?: ObjectBoundingBox
) {
  const cells = Array.isArray(value)
    ? value
        .map((entry) => normalizeSemanticGridCell(entry))
        .filter((entry): entry is SemanticGridCell => entry !== null)
    : [];

  if (cells.length > 0) {
    return dedupeGridCells(cells).slice(0, 48);
  }

  if (fallbackBounds) {
    return mapBoundsToGridCells(fallbackBounds, input.canvasWidth, input.canvasHeight).slice(0, 48);
  }

  return [] as SemanticGridCell[];
}

function normalizeClaimedGridCells(
  value: unknown,
  input: DrawRequest,
  fallbackCells: SemanticGridCell[] = []
) {
  const normalized = normalizeSemanticGridCells(value, input);
  if (normalized.length > 0) {
    return semanticGridCellsSchema.parse(normalized);
  }

  return semanticGridCellsSchema.parse(fallbackCells.slice(0, 16));
}

function getHumanSceneBounds(input: DrawRequest) {
  const boxes = input.humanDelta.map((item) => getHumanContextBoundingBox(item));
  if (boxes.length === 0) {
    return objectBoundingBoxSchema.parse({
      x: input.canvasWidth * 0.34,
      y: input.canvasHeight * 0.3,
      width: input.canvasWidth * 0.32,
      height: input.canvasHeight * 0.28
    });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  return objectBoundingBoxSchema.parse({
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(1, Math.round(maxX - minX)),
    height: Math.max(1, Math.round(maxY - minY))
  });
}

function getSceneCenterCell(input: DrawRequest) {
  const bounds = getHumanSceneBounds(input);
  return pointToGridCell(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.5,
    input.canvasWidth,
    input.canvasHeight
  );
}

function getSubjectCenterCell(subject: SceneSubject, input: DrawRequest) {
  const bounds = subject.bbox;
  return pointToGridCell(
    bounds.x + bounds.width * 0.5,
    bounds.y + bounds.height * 0.5,
    input.canvasWidth,
    input.canvasHeight
  );
}

function chooseFallbackTargetCell(
  family: ObjectFamily,
  input: DrawRequest,
  targetSubject: SceneSubject | null
) {
  if (targetSubject) {
    const centerCell = getSubjectCenterCell(targetSubject, input);
    const [column, row] = centerCell;

    if (includesAny(family, ["cloud", "bird", "sun", "moon", "star"])) {
      return semanticGridCellSchema.parse([column, Math.max(1, row - 2)]);
    }
    if (includesAny(family, ["grass", "flower", "path", "pond", "water", "fence"])) {
      return semanticGridCellSchema.parse([column, Math.min(12, row + 1)]);
    }

    return centerCell;
  }

  return getSceneCenterCell(input);
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

  const fallbackBounds =
    isJsonObject(value.bbox)
      ? normalizeBoundingBox(value.bbox, input, getHumanSceneBounds(input))
      : undefined;
  const occupiedGridCells = normalizeSemanticGridCells(
    value.occupiedGridCells ?? value.gridCells ?? value.cells,
    input,
    fallbackBounds
  );

  if (occupiedGridCells.length === 0) {
    return null;
  }

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
    occupiedGridCells,
    bbox: gridCellsToBounds(occupiedGridCells, input.canvasWidth, input.canvasHeight)
  });
}

function normalizeAddition(
  value: unknown,
  subjects: SceneSubject[],
  input: DrawRequest,
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

  const targetSubject =
    typeof value.targetSubjectId === "string"
      ? subjects.find((subject) => subject.id === value.targetSubjectId) ?? null
      : null;

  const gridCells = normalizeClaimedGridCells(
    value.gridCells ?? value.cells ?? value.targetGridCell ?? value.gridCell ?? value.cell,
    input,
    [chooseFallbackTargetCell(family, input, targetSubject)]
  );

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
    gridCells,
    targetSubjectId: targetSubject?.id,
    sizeHint: normalizeSizeHint(value.sizeHint),
    orientationHint: normalizeOrientationHint(value.orientationHint),
    reason,
    priority: Math.round(clamp(clampFiniteNumber(value.priority, index + 1), 1, 9))
  });
}

function sanitizeSceneAnalysis(value: unknown, input: DrawRequest): SceneAnalysis {
  const root = extractRoot(value);
  if (!isJsonObject(root)) {
    return buildFallbackSceneAnalysis();
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
    .map((item, index) => normalizeAddition(item, subjects, input, index))
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
    "Return only strict JSON. Do not use markdown.",
    'Return this exact top-level shape: {"scene":"house with trees","why":"why the scene reads this way","subjects":[{"id":"subj_house_1","family":"house","label":"house","occupiedGridCells":[["D",5],["E",5],["D",6],["E",6]]}],"additions":[{"id":"add_1","family":"chimney","targetSubjectId":"subj_house_1","gridCells":[["E",4]],"sizeHint":"small","orientationHint":"vertical","reason":"adds a lived-in roof detail","priority":1},{"id":"add_2","family":"house","gridCells":[["J",10],["K",10],["J",11],["K",11]],"reason":"adds a second house that fits the scene context","priority":2}]}.',
    "Use the semantic grid as the placement language. The grid is 12 columns by 12 rows, columns A through L and rows 1 through 12.",
    "subjects are things that already exist in the user's drawing.",
    "Describe each subject with occupiedGridCells, not raw pixel bounds.",
    "additions are 1 to 5 new objects or scene elements that fit naturally in the picture.",
    "Every addition must choose gridCells, an array of 1 to 16 semantic grid cells that defines both placement and size.",
    "Use targetSubjectId when the addition belongs near a specific existing subject.",
    "To avoid overlapping the user's drawing, you MUST check the occupiedHumanCells provided in the payload. Do not place your gridCells inside the user's cells unless you are intentionally drawing a detail attached to their object.",
    'Control the size of your drawing by the number of grid cells you claim. A small bird might use [["A",2]]. A large house should use a block like [["J",10],["K",10],["J",11],["K",11]].',
    "Prefer additions that are not already explicitly drawn, as long as they fit the scene context naturally.",
    "A good addition often complements the scene with a related context object, ambient detail, or supporting background element instead of duplicating the main subject.",
    "Only repeat an existing subject when the scene genuinely benefits from another instance, such as another cloud, star, flower, or wave.",
    "sizeHint should be small, medium, or large.",
    "orientationHint should be one of horizontal, vertical, diagonal_left, diagonal_right, arched, floating, or upright when useful.",
    "Use more additions when the page is sparse or when several small related details belong together.",
    "Do not return stroke geometry or pixel coordinates.",
    input.mode === "comment"
      ? "If there is a target comment, prioritize an addition in or adjacent to the comment's grid cell."
      : "Address the whole page naturally and choose what genuinely fits best in the picture."
  ].join(" ");
}

function buildAnalysisUserPayload(input: DrawRequest) {
  const targetComment =
    input.mode === "comment" && input.targetCommentId
      ? input.comments.find((comment) => comment.id === input.targetCommentId) ?? null
      : null;
  const humanGridSummary = summarizeHumanContextGrid(
    input.humanDelta,
    input.canvasWidth,
    input.canvasHeight
  );
  const aiGridSummary = input.aiDelta.map((stroke, index) => {
    const bounds = getPointBounds(stroke.points);
    const occupiedGridCells = mapBoundsToGridCells(
      {
        x: bounds.minX,
        y: bounds.minY,
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height)
      },
      input.canvasWidth,
      input.canvasHeight
    );
    return {
      label: `ai stroke ${index + 1}`,
      color: stroke.color,
      occupiedGridCells: occupiedGridCells.map(semanticGridCellLabel)
    };
  });

  return JSON.stringify(
    {
      mode: input.mode,
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      semanticGrid: {
        columns: "A-L",
        rows: "1-12"
      },
      occupiedHumanCells: dedupeGridCells(
        humanGridSummary.flatMap((entry) => entry.occupiedGridCells)
      ).map(semanticGridCellLabel),
      humanGridSummary: humanGridSummary.map((entry) => ({
        kind: entry.kind,
        label: entry.label,
        occupiedGridCells: entry.occupiedGridCells.map(semanticGridCellLabel)
      })),
      humanSceneFootprint: dedupeGridCells(
        humanGridSummary.flatMap((entry) => entry.occupiedGridCells)
      ).map(semanticGridCellLabel),
      aiGridSummary,
      palette: input.palette,
      recentTurnHistory: input.turnHistory.slice(-4).map((entry) => ({
        role: entry.role,
        summary: entry.summary
      })),
      targetComment:
        targetComment
          ? {
              id: targetComment.id,
              text: targetComment.text,
              gridCell: semanticGridCellLabel(
                pointToGridCell(
                  targetComment.x,
                  targetComment.y,
                  input.canvasWidth,
                  input.canvasHeight
                )
              )
            }
          : null
    },
    null,
    2
  );
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

function validateSampledStroke(
  svgPath: string,
  frame: ObjectBoundingBox,
  viewBox: SvgViewBox | undefined,
  input: DrawRequest,
  label?: string
) {
  let points: [number, number][];

  try {
    points = svgPathToFramePoints(svgPath, frame, viewBox, {
      curveSubdivisions: 18,
      maxPoints: 192
    });
  } catch {
    return false;
  }

  if (points.length < 2) {
    return false;
  }

  for (const [x, y] of points) {
    if (x < 0 || x > input.canvasWidth || y < 0 || y > input.canvasHeight) {
      return false;
    }
  }

  const bounds = getPointBounds(points);
  const travel = getStrokeTravel(points);
  const sceneWide = isSceneWideLabel(label);
  const canvasDiagonal = Math.hypot(input.canvasWidth, input.canvasHeight);

  if (!sceneWide) {
    if (
      bounds.width > input.canvasWidth * 0.62 ||
      bounds.height > input.canvasHeight * 0.62 ||
      travel > canvasDiagonal * 0.9
    ) {
      return false;
    }
  }

  for (let index = 1; index < points.length; index += 1) {
    const jump = Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1]
    );
    if (jump > Math.max(frame.width, frame.height) * 1.25 + 32) {
      return false;
    }
  }

  return true;
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
    const svgPath =
      typeof value.svgPath === "string"
        ? value.svgPath.trim()
        : typeof value.path === "string"
          ? value.path.trim()
          : typeof value.d === "string"
            ? value.d.trim()
            : "";

    if (!svgPath) {
      return null;
    }

    const gridCells = normalizeClaimedGridCells(value.gridCells ?? value.cells, input);
    if (gridCells.length === 0) {
      return null;
    }
    const frame = gridCellsToBounds(gridCells, input.canvasWidth, input.canvasHeight);
    const viewBox = normalizeViewBox(value.viewBox);
    const label = sanitizeShortText(value.label, 120);
    const objectLabel = sanitizeShortText(value.objectLabel, 80);

    if (!validateSampledStroke(svgPath, frame, viewBox, input, label ?? objectLabel)) {
      return null;
    }

    return plannedDrawEventSchema.parse({
      type: "stroke",
      color: normalizePaletteColor(value.color, input.palette),
      width: input.activeStrokeSize,
      opacity: clamp(clampFiniteNumber(value.opacity, 0.92), 0.05, 1),
      svgPath,
      gridCells,
      viewBox,
      timing: isJsonObject(value.timing)
        ? {
            speed:
              value.timing.speed === undefined
                ? undefined
                : clamp(clampFiniteNumber(value.timing.speed, 0.72), 0.2, 3),
            pauseAfterMs:
              value.timing.pauseAfterMs === undefined
                ? undefined
                : Math.round(clamp(clampFiniteNumber(value.timing.pauseAfterMs, 90), 0, 1200))
          }
        : undefined,
      label,
      objectLabel
    });
  }

  if (eventType === "shape") {
    const rawShape =
      typeof value.shape === "string"
        ? value.shape.trim().toLowerCase()
        : "scribble";
    const shape = normalizeShapeKind(rawShape);
    const color = normalizePaletteColor(value.color, input.palette);
    const gridCells = normalizeClaimedGridCells(value.gridCells ?? value.cells, input);
    if (gridCells.length === 0) {
      return null;
    }
    const bounds = gridCellsToBounds(gridCells, input.canvasWidth, input.canvasHeight);

    return plannedDrawEventSchema.parse({
      type: "shape",
      shape: ["rect", "circle", "line", "arrow", "scribble", "triangle", "trapezoid"].includes(shape)
        ? shape
        : "scribble",
      color,
      gridCells,
      rotation:
        value.rotation === undefined
          ? undefined
          : clamp(clampFiniteNumber(value.rotation, 0), -Math.PI * 2, Math.PI * 2),
      fill: sanitizeShapeFill(value.fill, shape, color, bounds.width, bounds.height, input),
      strokeWidth: input.activeStrokeSize
    });
  }

  if (eventType === "ascii_block") {
    const text = sanitizeShortText(value.text ?? value.block, 240);
    if (!text) {
      return null;
    }
    const gridCells = normalizeClaimedGridCells(value.gridCells ?? value.cells, input);
    if (gridCells.length === 0) {
      return null;
    }
    const bounds = gridCellsToBounds(gridCells, input.canvasWidth, input.canvasHeight);

    return plannedDrawEventSchema.parse({
      type: "ascii_block",
      color: normalizePaletteColor(value.color, input.palette),
      gridCells,
      text,
      fontSize: clamp(
        clampFiniteNumber(value.fontSize, Math.max(12, bounds.height * 0.32)),
        12,
        96
      )
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

function buildDrawSystemPrompt(input: DrawRequest) {
  return [
    "You are a collaborative drawing agent controlling a live whiteboard.",
    "Return only strict JSON. Do not use markdown.",
    'Return this exact top-level shape: {"thinking":"short hidden planning note","narration":"what you are adding","summary":"what you added overall","previewSaw":"what you see in the picture","previewDrawing":"what you plan to add","events":[...]}',
    "events must be an array of drawing operations that the client will render.",
    'Allowed event types: stroke, shape, ascii_block, say, set_palette, comment_reply.',
    'stroke event shape: {"type":"stroke","color":"#262523","width":6,"opacity":0.92,"svgPath":"M 8 74 C 18 48 34 20 54 18","gridCells":[["J",10],["K",10],["J",11],["K",11]],"viewBox":{"width":100,"height":100},"timing":{"speed":0.7,"pauseAfterMs":90},"label":"tree canopy"}',
    'shape event shape: {"type":"shape","shape":"circle","color":"#f4a261","gridCells":[["B",2]],"strokeWidth":4,"fill":"transparent"}',
    'ascii_block event shape: {"type":"ascii_block","color":"#262523","gridCells":[["C",3]],"text":"^^","fontSize":28}',
    'say event shape: {"type":"say","text":"I added a tree beside the house."}',
    'set_palette event shape: {"type":"set_palette","index":2}',
    'comment_reply event shape: {"type":"comment_reply","text":"I added something near your note."}',
    "thinking is private reasoning, but it must still reflect the same concrete plan that appears in events.",
    "previewDrawing, narration, and summary must describe only what is actually returned in events. Do not mention discarded alternatives or ideas you decided not to draw.",
    "For stroke events, never return raw points arrays. Always return a standard SVG path string in svgPath.",
    "Use local scalable path coordinates, normally a 0 to 100 viewBox space. Control placement and size with gridCells, not pixel frames.",
    "Use only M, L, H, V, C, S, Q, T, and Z path commands. Do not use SVG arc commands A or a.",
    "Each stroke path should be one local contour or contour fragment, not a whole scene dump.",
    "To avoid overlapping the user's drawing, you MUST check the occupiedHumanCells provided in the payload. Do not place your gridCells inside the user's cells unless you are intentionally drawing a detail attached to their object, like smoke on a chimney.",
    'Control the size of your drawing by the number of grid cells you claim. A small bird might use [["A",2]]. A large house should use a block like [["J",10],["K",10],["J",11],["K",11]].',
    "Stay inside the canvas bounds.",
    "Choose colors adaptively from the provided palette based on what fits the drawing best.",
    "Use only colors from the provided palette.",
    "Match every stroke width and every shape outline width to the provided active ink width.",
    "Prefer a few coherent additions that fit the picture.",
    "Think in objects and object parts, not random marks.",
    "Prefer adding something that is not already explicitly present in the scene, as long as it fits the context.",
    "Good contextual additions include background details, ambient elements, supporting objects, weather, sky details, ground details, or small companion objects that make the scene feel more complete.",
    "Do not simply duplicate the exact subject already on the page unless repetition is natural for that kind of scene element.",
    "Use shape events when a circle, rectangle, triangle, trapezoid, or simple geometric form is cleaner than a stroke.",
    "For houses, roofs, buildings, windows, doors, and other structural objects, use transparent fill and draw the outline.",
    "Only use opaque fill for small accent shapes like a sun, berry, or tiny decorative detail.",
    "Choose 1 primary addition and, when the page is sparse and open, optionally add 1 secondary contextual or ambient detail.",
    "A normal turn should usually contain 1 to 4 coherent additions built from several local events.",
    "If the picture is sparse, you may add up to 5 related details, but they should still feel like one scene.",
    "If the page is sparse, do not limit yourself to touching only the existing object. It is often better to add one contextual element in the surrounding empty space, such as stars near a rocket, clouds near a boat, or grass near a house, when that improves the composition.",
    "Prefer 2 to 12 visual events, depending on the scene.",
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
    "thinking, narration, summary, and previewDrawing must stay consistent with the repaired events array.",
    "Fix malformed JSON, remove invalid events, and keep only drawable coherent events.",
    "Do not invent large new content. Prefer keeping fewer valid events over many questionable ones.",
    "For stroke events, keep svgPath as a valid standard SVG path string and express placement and size using gridCells instead of pixel frames.",
    "Use only M, L, H, V, C, S, Q, T, and Z path commands. Remove or rewrite any SVG arc commands A or a.",
    "Keep gridCells away from occupiedHumanCells unless the drawing is intentionally attached to the user's object.",
    "Prefer repaired plans that keep one clear primary addition and optionally one small contextual ambient detail if it fits the scene.",
    "For local objects like trees, chimneys, flowers, bushes, lamps, doors, and windows, avoid giant frames that span most of the page.",
    "For houses, roofs, and other structures, prefer outlined rectangle/triangle/trapezoid shapes with transparent fill.",
    "Remove or convert any large solid filled primitive blocks that would render as featureless slabs.",
    "Use only the allowed event types: stroke, shape, ascii_block, say, set_palette, comment_reply."
  ].join(" ");
}

function buildDrawRepairUserPayload(input: DrawRequest, rawPlan: string) {
  const occupiedHumanCells = dedupeGridCells(
    summarizeHumanContextGrid(input.humanDelta, input.canvasWidth, input.canvasHeight)
      .flatMap((entry) => entry.occupiedGridCells)
  ).map(semanticGridCellLabel);

  return JSON.stringify(
    {
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      occupiedHumanCells,
      palette: input.palette,
      activeInk: {
        width: input.activeStrokeSize
      },
      originalResponse: rawPlan
    },
    null,
    2
  );
}

function buildDrawUserPayload(input: DrawRequest) {
  const humanGridSummary = summarizeHumanContextGrid(
    input.humanDelta,
    input.canvasWidth,
    input.canvasHeight
  );
  const sceneBounds = getHumanSceneBounds(input);
  const sceneCoverage =
    (sceneBounds.width * sceneBounds.height) /
    Math.max(1, input.canvasWidth * input.canvasHeight);
  const unitScale = calculateUnitScale(
    input.humanDelta,
    input.canvasWidth,
    input.canvasHeight
  );
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
      semanticGrid: {
        columns: "A-L",
        rows: "1-12",
        occupiedHumanCells: dedupeGridCells(
          humanGridSummary.flatMap((entry) => entry.occupiedGridCells)
        ).map(semanticGridCellLabel)
      },
      occupiedHumanCells: dedupeGridCells(
        humanGridSummary.flatMap((entry) => entry.occupiedGridCells)
      ).map(semanticGridCellLabel),
      activeInk: {
        width: input.activeStrokeSize
      },
      scaleGuide: {
        averageWidth: Number(unitScale.averageWidth.toFixed(1)),
        averageHeight: Number(unitScale.averageHeight.toFixed(1)),
        unit: Number(unitScale.unit.toFixed(1))
      },
      pageContext: {
        sceneCoverage: Number(sceneCoverage.toFixed(3)),
        visualDensity:
          sceneCoverage < 0.12 ? "sparse" : sceneCoverage < 0.28 ? "medium" : "dense"
      },
      recentHumanGridMarks: humanGridSummary.map((entry) => ({
        kind: entry.kind,
        label: entry.label,
        occupiedGridCells: entry.occupiedGridCells.map(semanticGridCellLabel)
      })),
      recentAiMarks: input.aiDelta,
      palette: input.palette,
      comments: input.comments.slice(-6).map((comment) => ({
        id: comment.id,
        text: comment.text,
        gridCell: semanticGridCellLabel(
          pointToGridCell(comment.x, comment.y, input.canvasWidth, input.canvasHeight)
        ),
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
              text: targetComment.text,
              gridCell: semanticGridCellLabel(
                pointToGridCell(
                  targetComment.x,
                  targetComment.y,
                  input.canvasWidth,
                  input.canvasHeight
                )
              )
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
      return buildFallbackSceneAnalysis("The scene analysis request failed.");
    }
  }

  if (!rawAnalysis) {
    return buildFallbackSceneAnalysis();
  }

  console.info("[draw-ai] raw scene analysis", rawAnalysis.slice(0, 2000));

  try {
    return parseSceneAnalysis(rawAnalysis, input);
  } catch (error) {
    console.warn(
      "[draw-ai] scene analysis validation failed",
      error instanceof Error ? error.message : error
    );

    try {
      return sanitizeSceneAnalysis(JSON.parse(stripCodeFence(rawAnalysis)), input);
    } catch {
      return buildFallbackSceneAnalysis("The scene analysis could not be parsed safely.");
    }
  }
}
