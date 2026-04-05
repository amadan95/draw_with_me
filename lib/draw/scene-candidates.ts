import {
  type CommentThread,
  type DrawingSyncState,
  type HumanStroke,
  type PersistedAsciiBlock,
  type PersistedShapeElement
} from "@/lib/draw/elements";
import { getShapeBounds, type DrawShape, type PointTuple } from "@/lib/draw/shapes";
import {
  estimateCommentBounds,
  getStrokeBounds,
  type Bounds
} from "@/lib/draw/rendering";

type CandidateSource = "humanStroke" | "shapeElement" | "asciiBlock" | "comment";

export type CandidatePoint = {
  x: number;
  y: number;
};

export type CandidateEdgeHint = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  angle: number;
  length: number;
};

export type CandidateAnchorHints = {
  center: CandidatePoint;
  topEdge: CandidatePoint;
  bottomEdge: CandidatePoint;
  leftEdge: CandidatePoint;
  rightEdge: CandidatePoint;
  topLeftCorner: CandidatePoint;
  topRightCorner: CandidatePoint;
  bottomLeftCorner: CandidatePoint;
  bottomRightCorner: CandidatePoint;
  upperHalf: CandidatePoint;
  lowerHalf: CandidatePoint;
};

export type CandidateOrientationHints = {
  dominantAxis: "horizontal" | "vertical" | "diagonal" | "square";
  dominantAngle?: number;
  aspectRatio: number;
  hasRoofLikePeak?: boolean;
  hasClosedBody?: boolean;
};

export type AttachmentCandidate = Bounds & {
  id: string;
  source: CandidateSource;
  centroid: CandidatePoint;
  density: number;
  pointCount: number;
  recentRank: number;
  strokeCount?: number;
  shapeCount?: number;
  blockCount?: number;
  shapeKind?: DrawShape["kind"];
  label?: string;
  textLength?: number;
  edgeHints: {
    top: CandidateEdgeHint | null;
    right: CandidateEdgeHint | null;
    bottom: CandidateEdgeHint | null;
    left: CandidateEdgeHint | null;
  };
  anchorHints: CandidateAnchorHints;
  orientationHints: CandidateOrientationHints;
};

type CandidateDraft = Omit<AttachmentCandidate, "recentRank"> & {
  createdAt: number;
};

function clamp(value: number, min: number, max: number) {
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

function roundPoint(point: CandidatePoint): CandidatePoint {
  return {
    x: point.x,
    y: point.y
  };
}

function toPoint(point: PointTuple | CandidatePoint): CandidatePoint {
  return Array.isArray(point) ? { x: point[0], y: point[1] } : point;
}

function getPointDistance(a: CandidatePoint, b: CandidatePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getNearestPoint(points: CandidatePoint[], target: CandidatePoint) {
  if (points.length === 0) {
    return target;
  }

  return points.reduce((closest, point) => {
    return getPointDistance(point, target) < getPointDistance(closest, target)
      ? point
      : closest;
  }, points[0]);
}

function buildEdgeHint(start: CandidatePoint, end: CandidatePoint): CandidateEdgeHint {
  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    angle: Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI),
    length: Math.hypot(end.x - start.x, end.y - start.y)
  };
}

function getBoundsCenter(bounds: Bounds): CandidatePoint {
  return {
    x: bounds.minX + bounds.width * 0.5,
    y: bounds.minY + bounds.height * 0.5
  };
}

function sampleEllipsePoints(
  center: CandidatePoint,
  radiusX: number,
  radiusY: number,
  count = 12
) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY
    };
  });
}

function getStrokePoints(stroke: HumanStroke): CandidatePoint[] {
  return stroke.points.map((point) => ({
    x: point.x,
    y: point.y
  }));
}

function getShapePoints(shape: DrawShape): CandidatePoint[] {
  switch (shape.kind) {
    case "line":
      return [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 }
      ];
    case "curve":
    case "polygon":
    case "erase":
      return shape.points.map(toPoint);
    case "rect":
      return [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height }
      ];
    case "circle":
      return sampleEllipsePoints(
        { x: shape.cx, y: shape.cy },
        shape.r,
        shape.r
      );
    case "ellipse":
      return sampleEllipsePoints(
        { x: shape.cx, y: shape.cy },
        shape.rx,
        shape.ry
      );
    case "path":
      return [];
  }
}

