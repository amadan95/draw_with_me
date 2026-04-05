import { z } from "zod";
import { getShapeBounds, type DrawShape } from "@/lib/draw/shapes";
import { type AttachmentCandidate } from "@/lib/draw/scene-candidates";

export const placementModeSchema = z.union([
  z.literal("attach"),
  z.literal("inside"),
  z.literal("overlap"),
  z.literal("adjacent"),
  z.literal("centered"),
  z.literal("edge-aligned")
]);

export const anchorSchema = z.union([
  z.literal("center"),
  z.literal("top-edge"),
  z.literal("bottom-edge"),
  z.literal("left-edge"),
  z.literal("right-edge"),
  z.literal("top-left-corner"),
  z.literal("top-right-corner"),
  z.literal("bottom-left-corner"),
  z.literal("bottom-right-corner"),
  z.literal("upper-half"),
  z.literal("lower-half")
]);

export const primitiveSchema = z.union([
  z.literal("rect"),
  z.literal("circle"),
  z.literal("ellipse"),
  z.literal("line"),
  z.literal("curve"),
  z.literal("polygon")
]);

export const relationStyleSchema = z
  .object({
    stroke: z.string().trim().min(1).max(48).optional(),
    strokeWidth: z.number().finite().min(0.5).max(40).optional(),
    fill: z.string().trim().min(1).max(48).optional(),
    opacity: z.number().finite().min(0.04).max(1).optional()
  })
  .optional();

export const relationPlanSchema = z.object({
  hostCandidateId: z.string().min(1),
  placementMode: placementModeSchema,
  anchor: anchorSchema,
  primitive: primitiveSchema,
  sizeRatio: z.number().finite().min(0.05).max(0.9),
  aspectRatio: z.number().finite().min(0.15).max(6).optional(),
  offset: z
    .object({
      x: z.number().finite().min(-1).max(1),
      y: z.number().finite().min(-1).max(1)
    })
    .optional(),
  rotationHint: z.number().finite().min(-180).max(180).optional(),
  style: relationStyleSchema,
  semanticRole: z
    .union([
      z.literal("part"),
      z.literal("detail"),
      z.literal("attachment"),
      z.literal("accent")
    ])
    .optional(),
  label: z.string().max(160).optional()
});

export type RelationPlan = z.infer<typeof relationPlanSchema>;

type BoundsLike = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toBoundsLike(bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): BoundsLike {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY
  };
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getAnchorPoint(candidate: AttachmentCandidate, anchor: RelationPlan["anchor"]): Point {
  switch (anchor) {
    case "center":
      return candidate.anchorHints.center;
    case "top-edge":
      return candidate.anchorHints.topEdge;
    case "bottom-edge":
      return candidate.anchorHints.bottomEdge;
    case "left-edge":
      return candidate.anchorHints.leftEdge;
    case "right-edge":
      return candidate.anchorHints.rightEdge;
    case "top-left-corner":
      return candidate.anchorHints.topLeftCorner;
    case "top-right-corner":
      return candidate.anchorHints.topRightCorner;
    case "bottom-left-corner":
      return candidate.anchorHints.bottomLeftCorner;
    case "bottom-right-corner":
      return candidate.anchorHints.bottomRightCorner;
    case "upper-half":
      return candidate.anchorHints.upperHalf;
    case "lower-half":
      return candidate.anchorHints.lowerHalf;
  }
}

function getAnchorDirection(anchor: RelationPlan["anchor"]): Point {
  switch (anchor) {
    case "top-edge":
      return { x: 0, y: -1 };
    case "bottom-edge":
      return { x: 0, y: 1 };
    case "left-edge":
      return { x: -1, y: 0 };
    case "right-edge":
      return { x: 1, y: 0 };
    case "top-left-corner":
      return { x: -0.72, y: -0.72 };
    case "top-right-corner":
      return { x: 0.72, y: -0.72 };
    case "bottom-left-corner":
      return { x: -0.72, y: 0.72 };
    case "bottom-right-corner":
      return { x: 0.72, y: 0.72 };
    case "upper-half":
      return { x: 0, y: -0.45 };
    case "lower-half":
      return { x: 0, y: 0.45 };
    case "center":
      return { x: 0, y: 0 };
  }
}

function getRelevantEdgeHint(candidate: AttachmentCandidate, anchor: RelationPlan["anchor"]) {
  switch (anchor) {
    case "top-edge":
    case "top-left-corner":
    case "top-right-corner":
      return candidate.edgeHints.top;
    case "bottom-edge":
    case "bottom-left-corner":
    case "bottom-right-corner":
      return candidate.edgeHints.bottom;
    case "left-edge":
      return candidate.edgeHints.left;
    case "right-edge":
      return candidate.edgeHints.right;
    case "center":
    case "upper-half":
    case "lower-half":
      return null;
  }
}

