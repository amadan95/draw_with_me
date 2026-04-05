import {
  type CommentThread,
  type HumanStroke,
  type PersistedAsciiBlock,
  type PersistedShapeElement,
  type Point,
  type RenderableElement,
  type DrawingSyncState
} from "@/lib/draw/elements";
import { PAPER_COLOR } from "@/lib/draw/shared";
import { getShapeBounds, pointsToPathData, shapeToPathData } from "@/lib/draw/shapes";

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finalizeBounds(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function estimateAsciiBounds(block: PersistedAsciiBlock): Bounds {
  const lines = block.text.split("\n");
  const estimatedWidth =
    block.width ??
    Math.max(...lines.map((line) => Math.max(1, line.length) * block.fontSize * 0.62));
  const estimatedHeight = lines.length * block.fontSize * 1.02;

  return finalizeBounds(
    block.x,
    block.y - block.fontSize * 0.2,
    block.x + estimatedWidth,
    block.y + estimatedHeight
  );
}

export function humanStrokeToPathData(stroke: HumanStroke) {
  return pointsToPathData(
    stroke.points.map((point) => [point.x, point.y] as [number, number]),
    false
  );
}

export function getBoardBounds(options: {
  humanStrokes: HumanStroke[];
  drawingElements: PersistedShapeElement[];
  asciiBlocks: PersistedAsciiBlock[];
  comments?: CommentThread[];
  currentStroke?: HumanStroke | null;
  padding?: number;
  minWidth?: number;
  minHeight?: number;
}): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const include = (x: number, y: number, radius = 0) => {
    minX = Math.min(minX, x - radius);
    minY = Math.min(minY, y - radius);
    maxX = Math.max(maxX, x + radius);
    maxY = Math.max(maxY, y + radius);
  };

  const includeStroke = (stroke: HumanStroke) => {
    const radius = Math.max(2, stroke.size);
    for (const point of stroke.points) {
      include(point.x, point.y, radius);
    }
  };

  for (const stroke of options.humanStrokes) {
    includeStroke(stroke);
  }

  if (options.currentStroke) {
    includeStroke(options.currentStroke);
  }

  for (const element of options.drawingElements) {
    const bounds = getShapeBounds(element.shape);
    include(bounds.minX, bounds.minY);
    include(bounds.maxX, bounds.maxY);
  }

  for (const block of options.asciiBlocks) {
    const bounds = estimateAsciiBounds(block);
    include(bounds.minX, bounds.minY);
    include(bounds.maxX, bounds.maxY);
  }

  for (const comment of options.comments ?? []) {
    include(comment.x, comment.y, 26);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return finalizeBounds(0, 0, options.minWidth ?? 1, options.minHeight ?? 1);
  }

  const padding = options.padding ?? 0;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  let width = maxX - minX;
  let height = maxY - minY;
  const centerX = minX + width * 0.5;
  const centerY = minY + height * 0.5;
  width = Math.max(width, options.minWidth ?? width);
  height = Math.max(height, options.minHeight ?? height);

  return finalizeBounds(
    centerX - width * 0.5,
    centerY - height * 0.5,
    centerX + width * 0.5,
    centerY + height * 0.5
  );
}

export function worldToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y
  };
}