function getAsciiBlockPoints(block: PersistedAsciiBlock): CandidatePoint[] {
  const bounds = estimateAsciiBounds(block);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY }
  ];
}

function getCommentPoints(comment: CommentThread): CandidatePoint[] {
  const bounds = estimateCommentBounds(comment);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
    { x: comment.x, y: comment.y }
  ];
}

function getOutlineBounds(points: CandidatePoint[], fallbackBounds: Bounds) {
  if (points.length === 0) {
    return fallbackBounds;
  }

  return finalizeBounds(
    Math.min(...points.map((point) => point.x)),
    Math.min(...points.map((point) => point.y)),
    Math.max(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.y))
  );
}

function getDensity(pointCount: number, bounds: Bounds) {
  const perimeter = Math.max(16, bounds.width + bounds.height);
  return clamp(pointCount / (perimeter * 0.18), 0.08, 1);
}

function getDominantAngle(points: CandidatePoint[], bounds: Bounds) {
  if (points.length >= 2) {
    const mean = points.reduce(
      (acc, point) => ({
        x: acc.x + point.x / points.length,
        y: acc.y + point.y / points.length
      }),
      { x: 0, y: 0 }
    );

    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const point of points) {
      const dx = point.x - mean.x;
      const dy = point.y - mean.y;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }

    if (sxx > 0 || syy > 0 || sxy !== 0) {
      return (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI;
    }
  }

  if (bounds.width > bounds.height * 1.25) {
    return 0;
  }
  if (bounds.height > bounds.width * 1.25) {
    return 90;
  }

  return undefined;
}

function getDominantAxis(aspectRatio: number, angle: number | undefined) {
  if (aspectRatio > 0.82 && aspectRatio < 1.22 && angle === undefined) {
    return "square" as const;
  }

  if (typeof angle === "number") {
    const normalized = Math.abs(((angle % 180) + 180) % 180);
    if (normalized < 18 || normalized > 162) {
      return "horizontal" as const;
    }
    if (normalized > 72 && normalized < 108) {
      return "vertical" as const;
    }
    return "diagonal" as const;
  }

  return aspectRatio >= 1 ? "horizontal" : "vertical";
}

function hasClosedBody(points: CandidatePoint[], bounds: Bounds, forceClosed = false) {
  if (forceClosed) {
    return true;
  }
  if (points.length < 4) {
    return false;
  }

  const diagonal = Math.max(12, Math.hypot(bounds.width, bounds.height));
  return getPointDistance(points[0], points[points.length - 1]) <= diagonal * 0.22;
}

function hasRoofLikePeak(points: CandidatePoint[], bounds: Bounds, centroid: CandidatePoint) {
  if (points.length < 3 || bounds.height < 18 || bounds.width < 18) {
    return false;
  }

  const peak = points.reduce((highest, point) => (point.y < highest.y ? point : highest), points[0]);
  const requiredDrop = Math.max(bounds.height * 0.18, 8);
  const leftSupport = points.some(
    (point) =>
      point.x < peak.x - bounds.width * 0.12 &&
      point.y > peak.y + requiredDrop
  );
  const rightSupport = points.some(
    (point) =>
      point.x > peak.x + bounds.width * 0.12 &&
      point.y > peak.y + requiredDrop
  );

  return leftSupport && rightSupport && peak.y < centroid.y - bounds.height * 0.12;
}

function getFallbackEdgeHint(bounds: Bounds, edge: "top" | "right" | "bottom" | "left") {
  switch (edge) {
    case "top":
      return buildEdgeHint(
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY }
      );
    case "right":
      return buildEdgeHint(
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY }
      );
    case "bottom":
      return buildEdgeHint(
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.maxX, y: bounds.maxY }
      );
    case "left":
      return buildEdgeHint(
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.minX, y: bounds.maxY }
      );
  }
}

function getEdgeBandPoints(
  points: CandidatePoint[],
  bounds: Bounds,
  edge: "top" | "right" | "bottom" | "left"
) {
  const bandX = Math.max(8, bounds.width * 0.18);
  const bandY = Math.max(8, bounds.height * 0.18);
  switch (edge) {
    case "top":
      return points.filter((point) => point.y <= bounds.minY + bandY);
    case "right":
      return points.filter((point) => point.x >= bounds.maxX - bandX);
    case "bottom":
      return points.filter((point) => point.y >= bounds.maxY - bandY);
    case "left":
      return points.filter((point) => point.x <= bounds.minX + bandX);
  }
}