function getPrimitiveOrientation(anchor: RelationPlan["anchor"]) {
  switch (anchor) {
    case "left-edge":
    case "right-edge":
      return "vertical" as const;
    case "top-left-corner":
    case "top-right-corner":
    case "bottom-left-corner":
    case "bottom-right-corner":
      return "diagonal" as const;
    default:
      return "horizontal" as const;
  }
}

function isAnchorSupported(relation: RelationPlan) {
  if (
    (relation.placementMode === "attach" ||
      relation.placementMode === "adjacent" ||
      relation.placementMode === "edge-aligned") &&
    (relation.anchor === "center" ||
      relation.anchor === "upper-half" ||
      relation.anchor === "lower-half")
  ) {
    return false;
  }

  return true;
}

function getPlacementAngleRadians(
  candidate: AttachmentCandidate,
  relation: RelationPlan
) {
  if (typeof relation.rotationHint === "number") {
    return degreesToRadians(relation.rotationHint);
  }

  const edgeHint = getRelevantEdgeHint(candidate, relation.anchor);
  if (
    edgeHint &&
    (relation.placementMode === "edge-aligned" ||
      relation.primitive === "line" ||
      relation.primitive === "curve" ||
      relation.primitive === "polygon")
  ) {
    return degreesToRadians(edgeHint.angle);
  }

  switch (getPrimitiveOrientation(relation.anchor)) {
    case "vertical":
      return Math.PI * 0.5;
    case "diagonal":
      return Math.atan2(
        getAnchorDirection(relation.anchor).y,
        getAnchorDirection(relation.anchor).x
      );
    case "horizontal":
      return 0;
  }
}

function getRelationSize(
  candidate: AttachmentCandidate,
  relation: RelationPlan,
  canvasWidth: number,
  canvasHeight: number
): Size {
  const hostMin = Math.max(12, Math.min(candidate.width, candidate.height));
  const hostMax = Math.max(hostMin, Math.max(candidate.width, candidate.height));
  const edgeReference = getRelevantEdgeHint(candidate, relation.anchor)?.length;
  const reference =
    relation.placementMode === "inside" || relation.placementMode === "centered"
      ? hostMin
      : clamp(edgeReference ?? Math.min(hostMax, hostMin * 1.6), hostMin, hostMax * 1.4);
  const base = clamp(
    reference * relation.sizeRatio,
    10,
    Math.min(canvasWidth, canvasHeight) * 0.45
  );
  const aspect = clamp(relation.aspectRatio ?? 1, 0.25, 4.5);

  return {
    width: clamp(base * Math.sqrt(aspect), 8, canvasWidth * 0.5),
    height: clamp(base / Math.sqrt(aspect), 8, canvasHeight * 0.5)
  };
}

function constrainCenterForMode(
  center: Point,
  candidate: AttachmentCandidate,
  size: Size,
  placementMode: RelationPlan["placementMode"]
) {
  if (placementMode === "inside" || placementMode === "centered") {
    return {
      x: clamp(center.x, candidate.minX + size.width * 0.5, candidate.maxX - size.width * 0.5),
      y: clamp(
        center.y,
        candidate.minY + size.height * 0.5,
        candidate.maxY - size.height * 0.5
      )
    };
  }

  const overflowFactor = placementMode === "adjacent" ? 0.9 : 0.45;
  return {
    x: clamp(center.x, candidate.minX - size.width * overflowFactor, candidate.maxX + size.width * overflowFactor),
    y: clamp(center.y, candidate.minY - size.height * overflowFactor, candidate.maxY + size.height * overflowFactor)
  };
}

function getPlacementCenter(candidate: AttachmentCandidate, relation: RelationPlan, size: Size) {
  const anchor = getAnchorPoint(candidate, relation.anchor);
  const direction = getAnchorDirection(relation.anchor);
  const halfWidth = size.width * 0.5;
  const halfHeight = size.height * 0.5;
  const overlapDepthX = Math.min(halfWidth * 0.45, candidate.width * 0.18);
  const overlapDepthY = Math.min(halfHeight * 0.45, candidate.height * 0.18);
  const adjacentGap = Math.max(8, Math.min(candidate.width, candidate.height) * 0.12);

  let center: Point;

  switch (relation.placementMode) {
    case "inside":
      center = anchor;
      break;
    case "centered":
      center =
        relation.anchor === "center"
          ? {
              x: candidate.minX + candidate.width * 0.5,
              y: candidate.minY + candidate.height * 0.5
            }
          : anchor;
      break;
    case "attach":
      center = {
        x: anchor.x + direction.x * Math.max(halfWidth - overlapDepthX, 0),
        y: anchor.y + direction.y * Math.max(halfHeight - overlapDepthY, 0)
      };
      break;
    case "adjacent":
      center = {
        x: anchor.x + direction.x * (halfWidth + adjacentGap),
        y: anchor.y + direction.y * (halfHeight + adjacentGap)
      };
      break;
    case "overlap":
      center = {
        x: anchor.x + direction.x * Math.max(halfWidth * 0.16, 4),
        y: anchor.y + direction.y * Math.max(halfHeight * 0.16, 4)
      };
      break;
    case "edge-aligned":
      center = {
        x: anchor.x + direction.x * Math.max(halfWidth * 0.5, 4),
        y: anchor.y + direction.y * Math.max(halfHeight * 0.5, 4)
      };
      break;
  }

  center = {
    x: center.x + (relation.offset?.x ?? 0) * Math.max(candidate.width, size.width) * 0.18,
    y: center.y + (relation.offset?.y ?? 0) * Math.max(candidate.height, size.height) * 0.18
  };

  return constrainCenterForMode(center, candidate, size, relation.placementMode);
}

