import { z } from "zod";
import {
  compiledObjectPlanSchema,
  createId,
  drawRequestSchema,
  objectProposalSchema,
  renderHintSchema,
  sceneAnalysisSchema,
  type CompiledObjectAction,
  type CompiledObjectPlan,
  type ObjectBoundingBox,
  type ObjectProposal,
  type RenderHint,
  type SceneAnalysis
} from "@/lib/draw-types";

type DrawRequest = z.infer<typeof drawRequestSchema>;
type JsonObject = Record<string, unknown>;

export type CompiledObjectResult = {
  proposal: ObjectProposal;
  plan: CompiledObjectPlan;
  source: "model" | "fallback";
};

const renderHintValues = renderHintSchema.options;
const pointTupleSchema = z.tuple([z.number().finite(), z.number().finite()]);
const compiledActionSchema = z.object({
  tool: z.literal("brush"),
  color: z.string(),
  width: z.number().positive().max(24),
  opacity: z.number().min(0.05).max(1),
  points: z.array(pointTupleSchema).min(2).max(12),
  timing: z
    .object({
      speed: z.number().min(0.2).max(3).optional(),
      pauseAfterMs: z.number().int().min(0).max(1200).optional()
    })
    .optional()
});

const sceneAnalysisResponseSchema = z.object({
  scene: z.string().max(160),
  why: z.string().max(200),
  additions: z.array(objectProposalSchema).max(3)
});

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

function clampFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleEvery<T>(values: T[], maxCount: number) {
  if (values.length <= maxCount) {
    return values;
  }

  const sampled: T[] = [];
  const lastIndex = values.length - 1;
  for (let index = 0; index < maxCount; index += 1) {
    const sourceIndex = Math.round((index / Math.max(1, maxCount - 1)) * lastIndex);
    sampled.push(values[sourceIndex]);
  }

  return sampled;
}

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function normalizePaletteColor(color: unknown, palette: string[]) {
  if (typeof color === "string" && palette.includes(color)) {
    return color;
  }

  if (typeof color === "string" && palette.length > 0) {
    return palette[hashString(color) % palette.length];
  }

  return palette[0] ?? "#262523";
}

