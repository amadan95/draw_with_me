import { z } from "zod";

const colorPattern =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|transparent|currentColor)$/;

export const colorStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .refine((value) => colorPattern.test(value), {
    message: "Expected a supported color string."
  });

export const pointTupleSchema = z.tuple([z.number().finite(), z.number().finite()]);

const commonShapeStyleSchema = z.object({
  stroke: colorStringSchema.optional(),
  strokeWidth: z.number().finite().min(0.5).max(40).optional(),
  fill: colorStringSchema.optional(),
  opacity: z.number().finite().min(0.04).max(1).optional()
});

export const pathShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("path"),
  d: z
    .string()
    .trim()
    .min(1)
    .max(3200)
    .refine((value) => /^[MmLlHhVvCcSsQqTtAaZz0-9,.\-\s]+$/.test(value), {
      message: "Path contains unsupported characters."
    }),
  transform: z.string().trim().max(180).optional()
});

export const lineShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("line"),
  x1: z.number().finite(),
  y1: z.number().finite(),
  x2: z.number().finite(),
  y2: z.number().finite()
});

export const curveShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("curve"),
  points: z.array(pointTupleSchema).min(2).max(120),
  closed: z.boolean().optional()
});

export const circleShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("circle"),
  cx: z.number().finite(),
  cy: z.number().finite(),
  r: z.number().finite().min(1).max(1200)
});

export const ellipseShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("ellipse"),
  cx: z.number().finite(),
  cy: z.number().finite(),
  rx: z.number().finite().min(1).max(1200),
  ry: z.number().finite().min(1).max(1200)
});

export const rectShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("rect"),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(1).max(2400),
  height: z.number().finite().min(1).max(2400),
  rx: z.number().finite().min(0).max(400).optional(),
  ry: z.number().finite().min(0).max(400).optional()
});

export const polygonShapeSchema = commonShapeStyleSchema.extend({
  kind: z.literal("polygon"),
  points: z.array(pointTupleSchema).min(3).max(96)
});

export const eraseShapeSchema = z.object({
  kind: z.literal("erase"),
  points: z.array(pointTupleSchema).min(2).max(120),
  strokeWidth: z.number().finite().min(2).max(80),
  opacity: z.number().finite().min(0.04).max(1).optional()
});

export const drawShapeSchema = z.discriminatedUnion("kind", [
  pathShapeSchema,
  lineShapeSchema,
  curveShapeSchema,
  circleShapeSchema,
  ellipseShapeSchema,
  rectShapeSchema,
  polygonShapeSchema,
  eraseShapeSchema
]);

export type PointTuple = z.infer<typeof pointTupleSchema>;
export type DrawShape = z.infer<typeof drawShapeSchema>;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPoint(point: PointTuple, width: number, height: number): PointTuple {
  return [clamp(point[0], 0, width), clamp(point[1], 0, height)];
}

function clampStrokeWidth(value: number | undefined, fallback = 3) {
  return clamp(value ?? fallback, 0.5, 40);
}

function sanitizeFill(fill: string | undefined) {
  if (!fill) {
    return undefined;
  }

  return fill;
}