function getEdgeHint(
  points: CandidatePoint[],
  bounds: Bounds,
  edge: "top" | "right" | "bottom" | "left"
): CandidateEdgeHint | null {
  const bandPoints = getEdgeBandPoints(points, bounds, edge);
  if (bandPoints.length < 2) {
    return getFallbackEdgeHint(bounds, edge);
  }

  if (edge === "top" || edge === "bottom") {
    const start = bandPoints.reduce((left, point) => (point.x < left.x ? point : left), bandPoints[0]);
    const end = bandPoints.reduce((right, point) => (point.x > right.x ? point : right), bandPoints[0]);
    return buildEdgeHint(start, end);
  }

  const start = bandPoints.reduce((top, point) => (point.y < top.y ? point : top), bandPoints[0]);
  const end = bandPoints.reduce((bottom, point) => (point.y > bottom.y ? point : bottom), bandPoints[0]);
  return buildEdgeHint(start, end);
}

function getAnchorHints(
  bounds: Bounds,
  edgeHints: AttachmentCandidate["edgeHints"],
  points: CandidatePoint[]
): CandidateAnchorHints {
  const center = getBoundsCenter(bounds);
  const topEdge = edgeHints.top
    ? {
        x: (edgeHints.top.x1 + edgeHints.top.x2) * 0.5,
        y: (edgeHints.top.y1 + edgeHints.top.y2) * 0.5
      }
    : { x: center.x, y: bounds.minY };
  const bottomEdge = edgeHints.bottom
    ? {
        x: (edgeHints.bottom.x1 + edgeHints.bottom.x2) * 0.5,
        y: (edgeHints.bottom.y1 + edgeHints.bottom.y2) * 0.5
      }
    : { x: center.x, y: bounds.maxY };
  const leftEdge = edgeHints.left
    ? {
        x: (edgeHints.left.x1 + edgeHints.left.x2) * 0.5,
        y: (edgeHints.left.y1 + edgeHints.left.y2) * 0.5
      }
    : { x: bounds.minX, y: center.y };
  const rightEdge = edgeHints.right
    ? {
        x: (edgeHints.right.x1 + edgeHints.right.x2) * 0.5,
        y: (edgeHints.right.y1 + edgeHints.right.y2) * 0.5
      }
    : { x: bounds.maxX, y: center.y };

  return {
    center: roundPoint(center),
    topEdge: roundPoint(topEdge),
    bottomEdge: roundPoint(bottomEdge),
    leftEdge: roundPoint(leftEdge),
    rightEdge: roundPoint(rightEdge),
    topLeftCorner: roundPoint(
      getNearestPoint(points, { x: bounds.minX, y: bounds.minY })
    ),
    topRightCorner: roundPoint(
      getNearestPoint(points, { x: bounds.maxX, y: bounds.minY })
    ),
    bottomLeftCorner: roundPoint(
      getNearestPoint(points, { x: bounds.minX, y: bounds.maxY })
    ),
    bottomRightCorner: roundPoint(
      getNearestPoint(points, { x: bounds.maxX, y: bounds.maxY })
    ),
    upperHalf: {
      x: center.x,
      y: bounds.minY + bounds.height * 0.3
    },
    lowerHalf: {
      x: center.x,
      y: bounds.minY + bounds.height * 0.7
    }
  };
}