function buildPrimitiveShape(options: {
  candidate: AttachmentCandidate;
  primitive: RelationPlan["primitive"];
  relation: RelationPlan;
  center: Point;
  size: Size;
}): DrawShape {
  const { candidate, primitive, relation, center, size } = options;
  const style = relation.style ?? {};
  const direction = getAnchorDirection(relation.anchor);
  const angle = getPlacementAngleRadians(candidate, relation);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const rotatePoint = (x: number, y: number): Point => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos
  });

  switch (primitive) {
    case "rect":
      return {
        kind: "rect",
        x: center.x - size.width * 0.5,
        y: center.y - size.height * 0.5,
        width: size.width,
        height: size.height,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity,
        rx: Math.min(size.width, size.height) * 0.12,
        ry: Math.min(size.width, size.height) * 0.12
      };
    case "circle":
      return {
        kind: "circle",
        cx: center.x,
        cy: center.y,
        r: Math.min(size.width, size.height) * 0.5,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity
      };
    case "ellipse":
      return {
        kind: "ellipse",
        cx: center.x,
        cy: center.y,
        rx: size.width * 0.5,
        ry: size.height * 0.5,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity
      };
    case "line": {
      const halfLength = Math.max(size.width, size.height) * 0.5;
      const start = rotatePoint(-halfLength, 0);
      const end = rotatePoint(halfLength, 0);

      return {
        kind: "line",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity
      };
    }
    case "curve": {
      const points = [
        rotatePoint(-size.width * 0.5, size.height * 0.2),
        rotatePoint(-size.width * 0.08, -size.height * 0.5),
        rotatePoint(size.width * 0.38, size.height * 0.12)
      ];

      return {
        kind: "curve",
        points: points.map((point) => [point.x, point.y] as [number, number]),
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity
      };
    }
    case "polygon": {
      const xDirection = Math.sign(direction.x || 1);
      const yDirection = Math.sign(direction.y || -1);
      const basePoints =
        getPrimitiveOrientation(relation.anchor) === "diagonal"
          ? [
              { x: size.width * 0.45 * xDirection, y: -size.height * 0.45 * yDirection },
              { x: -size.width * 0.4 * xDirection, y: -size.height * 0.05 * yDirection },
              { x: -size.width * 0.05 * xDirection, y: size.height * 0.45 * yDirection }
            ]
          : [
              { x: 0, y: -size.height * 0.5 },
              { x: size.width * 0.5, y: size.height * 0.5 },
              { x: -size.width * 0.5, y: size.height * 0.5 }
            ];
      const points = basePoints.map((point) => rotatePoint(point.x, point.y));

      return {
        kind: "polygon",
        points: points.map((point) => [point.x, point.y] as [number, number]),
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        opacity: style.opacity
      };
    }
  }
}

function getOverlapArea(a: BoundsLike, b: BoundsLike) {
  const overlapWidth = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const overlapHeight = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return overlapWidth * overlapHeight;
}

function getBoundsGap(a: BoundsLike, b: BoundsLike) {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dy = Math.max(0, b.minY - a.maxY, a.minY - b.maxY);
  return Math.hypot(dx, dy);
}