export function sanitizeShape(
  shape: DrawShape,
  canvasWidth: number,
  canvasHeight: number
): DrawShape {
  switch (shape.kind) {
    case "path":
      return {
        ...shape,
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "line":
      return {
        ...shape,
        x1: clamp(shape.x1, 0, canvasWidth),
        y1: clamp(shape.y1, 0, canvasHeight),
        x2: clamp(shape.x2, 0, canvasWidth),
        y2: clamp(shape.y2, 0, canvasHeight),
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "curve":
      return {
        ...shape,
        points: shape.points.map((point) => clampPoint(point, canvasWidth, canvasHeight)),
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "circle":
      return {
        ...shape,
        cx: clamp(shape.cx, 0, canvasWidth),
        cy: clamp(shape.cy, 0, canvasHeight),
        r: clamp(shape.r, 1, Math.max(canvasWidth, canvasHeight)),
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "ellipse":
      return {
        ...shape,
        cx: clamp(shape.cx, 0, canvasWidth),
        cy: clamp(shape.cy, 0, canvasHeight),
        rx: clamp(shape.rx, 1, canvasWidth),
        ry: clamp(shape.ry, 1, canvasHeight),
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "rect":
      return {
        ...shape,
        x: clamp(shape.x, 0, canvasWidth),
        y: clamp(shape.y, 0, canvasHeight),
        width: clamp(shape.width, 1, canvasWidth),
        height: clamp(shape.height, 1, canvasHeight),
        rx: shape.rx ? clamp(shape.rx, 0, shape.width * 0.5) : undefined,
        ry: shape.ry ? clamp(shape.ry, 0, shape.height * 0.5) : undefined,
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "polygon":
      return {
        ...shape,
        points: shape.points.map((point) => clampPoint(point, canvasWidth, canvasHeight)),
        strokeWidth: clampStrokeWidth(shape.strokeWidth),
        opacity: shape.opacity ?? 1,
        fill: sanitizeFill(shape.fill)
      };
    case "erase":
      return {
        ...shape,
        points: shape.points.map((point) => clampPoint(point, canvasWidth, canvasHeight)),
        strokeWidth: clamp(shape.strokeWidth, 2, 80),
        opacity: shape.opacity ?? 1
      };
  }
}

export function pointDistance(a: PointTuple, b: PointTuple) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pointsToPathData(points: PointTuple[], closed = false) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0][0]} ${points[0][1]}`;
  }

  let path = `M ${points[0][0]} ${points[0][1]}`;

  if (points.length === 2) {
    path += ` L ${points[1][0]} ${points[1][1]}`;
    return closed ? `${path} Z` : path;
  }

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[Math.max(0, index - 1)];
    const after = points[Math.min(points.length - 1, index + 2)];
    const cp1x = current[0] + (next[0] - previous[0]) / 6;
    const cp1y = current[1] + (next[1] - previous[1]) / 6;
    const cp2x = next[0] - (after[0] - current[0]) / 6;
    const cp2y = next[1] - (after[1] - current[1]) / 6;
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next[0]} ${next[1]}`;
  }

  return closed ? `${path} Z` : path;
}

export function shapeToPathData(shape: DrawShape) {
  switch (shape.kind) {
    case "path":
      return shape.d;
    case "line":
      return `M ${shape.x1} ${shape.y1} L ${shape.x2} ${shape.y2}`;
    case "curve":
      return pointsToPathData(shape.points, shape.closed);
    case "circle":
      return [
        `M ${shape.cx} ${shape.cy - shape.r}`,
        `A ${shape.r} ${shape.r} 0 1 1 ${shape.cx - 0.01} ${shape.cy - shape.r}`,
        `A ${shape.r} ${shape.r} 0 1 1 ${shape.cx} ${shape.cy - shape.r}`
      ].join(" ");
    case "ellipse":
      return [
        `M ${shape.cx} ${shape.cy - shape.ry}`,
        `A ${shape.rx} ${shape.ry} 0 1 1 ${shape.cx - 0.01} ${shape.cy - shape.ry}`,
        `A ${shape.rx} ${shape.ry} 0 1 1 ${shape.cx} ${shape.cy - shape.ry}`
      ].join(" ");
    case "rect":
      return [
        `M ${shape.x} ${shape.y}`,
        `L ${shape.x + shape.width} ${shape.y}`,
        `L ${shape.x + shape.width} ${shape.y + shape.height}`,
        `L ${shape.x} ${shape.y + shape.height}`,
        "Z"
      ].join(" ");
    case "polygon":
      return `${pointsToPathData(shape.points, true)}`;
    case "erase":
      return pointsToPathData(shape.points, false);
  }
}

export function getShapeStartPoint(shape: DrawShape): PointTuple {
  switch (shape.kind) {
    case "path":
      return getShapeCenterPoint(shape);
    case "line":
      return [shape.x1, shape.y1];
    case "curve":
      return shape.points[0];
    case "circle":
      return [shape.cx, shape.cy - shape.r];
    case "ellipse":
      return [shape.cx, shape.cy - shape.ry];
    case "rect":
      return [shape.x, shape.y];
    case "polygon":
      return shape.points[0];
    case "erase":
      return shape.points[0];
  }
}

export function getShapeCenterPoint(shape: DrawShape): PointTuple {
  switch (shape.kind) {
    case "path":
      return [0, 0];
    case "line":
      return [(shape.x1 + shape.x2) * 0.5, (shape.y1 + shape.y2) * 0.5];
    case "curve":
    case "polygon":
    case "erase": {
      const total = shape.points.reduce(
        (acc, point) => [acc[0] + point[0], acc[1] + point[1]] as PointTuple,
        [0, 0]
      );
      return [total[0] / shape.points.length, total[1] / shape.points.length];
    }
    case "circle":
      return [shape.cx, shape.cy];
    case "ellipse":
      return [shape.cx, shape.cy];
    case "rect":
      return [shape.x + shape.width * 0.5, shape.y + shape.height * 0.5];
  }
}

export function estimateShapeLength(shape: DrawShape) {
  switch (shape.kind) {
    case "path":
      return Math.max(80, shape.d.length * 0.7);
    case "line":
      return pointDistance([shape.x1, shape.y1], [shape.x2, shape.y2]);
    case "curve":
    case "erase":
      return shape.points.slice(1).reduce((total, point, index) => {
        return total + pointDistance(shape.points[index], point);
      }, 0);
    case "circle":
      return Math.PI * 2 * shape.r;
    case "ellipse":
      return Math.PI * (3 * (shape.rx + shape.ry) - Math.sqrt((3 * shape.rx + shape.ry) * (shape.rx + 3 * shape.ry)));
    case "rect":
      return shape.width * 2 + shape.height * 2;
    case "polygon":
      return shape.points.reduce((total, point, index) => {
        const next = shape.points[(index + 1) % shape.points.length];
        return total + pointDistance(point, next);
      }, 0);
  }
}

export function getShapeBounds(shape: DrawShape) {
  switch (shape.kind) {
    case "path":
      return {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0
      };
    case "line":
      return {
        minX: Math.min(shape.x1, shape.x2),
        minY: Math.min(shape.y1, shape.y2),
        maxX: Math.max(shape.x1, shape.x2),
        maxY: Math.max(shape.y1, shape.y2)
      };
    case "curve":
    case "polygon":
    case "erase": {
      return shape.points.reduce(
        (bounds, point) => ({
          minX: Math.min(bounds.minX, point[0]),
          minY: Math.min(bounds.minY, point[1]),
          maxX: Math.max(bounds.maxX, point[0]),
          maxY: Math.max(bounds.maxY, point[1])
        }),
        {
          minX: Number.POSITIVE_INFINITY,
          minY: Number.POSITIVE_INFINITY,
          maxX: Number.NEGATIVE_INFINITY,
          maxY: Number.NEGATIVE_INFINITY
        }
      );
    }
    case "circle":
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r
      };
    case "ellipse":
      return {
        minX: shape.cx - shape.rx,
        minY: shape.cy - shape.ry,
        maxX: shape.cx + shape.rx,
        maxY: shape.cy + shape.ry
      };
    case "rect":
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.width,
        maxY: shape.y + shape.height
      };
  }
}