export function screenToWorld(point: Point, rect: DOMRect, viewport: Viewport): Point {
  return {
    x: (point.x - rect.left - viewport.x) / viewport.scale,
    y: (point.y - rect.top - viewport.y) / viewport.scale
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function renderHumanStrokeSvg(stroke: HumanStroke) {
  return `<path d="${humanStrokeToPathData(stroke)}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderShapeSvg(element: PersistedShapeElement) {
  const shape = element.shape;
  const stroke = "stroke" in shape ? shape.stroke ?? "#262523" : "#262523";
  const strokeWidth = "strokeWidth" in shape ? shape.strokeWidth ?? 3 : 3;
  const fill = "fill" in shape ? shape.fill ?? "transparent" : "transparent";
  const opacity = "opacity" in shape ? shape.opacity ?? 1 : 1;

  if (shape.kind === "erase") {
    return "";
  }

  if (shape.kind === "rect") {
    return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.rx ?? 0}" ry="${shape.ry ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
  }

  if (shape.kind === "circle") {
    return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
  }

  if (shape.kind === "ellipse") {
    return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" />`;
  }

  if (shape.kind === "line") {
    return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linecap="round" />`;
  }

  return `<path d="${shapeToPathData(shape)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round" />`;
}

function renderAsciiSvg(block: PersistedAsciiBlock) {
  const lines = block.text.split("\n");
  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? 0 : block.fontSize * 1.02;
      return `<tspan x="${block.x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  return `<text x="${block.x}" y="${block.y}" fill="${block.color}" font-size="${block.fontSize}" font-family="Caveat, monospace">${tspans}</text>`;
}

function renderEraserMask(
  humanStrokes: HumanStroke[],
  drawingElements: PersistedShapeElement[]
) {
  const extent = 100000;
  const maskPaths = [
    ...humanStrokes
      .filter((stroke) => stroke.tool === "erase")
      .map(
        (stroke) =>
          `<path d="${humanStrokeToPathData(stroke)}" fill="none" stroke="black" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" />`
      ),
    ...drawingElements
      .filter((element) => element.shape.kind === "erase")
      .map((element) => {
        const shape = element.shape;
        return `<path d="${shapeToPathData(shape)}" fill="none" stroke="black" stroke-width="${shape.strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
      })
  ].join("");

  return `<mask id="board-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${-extent}" y="${-extent}" width="${extent * 2}" height="${extent * 2}"><rect x="${-extent}" y="${-extent}" width="${extent * 2}" height="${extent * 2}" fill="white" />${maskPaths}</mask>`;
}

export function serializeBoardSvg(options: {
  width: number;
  height: number;
  translateX?: number;
  translateY?: number;
  humanStrokes: HumanStroke[];
  drawingElements: PersistedShapeElement[];
  asciiBlocks: PersistedAsciiBlock[];
  includeBackground?: boolean;
}) {
  const translation =
    options.translateX || options.translateY
      ? ` transform="translate(${options.translateX ?? 0} ${options.translateY ?? 0})"`
      : "";

  const visibleHumanStrokes = options.humanStrokes.filter((stroke) => stroke.tool !== "erase");
  const mask = renderEraserMask(options.humanStrokes, options.drawingElements);
  const body = [
    ...visibleHumanStrokes.map(renderHumanStrokeSvg),
    ...options.drawingElements.map(renderShapeSvg),
    ...options.asciiBlocks.map(renderAsciiSvg)
  ].join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">`,
    options.includeBackground === false
      ? ""
      : `<rect width="100%" height="100%" fill="${PAPER_COLOR}" />`,
    "<defs>",
    mask,
    "</defs>",
    `<g${translation} mask="url(#board-mask)">`,
    body,
    "</g>",
    "</svg>"
  ].join("");
}

export function getStrokeBounds(stroke: HumanStroke): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const radius = Math.max(2, stroke.size);
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x - radius);
    minY = Math.min(minY, point.y - radius);
    maxX = Math.max(maxX, point.x + radius);
    maxY = Math.max(maxY, point.y + radius);
  }

  if (!Number.isFinite(minX)) {
    return finalizeBounds(0, 0, 1, 1);
  }

  return finalizeBounds(minX, minY, maxX, maxY);
}

export function expandBounds(bounds: Bounds, padding: number): Bounds {
  return finalizeBounds(
    bounds.minX - padding,
    bounds.minY - padding,
    bounds.maxX + padding,
    bounds.maxY + padding
  );
}

export function mergeBounds(boundsList: Array<Bounds | null | undefined>): Bounds | null {
  const valid = boundsList.filter((bounds): bounds is Bounds => Boolean(bounds));
  if (valid.length === 0) {
    return null;
  }

  return finalizeBounds(
    Math.min(...valid.map((bounds) => bounds.minX)),
    Math.min(...valid.map((bounds) => bounds.minY)),
    Math.max(...valid.map((bounds) => bounds.maxX)),
    Math.max(...valid.map((bounds) => bounds.maxY))
  );
}

export function estimateCommentBounds(comment: CommentThread): Bounds {
  return finalizeBounds(comment.x - 32, comment.y - 32, comment.x + 32, comment.y + 32);
}

export type AttachmentCandidate = Bounds & {
  source: "humanStroke" | "shapeElement" | "asciiBlock" | "comment";
  id: string;
};

export function getAttachmentCandidates(options: {
  syncState?: DrawingSyncState | null;
  targetComment?: CommentThread | null;
  limit?: number;
}): AttachmentCandidate[] {
  const candidates: AttachmentCandidate[] = [];
  const limit = options.limit ?? 8;

  for (const stroke of options.syncState?.humanStrokes.slice(-limit) ?? []) {
    const bounds = getStrokeBounds(stroke);
    candidates.push({ ...bounds, source: "humanStroke", id: stroke.id });
  }

  for (const element of options.syncState?.drawingElements.slice(-limit) ?? []) {
    const bounds = getShapeBounds(element.shape);
    candidates.push({
      ...finalizeBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY),
      source: "shapeElement",
      id: element.id
    });
  }

  for (const block of options.syncState?.asciiBlocks.slice(-Math.max(2, Math.floor(limit / 2))) ?? []) {
    const bounds = estimateAsciiBounds(block);
    candidates.push({ ...bounds, source: "asciiBlock", id: block.id });
  }

  if (options.targetComment) {
    const bounds = estimateCommentBounds(options.targetComment);
    candidates.push({ ...bounds, source: "comment", id: options.targetComment.id });
  }

  return candidates.slice(-limit);
}

export function getActiveRegionBounds(options: {
  syncState?: DrawingSyncState | null;
  targetComment?: CommentThread | null;
  fallbackBounds: Bounds;
  padding?: number;
}): Bounds {
  const latestStroke = options.syncState?.humanStrokes.at(-1);
  const latestShape = options.syncState?.drawingElements.at(-1);
  const latestBlock = options.syncState?.asciiBlocks.at(-1);

  const merged = mergeBounds([
    latestStroke ? getStrokeBounds(latestStroke) : null,
    latestShape
      ? (() => {
          const bounds = getShapeBounds(latestShape.shape);
          return finalizeBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
        })()
      : null,
    latestBlock ? estimateAsciiBounds(latestBlock) : null,
    options.targetComment ? estimateCommentBounds(options.targetComment) : null
  ]);

  return expandBounds(merged ?? options.fallbackBounds, options.padding ?? 96);
}

export function splitRenderableElements(elements: RenderableElement[]) {
  return {
    humanStrokes: elements.filter(
      (element): element is HumanStroke => element.kind === "humanStroke"
    ),
    drawingElements: elements.filter(
      (element): element is PersistedShapeElement => element.kind === "shapeElement"
    ),
    asciiBlocks: elements.filter(
      (element): element is PersistedAsciiBlock => element.kind === "asciiBlock"
    )
  };
}