function isNearRequestedAnchor(
  shapeBounds: BoundsLike,
  candidate: AttachmentCandidate,
  anchor: RelationPlan["anchor"],
  tolerance: number
) {
  const centerX = shapeBounds.minX + shapeBounds.width * 0.5;
  const centerY = shapeBounds.minY + shapeBounds.height * 0.5;

  switch (anchor) {
    case "top-edge":
      return (
        Math.abs(shapeBounds.maxY - candidate.minY) <= tolerance &&
        shapeBounds.maxX >= candidate.minX - tolerance &&
        shapeBounds.minX <= candidate.maxX + tolerance
      );
    case "bottom-edge":
      return (
        Math.abs(shapeBounds.minY - candidate.maxY) <= tolerance &&
        shapeBounds.maxX >= candidate.minX - tolerance &&
        shapeBounds.minX <= candidate.maxX + tolerance
      );
    case "left-edge":
      return (
        Math.abs(shapeBounds.maxX - candidate.minX) <= tolerance &&
        shapeBounds.maxY >= candidate.minY - tolerance &&
        shapeBounds.minY <= candidate.maxY + tolerance
      );
    case "right-edge":
      return (
        Math.abs(shapeBounds.minX - candidate.maxX) <= tolerance &&
        shapeBounds.maxY >= candidate.minY - tolerance &&
        shapeBounds.minY <= candidate.maxY + tolerance
      );
    case "top-left-corner":
      return centerX <= candidate.minX + candidate.width * 0.42 && centerY <= candidate.minY + candidate.height * 0.42;
    case "top-right-corner":
      return centerX >= candidate.minX + candidate.width * 0.58 && centerY <= candidate.minY + candidate.height * 0.42;
    case "bottom-left-corner":
      return centerX <= candidate.minX + candidate.width * 0.42 && centerY >= candidate.minY + candidate.height * 0.58;
    case "bottom-right-corner":
      return centerX >= candidate.minX + candidate.width * 0.58 && centerY >= candidate.minY + candidate.height * 0.58;
    case "upper-half":
      return centerY <= candidate.minY + candidate.height * 0.5 + tolerance;
    case "lower-half":
      return centerY >= candidate.minY + candidate.height * 0.5 - tolerance;
    case "center":
      return (
        Math.abs(centerX - (candidate.minX + candidate.width * 0.5)) <= tolerance &&
        Math.abs(centerY - (candidate.minY + candidate.height * 0.5)) <= tolerance
      );
  }
}

function validateRealizedRelationShape(
  relation: RelationPlan,
  candidate: AttachmentCandidate,
  shape: DrawShape
) {
  const shapeBounds = toBoundsLike(getShapeBounds(shape));
  if (!Number.isFinite(shapeBounds.minX) || !Number.isFinite(shapeBounds.minY)) {
    return false;
  }

  const overlapArea = getOverlapArea(shapeBounds, candidate);
  const gap = getBoundsGap(shapeBounds, candidate);
  const shapeArea = Math.max(1, shapeBounds.width * shapeBounds.height);
  const tolerance = Math.max(8, Math.min(shapeBounds.width, shapeBounds.height) * 0.3);
  const shapeCenterX = shapeBounds.minX + shapeBounds.width * 0.5;
  const shapeCenterY = shapeBounds.minY + shapeBounds.height * 0.5;
  const candidateCenterX = candidate.minX + candidate.width * 0.5;
  const candidateCenterY = candidate.minY + candidate.height * 0.5;

  switch (relation.placementMode) {
    case "inside":
      return (
        shapeBounds.minX >= candidate.minX - 2 &&
        shapeBounds.maxX <= candidate.maxX + 2 &&
        shapeBounds.minY >= candidate.minY - 2 &&
        shapeBounds.maxY <= candidate.maxY + 2
      );
    case "centered":
      return (
        Math.hypot(shapeCenterX - candidateCenterX, shapeCenterY - candidateCenterY) <=
        Math.max(candidate.width, candidate.height) * 0.3
      );
    case "attach":
      return (
        gap <= tolerance &&
        (overlapArea > 0 || isNearRequestedAnchor(shapeBounds, candidate, relation.anchor, tolerance))
      );
    case "adjacent":
      return (
        gap <= Math.max(candidate.width, candidate.height) * 0.35 &&
        overlapArea <= shapeArea * 0.2
      );
    case "overlap":
      return overlapArea >= shapeArea * 0.08;
    case "edge-aligned":
      return gap <= tolerance && isNearRequestedAnchor(shapeBounds, candidate, relation.anchor, tolerance * 1.25);
  }
}

export function realizeRelationPlan(options: {
  relation: RelationPlan;
  candidates: AttachmentCandidate[];
  canvasWidth: number;
  canvasHeight: number;
}): DrawShape | null {
  const candidate = options.candidates.find((item) => item.id === options.relation.hostCandidateId);
  if (!candidate || !isAnchorSupported(options.relation)) {
    return null;
  }

  const size = getRelationSize(
    candidate,
    options.relation,
    options.canvasWidth,
    options.canvasHeight
  );
  const center = getPlacementCenter(candidate, options.relation, size);
  const shape = buildPrimitiveShape({
    candidate,
    primitive: options.relation.primitive,
    relation: options.relation,
    center,
    size
  });

  return validateRealizedRelationShape(options.relation, candidate, shape) ? shape : null;
}