function buildCandidate(options: {
  id: string;
  source: CandidateSource;
  createdAt: number;
  points: CandidatePoint[];
  fallbackBounds: Bounds;
  closedBody?: boolean;
  shapeKind?: DrawShape["kind"];
  label?: string;
  textLength?: number;
  strokeCount?: number;
  shapeCount?: number;
  blockCount?: number;
}): CandidateDraft | null {
  const bounds = getOutlineBounds(options.points, options.fallbackBounds);
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) || bounds.width < 1 || bounds.height < 1) {
    return null;
  }

  const centroid =
    options.points.length > 0
      ? options.points.reduce(
          (acc, point) => ({
            x: acc.x + point.x / options.points.length,
            y: acc.y + point.y / options.points.length
          }),
          { x: 0, y: 0 }
        )
      : getBoundsCenter(bounds);

  const edgeHints = {
    top: getEdgeHint(options.points, bounds, "top"),
    right: getEdgeHint(options.points, bounds, "right"),
    bottom: getEdgeHint(options.points, bounds, "bottom"),
    left: getEdgeHint(options.points, bounds, "left")
  };

  const aspectRatio = bounds.width / Math.max(bounds.height, 1);
  const dominantAngle = getDominantAngle(options.points, bounds);
  const orientationHints: CandidateOrientationHints = {
    dominantAxis: getDominantAxis(aspectRatio, dominantAngle),
    dominantAngle,
    aspectRatio,
    hasRoofLikePeak: hasRoofLikePeak(options.points, bounds, centroid),
    hasClosedBody: hasClosedBody(options.points, bounds, options.closedBody)
  };

  return {
    id: options.id,
    source: options.source,
    createdAt: options.createdAt,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: bounds.width,
    height: bounds.height,
    centroid: roundPoint(centroid),
    density: getDensity(options.points.length, bounds),
    pointCount: options.points.length,
    strokeCount: options.strokeCount,
    shapeCount: options.shapeCount,
    blockCount: options.blockCount,
    shapeKind: options.shapeKind,
    label: options.label,
    textLength: options.textLength,
    edgeHints,
    anchorHints: getAnchorHints(bounds, edgeHints, options.points),
    orientationHints
  };
}

function candidateFromStroke(stroke: HumanStroke): CandidateDraft | null {
  return buildCandidate({
    id: stroke.id,
    source: "humanStroke",
    createdAt: stroke.createdAt,
    points: getStrokePoints(stroke),
    fallbackBounds: getStrokeBounds(stroke),
    closedBody: false,
    strokeCount: 1
  });
}

function candidateFromShape(element: PersistedShapeElement): CandidateDraft | null {
  const bounds = getShapeBounds(element.shape);
  const fallbackBounds = finalizeBounds(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
  if (fallbackBounds.width < 1 || fallbackBounds.height < 1) {
    return null;
  }

  return buildCandidate({
    id: element.id,
    source: "shapeElement",
    createdAt: element.createdAt,
    points: getShapePoints(element.shape),
    fallbackBounds,
    closedBody:
      element.shape.kind === "rect" ||
      element.shape.kind === "circle" ||
      element.shape.kind === "ellipse" ||
      element.shape.kind === "polygon" ||
      (element.shape.kind === "curve" && Boolean(element.shape.closed)),
    shapeKind: element.shape.kind,
    label: element.label,
    shapeCount: 1
  });
}

function candidateFromBlock(block: PersistedAsciiBlock): CandidateDraft | null {
  return buildCandidate({
    id: block.id,
    source: "asciiBlock",
    createdAt: block.createdAt,
    points: getAsciiBlockPoints(block),
    fallbackBounds: estimateAsciiBounds(block),
    closedBody: true,
    label: block.label,
    textLength: block.text.length,
    blockCount: 1
  });
}

function candidateFromComment(comment: CommentThread): CandidateDraft | null {
  return buildCandidate({
    id: comment.id,
    source: "comment",
    createdAt:
      comment.thread[comment.thread.length - 1]?.createdAt ?? Date.now(),
    points: getCommentPoints(comment),
    fallbackBounds: estimateCommentBounds(comment),
    closedBody: true,
    textLength: comment.text.length
  });
}

export function getAttachmentCandidates(options: {
  syncState?: DrawingSyncState | null;
  targetComment?: CommentThread | null;
  limit?: number;
}): AttachmentCandidate[] {
  const limit = options.limit ?? 8;
  const drafts = [
    ...(options.syncState?.humanStrokes.map(candidateFromStroke) ?? []),
    ...(options.syncState?.drawingElements.map(candidateFromShape) ?? []),
    ...(options.syncState?.asciiBlocks.map(candidateFromBlock) ?? []),
    ...(options.targetComment ? [candidateFromComment(options.targetComment)] : [])
  ].filter((candidate): candidate is CandidateDraft => Boolean(candidate));

  return drafts
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(({ createdAt: _createdAt, ...candidate }, index) => ({
      ...candidate,
      recentRank: index
    }));
}