export function sampleShapePoint(shape: DrawShape, progress: number): PointTuple {
  const t = clamp(progress, 0, 1);

  switch (shape.kind) {
    case "line":
      return [
        shape.x1 + (shape.x2 - shape.x1) * t,
        shape.y1 + (shape.y2 - shape.y1) * t
      ];
    case "curve":
    case "polygon":
    case "erase": {
      const points = shape.points;
      if (points.length === 0) {
        return [0, 0];
      }
      if (points.length === 1) {
        return points[0];
      }

      const lengths = [0];
      let total = 0;
      for (let index = 1; index < points.length; index += 1) {
        total += pointDistance(points[index - 1], points[index]);
        lengths.push(total);
      }
      if (shape.kind === "polygon") {
        total += pointDistance(points[points.length - 1], points[0]);
        lengths.push(total);
      }
      const target = total * t;
      const segments = shape.kind === "polygon" ? points.length : points.length - 1;
      for (let index = 0; index < segments; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        const startDistance = lengths[index] ?? 0;
        const endDistance = lengths[index + 1] ?? total;
        if (target <= endDistance) {
          const segmentProgress =
            endDistance === startDistance ? 1 : (target - startDistance) / (endDistance - startDistance);
          return [
            start[0] + (end[0] - start[0]) * segmentProgress,
            start[1] + (end[1] - start[1]) * segmentProgress
          ];
        }
      }
      return points[points.length - 1];
    }
    case "circle": {
      const angle = -Math.PI / 2 + Math.PI * 2 * t;
      return [shape.cx + Math.cos(angle) * shape.r, shape.cy + Math.sin(angle) * shape.r];
    }
    case "ellipse": {
      const angle = -Math.PI / 2 + Math.PI * 2 * t;
      return [shape.cx + Math.cos(angle) * shape.rx, shape.cy + Math.sin(angle) * shape.ry];
    }
    case "rect": {
      const perimeter = shape.width * 2 + shape.height * 2;
      const target = perimeter * t;
      if (target <= shape.width) {
        return [shape.x + target, shape.y];
      }
      if (target <= shape.width + shape.height) {
        return [shape.x + shape.width, shape.y + (target - shape.width)];
      }
      if (target <= shape.width * 2 + shape.height) {
        return [
          shape.x + shape.width - (target - (shape.width + shape.height)),
          shape.y + shape.height
        ];
      }
      return [shape.x, shape.y + shape.height - (target - (shape.width * 2 + shape.height))];
    }
    case "path":
      return getShapeCenterPoint(shape);
  }
}