function normalizeTuplePoint(
  value: unknown,
  input: DrawRequest,
  fallbackX = input.canvasWidth * 0.5,
  fallbackY = input.canvasHeight * 0.5
) {
  if (Array.isArray(value) && value.length >= 2) {
    return [
      Math.round(clamp(clampFiniteNumber(value[0], fallbackX), 0, input.canvasWidth)),
      Math.round(clamp(clampFiniteNumber(value[1], fallbackY), 0, input.canvasHeight))
    ] as [number, number];
  }

  if (isJsonObject(value)) {
    return [
      Math.round(clamp(clampFiniteNumber(value.x, fallbackX), 0, input.canvasWidth)),
      Math.round(clamp(clampFiniteNumber(value.y, fallbackY), 0, input.canvasHeight))
    ] as [number, number];
  }

  return null;
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

function extractJsonNumberField(rawText: string, field: string) {
  const match = rawText.match(new RegExp(`"${field}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
  if (!match?.[1]) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function inferRenderHint(label: string, reason?: string): RenderHint {
  const text = `${label} ${reason ?? ""}`.toLowerCase();

  if (includesAny(text, ["chimney", "mailbox", "post", "window", "door", "fence", "trunk"])) {
    return "stacked_rect";
  }

  if (includesAny(text, ["smoke", "cloud", "steam", "mist", "bubble"])) {
    return "puff_chain";
  }

  if (includesAny(text, ["grass", "weed", "tuft", "reed"])) {
    return "tuft_cluster";
  }

  if (includesAny(text, ["bush", "shrub", "tree", "leaf", "foliage", "cloud"])) {
    return "oval_cluster";
  }

  if (includesAny(text, ["path", "road", "trail", "shadow", "river", "stream"])) {
    return "tapered_strip";
  }

  return "oval_cluster";
}

function normalizeRenderHint(value: unknown, label: string, reason?: string): RenderHint {
  if (typeof value === "string" && renderHintValues.includes(value as RenderHint)) {
    return value as RenderHint;
  }

  return inferRenderHint(label, reason);
}

function getDefaultDimensions(size: "small" | "medium" | "large") {
  switch (size) {
    case "small":
      return { width: 72, height: 72 };
    case "large":
      return { width: 180, height: 180 };
    default:
      return { width: 120, height: 120 };
  }
}

function normalizeObjectBoundingBox(
  value: unknown,
  input: DrawRequest,
  anchor: [number, number],
  size: "small" | "medium" | "large"
): ObjectBoundingBox {
  const defaults = getDefaultDimensions(size);

  let rawWidth = defaults.width;
  let rawHeight = defaults.height;
  let rawX = anchor[0] - rawWidth * 0.5;
  let rawY = anchor[1] - rawHeight * 0.5;

  if (isJsonObject(value)) {
    rawWidth = clamp(clampFiniteNumber(value.width, rawWidth), 32, input.canvasWidth * 0.6);
    rawHeight = clamp(clampFiniteNumber(value.height, rawHeight), 32, input.canvasHeight * 0.6);
    rawX = clampFiniteNumber(value.x, rawX);
    rawY = clampFiniteNumber(value.y, rawY);
  }

  const width = Math.round(rawWidth);
  const height = Math.round(rawHeight);

  return {
    x: Math.round(clamp(rawX, 0, Math.max(0, input.canvasWidth - width))),
    y: Math.round(clamp(rawY, 0, Math.max(0, input.canvasHeight - height))),
    width,
    height
  };
}

function normalizeObjectProposal(
  value: unknown,
  input: DrawRequest,
  index: number
): ObjectProposal | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const label =
    typeof value.label === "string" && value.label.trim()
      ? value.label.trim().slice(0, 80)
      : null;

  if (!label) {
    return null;
  }

  const size = value.size === "small" || value.size === "medium" || value.size === "large"
    ? value.size
    : "medium";

  const bboxCenterCandidate = isJsonObject(value.bbox)
    ? ([
        clampFiniteNumber(value.bbox.x, input.canvasWidth * 0.5) +
          clampFiniteNumber(value.bbox.width, 80) * 0.5,
        clampFiniteNumber(value.bbox.y, input.canvasHeight * 0.5) +
          clampFiniteNumber(value.bbox.height, 80) * 0.5
      ] as [number, number])
    : null;

  const rawAnchor =
    normalizeTuplePoint(value.anchor, input) ??
    (bboxCenterCandidate ? normalizeTuplePoint(bboxCenterCandidate, input) : null) ??
    normalizeTuplePoint([input.canvasWidth * 0.5, input.canvasHeight * 0.5], input) ??
    ([Math.round(input.canvasWidth * 0.5), Math.round(input.canvasHeight * 0.5)] as [number, number]);

  const bbox = normalizeObjectBoundingBox(value.bbox, input, rawAnchor, size);
  const anchor =
    normalizeTuplePoint(value.anchor, input, bbox.x + bbox.width * 0.5, bbox.y + bbox.height * 0.5) ??
    ([Math.round(bbox.x + bbox.width * 0.5), Math.round(bbox.y + bbox.height * 0.5)] as [number, number]);

  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 160)
      : `adds ${label.toLowerCase()} to the scene`;

  const proposal = {
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim().slice(0, 64)
        : createId(`obj-${index + 1}`),
    label,
    reason,
    anchor,
    bbox,
    size,
    priority: Math.round(clamp(clampFiniteNumber(value.priority, index + 1), 1, 9)),
    renderHint: normalizeRenderHint(value.renderHint, label, reason)
  };

  return objectProposalSchema.parse(proposal);
}

function extractRoot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { additions: value };
  }

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

  return value;
}

function sanitizeSceneAnalysis(value: unknown, input: DrawRequest): SceneAnalysis {
  const root = extractRoot(value);
  if (!isJsonObject(root)) {
    return sceneAnalysisSchema.parse({
      scene: "current sketch",
      why: "I could not read the scene reliably enough to propose a safe addition.",
      additions: []
    });
  }

  const rawAdditions = Array.isArray(root.additions)
    ? root.additions
    : Array.isArray(root.objects)
      ? root.objects
      : Array.isArray(root.proposals)
        ? root.proposals
        : [];

  return sceneAnalysisResponseSchema.parse({
    scene:
      typeof root.scene === "string" && root.scene.trim()
        ? root.scene.trim().slice(0, 160)
        : "current sketch",
    why:
      typeof root.why === "string" && root.why.trim()
        ? root.why.trim().slice(0, 200)
        : "it has room for a small related addition",
    additions: rawAdditions
      .map((item, index) => normalizeObjectProposal(item, input, index))
      .filter((item): item is ObjectProposal => item !== null)
      .slice(0, 3)
  });
}

function normalizeCompiledAction(
  value: unknown,
  input: DrawRequest
): CompiledObjectAction | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const toolValue = typeof value.tool === "string" ? value.tool : "brush";
  if (!["brush", "stroke", "pen", "pencil"].includes(toolValue)) {
    return null;
  }

  const rawPoints = Array.isArray(value.points)
    ? value.points
    : Array.isArray(value.path)
      ? value.path
      : [];

  const points = sampleEvery(
    rawPoints
      .map((point) => normalizeTuplePoint(point, input))
      .filter((point): point is [number, number] => point !== null),
    12
  );

  if (points.length < 2) {
    return null;
  }

  return compiledActionSchema.parse({
    tool: "brush",
    color: normalizePaletteColor(value.color, input.palette),
    width: clamp(clampFiniteNumber(value.width, 4), 1.5, 14),
    opacity: clamp(clampFiniteNumber(value.opacity, 0.92), 0.12, 1),
    points,
    timing: {
      speed: clamp(
        clampFiniteNumber(isJsonObject(value.timing) ? value.timing.speed : undefined, 1),
        0.45,
        2.2
      ),
      pauseAfterMs: Math.round(
        clamp(
          clampFiniteNumber(isJsonObject(value.timing) ? value.timing.pauseAfterMs : undefined, 90),
          0,
          700
        )
      )
    }
  });
}

function sanitizeCompiledObjectPlan(
  value: unknown,
  proposal: ObjectProposal,
  input: DrawRequest
): CompiledObjectPlan {
  const root = extractRoot(value);
  const rawActions = Array.isArray(root)
    ? root
    : isJsonObject(root) && Array.isArray(root.actions)
      ? root.actions
      : isJsonObject(root) && Array.isArray(root.strokes)
        ? root.strokes
        : [];

  return compiledObjectPlanSchema.parse({
    objectId: proposal.id,
    label: proposal.label,
    actions: rawActions
      .map((action) => normalizeCompiledAction(action, input))
      .filter((action): action is CompiledObjectAction => action !== null)
      .slice(0, 4)
  });
}

function getSegmentStats(points: [number, number][]) {
  let total = 0;
  let axisAligned = 0;
  let turns = 0;
  let shortSegments = 0;

  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index - 1];
    const [x2, y2] = points[index];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      continue;
    }

    total += 1;
    if (Math.abs(dx) < 4 || Math.abs(dy) < 4) {
      axisAligned += 1;
    }
    if (length < 28) {
      shortSegments += 1;
    }

    if (index >= 2) {
      const [px1, py1] = points[index - 2];
      const prevDx = x1 - px1;
      const prevDy = y1 - py1;
      const prevLength = Math.hypot(prevDx, prevDy);
      if (prevLength > 1) {
        const cosine = (dx * prevDx + dy * prevDy) / (length * prevLength);
        if (cosine < 0.94) {
          turns += 1;
        }
      }
    }
  }

  return {
    total,
    axisAlignedRatio: total > 0 ? axisAligned / total : 0,
    turnCount: turns,
    shortSegmentRatio: total > 0 ? shortSegments / total : 0
  };
}

function isClosedPolyline(points: [number, number][]) {
  if (points.length < 4) {
    return false;
  }

  const [startX, startY] = points[0];
  const [endX, endY] = points[points.length - 1];
  return Math.hypot(endX - startX, endY - startY) <= 16;
}

function getActionEndpoints(action: CompiledObjectAction) {
  const first = action.points[0];
  const last = action.points[action.points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy);

  return {
    first,
    last,
    length,
    nx: length > 0 ? dx / length : 0,
    ny: length > 0 ? dy / length : 0
  };
}

function isFragmentedPolyline(actions: CompiledObjectAction[]) {
  if (actions.length < 5) {
    return false;
  }

  const base = getActionEndpoints(actions[0]);
  if (base.length < 18) {
    return false;
  }

  let alignedCount = 0;
  let chainedCount = 0;
  let matchingStyleCount = 0;

  for (let index = 0; index < actions.length; index += 1) {
    const current = actions[index];
    const currentVector = getActionEndpoints(current);

    if (
      current.color === actions[0].color &&
      Math.abs(current.width - actions[0].width) <= 1.5
    ) {
      matchingStyleCount += 1;
    }

    const alignment = currentVector.nx * base.nx + currentVector.ny * base.ny;
    if (alignment > 0.985) {
      alignedCount += 1;
    }

    if (index > 0) {
      const previous = getActionEndpoints(actions[index - 1]);
      const chainDistance = Math.hypot(
        currentVector.first[0] - previous.last[0],
        currentVector.first[1] - previous.last[1]
      );
      if (chainDistance <= 20) {
        chainedCount += 1;
      }
    }
  }

  return (
    matchingStyleCount >= actions.length - 1 &&
    alignedCount >= actions.length - 1 &&
    chainedCount >= actions.length - 2
  );
}

function getActionsBounds(actions: CompiledObjectAction[]): ObjectBoundingBox | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const action of actions) {
    for (const [x, y] of action.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function boxesOverlap(a: ObjectBoundingBox, b: ObjectBoundingBox) {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
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

    if (item.kind === "shape") {
      pushPoint(item.x - item.width * 0.5, item.y - item.height * 0.5);
      pushPoint(item.x + item.width * 0.5, item.y + item.height * 0.5);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
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

function requiresEdgeContact(proposal: ObjectProposal) {
  const text = `${proposal.label} ${proposal.reason}`.toLowerCase();
  return includesAny(text, [
    "chimney",
    "antenna",
    "roof",
    "door",
    "window",
    "path",
    "walkway",
    "trail",
    "road",
    "fence",
    "mailbox",
    "post"
  ]);
}

function touchesProposalEdge(bounds: ObjectBoundingBox, proposal: ObjectProposal) {
  const tolerance = Math.round(
    clamp(Math.min(proposal.bbox.width, proposal.bbox.height) * 0.18, 10, 22)
  );

  const leftDistance = Math.abs(bounds.x - proposal.bbox.x);
  const rightDistance = Math.abs(bounds.x + bounds.width - (proposal.bbox.x + proposal.bbox.width));
  const topDistance = Math.abs(bounds.y - proposal.bbox.y);
  const bottomDistance = Math.abs(bounds.y + bounds.height - (proposal.bbox.y + proposal.bbox.height));

  return (
    leftDistance <= tolerance ||
    rightDistance <= tolerance ||
    topDistance <= tolerance ||
    bottomDistance <= tolerance
  );
}

function validateRenderHintStructure(
  actions: CompiledObjectAction[],
  proposal: ObjectProposal
) {
  const bounds = getActionsBounds(actions);
  if (!bounds) {
    return "compiled object has no drawable bounds";
  }

  const stats = actions
    .map((action) => getSegmentStats(action.points))
    .reduce(
      (aggregate, next) => ({
        total: aggregate.total + next.total,
        axisAlignedRatio:
          aggregate.total + next.total > 0
            ? (aggregate.axisAlignedRatio * aggregate.total + next.axisAlignedRatio * next.total) /
              (aggregate.total + next.total)
            : 0,
        turnCount: aggregate.turnCount + next.turnCount,
        shortSegmentRatio:
          aggregate.total + next.total > 0
            ? (aggregate.shortSegmentRatio * aggregate.total + next.shortSegmentRatio * next.total) /
              (aggregate.total + next.total)
            : 0
      }),
      { total: 0, axisAlignedRatio: 0, turnCount: 0, shortSegmentRatio: 0 }
    );

  switch (proposal.renderHint) {
    case "stacked_rect":
      if (!actions.some((action) => action.points.length >= 4)) {
        return "stacked_rect needs at least one box-like action";
      }
      if (stats.axisAlignedRatio < 0.55) {
        return "stacked_rect is not axis-aligned enough";
      }
      if (!actions.some((action) => isClosedPolyline(action.points))) {
        return "stacked_rect needs at least one closed loop";
      }
      return null;
    case "puff_chain":
    case "oval_cluster":
      if (actions.length < 2 && stats.turnCount < 1) {
        return `${proposal.renderHint} needs curved local geometry`;
      }
      return null;
    case "tuft_cluster":
      if (actions.length < 2 && stats.shortSegmentRatio < 0.6) {
        return "tuft_cluster needs clustered short strokes";
      }
      return null;
    case "tapered_strip": {
      const aspect = bounds.width / bounds.height;
      if (aspect < 1.3 && aspect > 0.77) {
        return "tapered_strip needs an elongated local shape";
      }
      return null;
    }
    default:
      return null;
  }
}

function validateCompiledPlan(
  plan: CompiledObjectPlan,
  proposal: ObjectProposal,
  input: DrawRequest
) {
  if (plan.actions.length === 0) {
    return { ok: false as const, reason: "compiled object returned no actions" };
  }

  const padding = Math.round(clamp(Math.max(proposal.bbox.width, proposal.bbox.height) * 0.18, 12, 40));
  const expanded = {
    x: proposal.bbox.x - padding,
    y: proposal.bbox.y - padding,
    width: proposal.bbox.width + padding * 2,
    height: proposal.bbox.height + padding * 2
  };

  for (const action of plan.actions) {
    for (const [x, y] of action.points) {
      if (
        x < expanded.x ||
        x > expanded.x + expanded.width ||
        y < expanded.y ||
        y > expanded.y + expanded.height
      ) {
        return { ok: false as const, reason: "compiled object strays outside its bbox" };
      }
    }
  }

  const bounds = getActionsBounds(plan.actions);
  if (!bounds || !boxesOverlap(bounds, proposal.bbox)) {
    return { ok: false as const, reason: "compiled object does not overlap its declared bbox" };
  }

  if (bounds.width > proposal.bbox.width * 2.2 || bounds.height > proposal.bbox.height * 2.2) {
    return { ok: false as const, reason: "compiled object extends too far beyond its local area" };
  }

  if (isFragmentedPolyline(plan.actions)) {
    return { ok: false as const, reason: "compiled object is a fragmented chained polyline" };
  }

  const hintReason = validateRenderHintStructure(plan.actions, proposal);
  if (hintReason) {
    return { ok: false as const, reason: hintReason };
  }

  if (requiresEdgeContact(proposal) && !touchesProposalEdge(bounds, proposal)) {
    return { ok: false as const, reason: "attached object does not meet a bbox edge" };
  }

  const attachmentReason = validateAttachmentToHumanDrawing(bounds, proposal, input);
  if (attachmentReason) {
    return { ok: false as const, reason: attachmentReason };
  }

  return { ok: true as const };
}

function pickRenderHintColor(renderHint: RenderHint, palette: string[]) {
  switch (renderHint) {
    case "tuft_cluster":
      return palette[4] ?? palette[2] ?? palette[0] ?? "#262523";
    case "tapered_strip":
      return palette[3] ?? palette[0] ?? "#262523";
    default:
      return palette[0] ?? "#262523";
  }
}

function adjustFallbackBoundingBox(
  proposal: ObjectProposal,
  input: DrawRequest
) {
  const bounds = extractHumanBounds(input);
  if (!bounds) {
    return proposal.bbox;
  }

  const labelText = `${proposal.label} ${proposal.reason}`.toLowerCase();
  const width = proposal.bbox.width;
  const height = proposal.bbox.height;

  if (includesAny(labelText, ["chimney", "antenna", "roof"])) {
    const x = Math.round(bounds.minX + bounds.width * 0.62 - width * 0.5);
    const y = Math.round(bounds.minY + bounds.height * 0.22 - height);
    return {
      x: Math.round(clamp(x, 0, Math.max(0, input.canvasWidth - width))),
      y: Math.round(clamp(y, 0, Math.max(0, input.canvasHeight - height))),
      width,
      height
    };
  }

  if (includesAny(labelText, ["path", "walkway", "trail", "road"])) {
    const x = Math.round(bounds.minX + bounds.width * 0.45 - width * 0.5);
    const y = Math.round(bounds.maxY - height * 0.05);
    return {
      x: Math.round(clamp(x, 0, Math.max(0, input.canvasWidth - width))),
      y: Math.round(clamp(y, 0, Math.max(0, input.canvasHeight - height))),
      width,
      height
    };
  }

  if (includesAny(labelText, ["grass", "tuft", "weed", "flowers", "shrub", "bush"])) {
    return {
      x: Math.round(clamp(bounds.minX - 12, 0, input.canvasWidth)),
      y: Math.round(clamp(bounds.maxY - 18, 0, input.canvasHeight)),
      width: Math.round(clamp(bounds.width + 24, 40, input.canvasWidth)),
      height: Math.round(clamp(height, 24, 90))
    };
  }

  if (includesAny(labelText, ["cloud", "smoke", "sun", "moon", "star"])) {
    const x = Math.round(proposal.anchor[0] - width * 0.5);
    const y = Math.round(bounds.minY - height - 16);
    return {
      x: Math.round(clamp(x, 0, Math.max(0, input.canvasWidth - width))),
      y: Math.round(clamp(y, 0, Math.max(0, input.canvasHeight - height))),
      width,
      height
    };
  }

  return proposal.bbox;
}

function contextualizeProposal(
  proposal: ObjectProposal,
  input: DrawRequest
): ObjectProposal {
  const bounds = extractHumanBounds(input);
  if (!bounds) {
    return proposal;
  }

  const text = `${proposal.label} ${proposal.reason}`.toLowerCase();
  const width = proposal.bbox.width;
  const height = proposal.bbox.height;
  let x = proposal.bbox.x;
  let y = proposal.bbox.y;

  if (includesAny(text, ["chimney", "antenna", "roof"])) {
    const desiredBottom = bounds.minY + bounds.height * 0.24;
    const desiredCenterX = clamp(
      proposal.anchor[0],
      bounds.minX + width * 0.4,
      bounds.maxX - width * 0.4
    );
    x = Math.round(desiredCenterX - width * 0.5);
    y = Math.round(desiredBottom - height);
  } else if (includesAny(text, ["path", "walkway", "trail", "road"])) {
    const desiredTop = bounds.maxY - height * 0.06;
    const desiredCenterX = clamp(
      proposal.anchor[0],
      bounds.minX + width * 0.4,
      bounds.maxX - width * 0.4
    );
    x = Math.round(desiredCenterX - width * 0.5);
    y = Math.round(desiredTop);
  } else if (includesAny(text, ["door", "window"])) {
    const desiredCenterX = clamp(
      proposal.anchor[0],
      bounds.minX + width * 0.5,
      bounds.maxX - width * 0.5
    );
    const desiredCenterY = clamp(
      proposal.anchor[1],
      bounds.minY + height * 0.8,
      bounds.maxY - height * 0.5
    );
    x = Math.round(desiredCenterX - width * 0.5);
    y = Math.round(desiredCenterY - height * 0.5);
  }

  const bbox = {
    x: Math.round(clamp(x, 0, Math.max(0, input.canvasWidth - width))),
    y: Math.round(clamp(y, 0, Math.max(0, input.canvasHeight - height))),
    width,
    height
  };

  return objectProposalSchema.parse({
    ...proposal,
    bbox,
    anchor: [
      Math.round(bbox.x + bbox.width * 0.5),
      Math.round(bbox.y + bbox.height * 0.5)
    ] as [number, number]
  });
}

function validateAttachmentToHumanDrawing(
  bounds: ObjectBoundingBox,
  proposal: ObjectProposal,
  input: DrawRequest
) {
  const humanBounds = extractHumanBounds(input);
  if (!humanBounds) {
    return null;
  }

  const text = `${proposal.label} ${proposal.reason}`.toLowerCase();
  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;

  if (includesAny(text, ["chimney", "antenna", "roof"])) {
    const minBottom = humanBounds.minY + humanBounds.height * 0.1;
    const maxBottom = humanBounds.minY + humanBounds.height * 0.4;
    if (bottom < minBottom || bottom > maxBottom) {
      return "top attachment does not meet the roof band";
    }
    if (centerX < humanBounds.minX || centerX > humanBounds.maxX) {
      return "top attachment is outside the drawing span";
    }
    return null;
  }

  if (includesAny(text, ["path", "walkway", "trail", "road"])) {
    const minTop = humanBounds.maxY - humanBounds.height * 0.18;
    const maxTop = humanBounds.maxY + humanBounds.height * 0.1;
    if (top < minTop || top > maxTop) {
      return "ground attachment is not connected near the base of the drawing";
    }
    if (
      centerX < humanBounds.minX - humanBounds.width * 0.15 ||
      centerX > humanBounds.maxX + humanBounds.width * 0.15
    ) {
      return "ground attachment is outside the drawing span";
    }
    return null;
  }

  if (includesAny(text, ["door", "window"])) {
    if (
      centerX < humanBounds.minX ||
      centerX > humanBounds.maxX ||
      centerY < humanBounds.minY + humanBounds.height * 0.15 ||
      centerY > humanBounds.maxY
    ) {
      return "interior attachment falls outside the main drawing body";
    }
  }

  return null;
}

function buildRenderHintFallbackPlan(
  proposal: ObjectProposal,
  input: DrawRequest
): CompiledObjectPlan | null {
  const color = pickRenderHintColor(proposal.renderHint, input.palette);
  const adjustedBox = adjustFallbackBoundingBox(proposal, input);
  const { x, y, width, height } = adjustedBox;
  const left = Math.round(x);
  const top = Math.round(y);
  const right = Math.round(x + width);
  const bottom = Math.round(y + height);
  const centerX = Math.round(x + width * 0.5);
  const centerY = Math.round(y + height * 0.5);

  let actions: CompiledObjectAction[] = [];

  switch (proposal.renderHint) {
    case "stacked_rect":
      actions = [
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 4,
          opacity: 0.92,
          points: [
            [left + Math.round(width * 0.24), bottom],
            [left + Math.round(width * 0.24), top + Math.round(height * 0.08)],
            [right - Math.round(width * 0.24), top + Math.round(height * 0.08)],
            [right - Math.round(width * 0.24), bottom],
            [left + Math.round(width * 0.24), bottom]
          ],
          timing: { speed: 1, pauseAfterMs: 80 }
        })
      ];
      break;
    case "puff_chain":
      actions = [
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 3,
          opacity: 0.72,
          points: [
            [left + Math.round(width * 0.2), centerY],
            [left + Math.round(width * 0.34), top + Math.round(height * 0.12)],
            [left + Math.round(width * 0.5), centerY - Math.round(height * 0.12)],
            [left + Math.round(width * 0.66), top + Math.round(height * 0.08)],
            [right - Math.round(width * 0.18), centerY]
          ],
          timing: { speed: 1.05, pauseAfterMs: 70 }
        }),
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 3,
          opacity: 0.56,
          points: [
            [left + Math.round(width * 0.28), centerY + Math.round(height * 0.08)],
            [left + Math.round(width * 0.44), centerY - Math.round(height * 0.08)],
            [left + Math.round(width * 0.6), centerY + Math.round(height * 0.04)],
            [right - Math.round(width * 0.22), centerY - Math.round(height * 0.06)]
          ],
          timing: { speed: 1.1, pauseAfterMs: 90 }
        })
      ];
      break;
    case "tuft_cluster":
      actions = [0.18, 0.38, 0.58, 0.78].map((offset) =>
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 3,
          opacity: 0.88,
          points: [
            [Math.round(left + width * offset), bottom],
            [Math.round(left + width * (offset - 0.04)), centerY + Math.round(height * 0.08)],
            [Math.round(left + width * offset), top + Math.round(height * 0.12)]
          ],
          timing: { speed: 1.15, pauseAfterMs: 40 }
        })
      );
      break;
    case "oval_cluster":
      actions = [
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 3,
          opacity: 0.78,
          points: [
            [left + Math.round(width * 0.18), centerY],
            [left + Math.round(width * 0.34), top + Math.round(height * 0.12)],
            [left + Math.round(width * 0.5), centerY],
            [left + Math.round(width * 0.34), bottom - Math.round(height * 0.12)],
            [left + Math.round(width * 0.18), centerY]
          ],
          timing: { speed: 1.05, pauseAfterMs: 70 }
        }),
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 3,
          opacity: 0.78,
          points: [
            [centerX, centerY],
            [left + Math.round(width * 0.66), top + Math.round(height * 0.1)],
            [right - Math.round(width * 0.14), centerY],
            [left + Math.round(width * 0.66), bottom - Math.round(height * 0.12)],
            [centerX, centerY]
          ],
          timing: { speed: 1.05, pauseAfterMs: 90 }
        })
      ];
      break;
    case "tapered_strip":
      actions = [
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 4,
          opacity: 0.84,
          points: [
            [centerX - Math.round(width * 0.18), bottom],
            [centerX - Math.round(width * 0.08), centerY],
            [centerX - Math.round(width * 0.03), top]
          ],
          timing: { speed: 1, pauseAfterMs: 60 }
        }),
        compiledActionSchema.parse({
          tool: "brush",
          color,
          width: 4,
          opacity: 0.72,
          points: [
            [centerX + Math.round(width * 0.18), bottom],
            [centerX + Math.round(width * 0.08), centerY],
            [centerX + Math.round(width * 0.03), top]
          ],
          timing: { speed: 1, pauseAfterMs: 80 }
        })
      ];
      break;
  }

  if (actions.length === 0) {
    return null;
  }

  return compiledObjectPlanSchema.parse({
    objectId: proposal.id,
    label: proposal.label,
    actions
  });
}

function buildAnalysisSystemPrompt(input: DrawRequest) {
  return [
    "You analyze a live whiteboard drawing and decide what specific objects to add next.",
    "Return only strict JSON.",
    'Return exactly this shape: {"scene":"simple scene description","why":"why the scene reads this way","additions":[{"id":"obj_1","label":"chimney","reason":"adds a lived-in roof detail","anchor":[520,270],"bbox":{"x":500,"y":220,"width":50,"height":70},"size":"small","priority":1,"renderHint":"stacked_rect"}]}.',
    "Do not return markdown or prose outside JSON.",
    "Propose at most 3 additions.",
    "Use open object labels. Do not use generic labels like detail or accent.",
    "Only propose additions that are relevant to the identified scene and local enough to draw as a few brush actions.",
    "bbox.x and bbox.y are top-left coordinates.",
    `renderHint must be one of: ${renderHintValues.join(", ")}.`,
    "Choose additions that genuinely belong with the drawing, not abstract filler.",
    "For attached objects like chimneys, doors, windows, paths, and roof details, place the bbox so it physically touches the related existing structure.",
    "For ground objects like grass or shrubs, place the bbox along the lower edge of the existing drawing.",
    "For sky objects like smoke or clouds, place the bbox above the main drawing instead of on top of it.",
    input.mode === "comment"
      ? "If there is a target comment, prioritize one addition near that comment."
      : "If the canvas is sparse, prefer 2 additions. If it is dense, prefer 1 addition."
  ].join(" ");
}

function buildAnalysisRepairSystemPrompt() {
  return [
    "You repair malformed JSON for a scene analysis step.",
    "Return only strict JSON.",
    'The required shape is {"scene":"simple scene description","why":"why the scene reads this way","additions":[{"id":"obj_1","label":"chimney","reason":"adds a lived-in roof detail","anchor":[520,270],"bbox":{"x":500,"y":220,"width":50,"height":70},"size":"small","priority":1,"renderHint":"stacked_rect"}]}.',
    "Do not add explanations. If the source cannot be repaired, return an empty additions array."
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

function buildCompileSystemPrompt(proposal: ObjectProposal) {
  const hintInstructions: Record<RenderHint, string> = {
    stacked_rect: "Use mostly vertical and horizontal segments to form a compact boxy local object.",
    puff_chain: "Use 2 to 4 soft puff-like curved strokes clustered inside the bbox.",
    tuft_cluster: "Use several short clustered upward flicks or blades near the lower edge of the bbox.",
    oval_cluster: "Use 2 to 4 rounded loops or clustered curved marks inside the bbox.",
    tapered_strip: "Use 1 to 3 elongated strokes that narrow toward one end and stay local."
  };

  return [
    "You are drawing one object on a live whiteboard.",
    "Return only strict JSON.",
    'Return exactly this shape: {"objectId":"obj_1","label":"chimney","actions":[{"tool":"brush","color":"#262523","width":4,"opacity":0.9,"points":[[500,220],[500,280],[530,280],[530,220]],"timing":{"speed":1,"pauseAfterMs":90}}]}.',
    "Do not return markdown or prose outside JSON.",
    "Draw only the requested object, not the whole scene.",
    "Keep all geometry local to the given bbox.",
    "Use at most 4 actions and at most 12 points per action.",
    "Use sparse control points only. The renderer smooths between points.",
    "The object must look complete and immediately recognizable, not like an unfinished fragment.",
    proposal.renderHint === "stacked_rect"
      ? "For box-like objects, close the shape into a full loop instead of leaving it open."
      : "If the object is attached to something else, let it visibly meet the relevant bbox edge.",
    hintInstructions[proposal.renderHint]
  ].join(" ");
}

function buildCompileRepairSystemPrompt() {
  return [
    "You repair malformed JSON for a single-object drawing compile step.",
    "Return only strict JSON.",
    'The required shape is {"objectId":"obj_1","label":"chimney","actions":[{"tool":"brush","color":"#262523","width":4,"opacity":0.9,"points":[[500,220],[500,280],[530,280],[530,220]],"timing":{"speed":1,"pauseAfterMs":90}}]}.',
    "Do not add explanations. If the source cannot be repaired, return an empty actions array."
  ].join(" ");
}

function buildCompileUserPayload(
  input: DrawRequest,
  analysis: SceneAnalysis,
  proposal: ObjectProposal
) {
  return JSON.stringify(
    {
      scene: analysis.scene,
      sceneWhy: analysis.why,
      object: {
        id: proposal.id,
        label: proposal.label,
        reason: proposal.reason,
        anchor: proposal.anchor,
        bbox: proposal.bbox,
        size: proposal.size,
        renderHint: proposal.renderHint
      },
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      palette: input.palette
    },
    null,
    2
  );
}

function buildRepairUserPayload(rawResponse: string, extra: JsonObject) {
  return JSON.stringify(
    {
      instructions: "Repair this into strict JSON.",
      ...extra,
      originalResponse: rawResponse
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
    | {
        text: string;
      }
    | {
        inlineData: {
          mimeType: string;
          data: string;
        };
      }
  > = [
    {
      text: options.userText
    }
  ];

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
          parts: [
            {
              text: options.systemText
            }
          ]
        },
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          responseMimeType: "application/json",
          maxOutputTokens: options.maxOutputTokens ?? 2048
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
    throw new Error(
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

function parseCompiledObjectPlan(
  rawText: string,
  proposal: ObjectProposal,
  input: DrawRequest
): CompiledObjectPlan {
  const parsed = JSON.parse(stripCodeFence(rawText));
  return sanitizeCompiledObjectPlan(parsed, proposal, input);
}

function buildFallbackSceneAnalysis(): SceneAnalysis {
  return sceneAnalysisSchema.parse({
    scene: "current sketch",
    why: "I could not read the scene reliably enough to propose a safe local addition.",
    additions: []
  });
}

export async function analyzeScene(input: DrawRequest): Promise<SceneAnalysis> {
  const gemini = getGeminiConfig();
  if (!gemini) {
    console.info("[draw-ai] Gemini not configured; using empty scene analysis");
    return buildFallbackSceneAnalysis();
  }

  try {
    const rawAnalysis = await callGeminiJson({
      gemini,
      systemText: buildAnalysisSystemPrompt(input),
      userText: buildAnalysisUserPayload(input),
      imageDataUrl: input.snapshotBase64,
      temperature: 0.16,
      maxOutputTokens: 4096
    });

    console.info("[draw-ai] raw scene analysis response", rawAnalysis.slice(0, 1200));

    try {
      const analysis = parseSceneAnalysis(rawAnalysis, input);
      console.info("[draw-ai] scene analysis accepted", {
        scene: analysis.scene,
        additionCount: analysis.additions.length
      });
      return analysis;
    } catch (error) {
      console.warn(
        "[draw-ai] scene analysis validation failed",
        error instanceof Error ? error.message : error
      );
    }

    console.info("[draw-ai] attempting scene analysis repair");
    const repaired = await callGeminiJson({
      gemini,
      systemText: buildAnalysisRepairSystemPrompt(),
      userText: buildRepairUserPayload(rawAnalysis, {
        canvas: {
          width: input.canvasWidth,
          height: input.canvasHeight
        },
        renderHints: renderHintValues
      }),
      temperature: 0,
      maxOutputTokens: 2048
    });

    console.info("[draw-ai] raw scene analysis repair response", repaired.slice(0, 1200));

    try {
      const analysis = parseSceneAnalysis(repaired, input);
      console.info("[draw-ai] repaired scene analysis accepted", {
        scene: analysis.scene,
        additionCount: analysis.additions.length
      });
      return analysis;
    } catch (repairError) {
      console.warn(
        "[draw-ai] scene analysis repair failed",
        repairError instanceof Error ? repairError.message : repairError
      );

      return sceneAnalysisSchema.parse({
        scene: extractJsonStringField(repaired, "scene") ?? extractJsonStringField(rawAnalysis, "scene") ?? "current sketch",
        why:
          extractJsonStringField(repaired, "why") ??
          extractJsonStringField(rawAnalysis, "why") ??
          "I could not read the scene reliably enough to propose a safe local addition.",
        additions: []
      });
    }
  } catch (error) {
    console.error(
      "[draw-ai] scene analysis request failed",
      error instanceof Error ? error.message : error
    );
    return buildFallbackSceneAnalysis();
  }
}

function salvageCompiledActions(
  rawText: string,
  proposal: ObjectProposal,
  input: DrawRequest
): CompiledObjectPlan {
  const actionsKeyIndex = rawText.indexOf('"actions"');
  if (actionsKeyIndex < 0) {
    return compiledObjectPlanSchema.parse({
      objectId: proposal.id,
      label: proposal.label,
      actions: []
    });
  }

  const arrayStart = rawText.indexOf("[", actionsKeyIndex);
  if (arrayStart < 0) {
    return compiledObjectPlanSchema.parse({
      objectId: proposal.id,
      label: proposal.label,
      actions: []
    });
  }

  const salvaged: CompiledObjectAction[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < rawText.length; index += 1) {
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

    if (char === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const parsed = JSON.parse(rawText.slice(objectStart, index + 1));
          const normalized = normalizeCompiledAction(parsed, input);
          if (normalized) {
            salvaged.push(normalized);
          }
        } catch {
          // Ignore malformed partial action objects.
        }
        objectStart = -1;
      }
      continue;
    }

    if (char === "]" && depth === 0) {
      break;
    }
  }

  return compiledObjectPlanSchema.parse({
    objectId: proposal.id,
    label: proposal.label,
    actions: salvaged.slice(0, 4)
  });
}

export async function compileObjectDrawing(
  input: DrawRequest,
  analysis: SceneAnalysis,
  proposal: ObjectProposal
): Promise<CompiledObjectResult | null> {
  const gemini = getGeminiConfig();
  const contextualProposal = contextualizeProposal(proposal, input);

  const fallbackPlan = buildRenderHintFallbackPlan(contextualProposal, input);

  if (!gemini) {
    if (fallbackPlan) {
      console.info("[draw-ai] Gemini not configured; using render-hint fallback", {
        object: contextualProposal.label,
        renderHint: contextualProposal.renderHint
      });
      return {
        proposal: contextualProposal,
        plan: fallbackPlan,
        source: "fallback"
      };
    }

    return null;
  }

  const tryValidate = (plan: CompiledObjectPlan) => {
    const validation = validateCompiledPlan(plan, contextualProposal, input);
    if (!validation.ok) {
      throw new Error(validation.reason);
    }
    return plan;
  };

  try {
    const rawCompile = await callGeminiJson({
      gemini,
      systemText: buildCompileSystemPrompt(contextualProposal),
      userText: buildCompileUserPayload(input, analysis, contextualProposal),
      imageDataUrl: input.snapshotBase64,
      temperature: 0.14,
      maxOutputTokens: 2048
    });

    console.info("[draw-ai] raw object compile response", {
      object: contextualProposal.label,
      response: rawCompile.slice(0, 1200)
    });

    try {
      const compiled = tryValidate(parseCompiledObjectPlan(rawCompile, contextualProposal, input));
      console.info("[draw-ai] object compile accepted", {
        object: contextualProposal.label,
        actionCount: compiled.actions.length
      });
      return {
        proposal: contextualProposal,
        plan: compiled,
        source: "model"
      };
    } catch (error) {
      try {
        const salvaged = salvageCompiledActions(rawCompile, contextualProposal, input);
        if (salvaged.actions.length > 0) {
          const compiled = tryValidate(salvaged);
          console.info("[draw-ai] salvaged partial object compile", {
            object: contextualProposal.label,
            actionCount: compiled.actions.length
          });
          return {
            proposal: contextualProposal,
            plan: compiled,
            source: "model"
          };
        }
      } catch {
        // Continue to repair/fallback.
      }

      console.warn(
        "[draw-ai] object compile validation failed",
        contextualProposal.label,
        error instanceof Error ? error.message : error
      );
    }

    console.info("[draw-ai] attempting object compile repair", {
      object: contextualProposal.label
    });
    const repaired = await callGeminiJson({
      gemini,
      systemText: buildCompileRepairSystemPrompt(),
      userText: buildRepairUserPayload(rawCompile, {
        scene: analysis.scene,
        object: contextualProposal,
        canvas: {
          width: input.canvasWidth,
          height: input.canvasHeight
        }
      }),
      temperature: 0,
      maxOutputTokens: 1536
    });

    console.info("[draw-ai] raw object compile repair response", {
      object: contextualProposal.label,
      response: repaired.slice(0, 1200)
    });

    try {
      const compiled = tryValidate(parseCompiledObjectPlan(repaired, contextualProposal, input));
      console.info("[draw-ai] repaired object compile accepted", {
        object: contextualProposal.label,
        actionCount: compiled.actions.length
      });
      return {
        proposal: contextualProposal,
        plan: compiled,
        source: "model"
      };
    } catch (repairError) {
      console.warn(
        "[draw-ai] object compile repair failed",
        contextualProposal.label,
        repairError instanceof Error ? repairError.message : repairError
      );
    }
  } catch (error) {
    console.error(
      "[draw-ai] object compile request failed",
      contextualProposal.label,
      error instanceof Error ? error.message : error
    );
  }

  if (fallbackPlan) {
    console.info("[draw-ai] using render-hint fallback", {
      object: contextualProposal.label,
      renderHint: contextualProposal.renderHint
    });
    return {
      proposal: contextualProposal,
      plan: fallbackPlan,
      source: "fallback"
    };
  }

  console.info("[draw-ai] skipping object with no valid compile or fallback", {
    object: contextualProposal.label
  });
  return null;
}
