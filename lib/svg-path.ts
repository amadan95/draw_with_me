import type { ObjectBoundingBox, SvgViewBox } from "@/lib/draw-types";

type PathCommand =
  | "M"
  | "m"
  | "L"
  | "l"
  | "H"
  | "h"
  | "V"
  | "v"
  | "C"
  | "c"
  | "S"
  | "s"
  | "Q"
  | "q"
  | "T"
  | "t"
  | "Z"
  | "z";

type PointTuple = [number, number];

type SampleOptions = {
  curveSubdivisions?: number;
  maxPoints?: number;
};

type PathBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

const COMMAND_RE = /[MmLlHhVvCcSsQqTtZz]/;
const TOKEN_RE = /[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dedupeSequentialPoints(points: PointTuple[]) {
  const deduped: PointTuple[] = [];

  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      deduped.push(point);
    }
  }

  return deduped;
}

function downsamplePoints(points: PointTuple[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }

  const stride = (points.length - 1) / (maxPoints - 1);
  const sampled: PointTuple[] = [];

  for (let index = 0; index < maxPoints; index += 1) {
    const sourceIndex = Math.round(index * stride);
    sampled.push(points[Math.min(points.length - 1, sourceIndex)]);
  }

  return sampled;
}

function sampleLine(from: PointTuple, to: PointTuple) {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(2, Math.ceil(distance / 6));
  const points: PointTuple[] = [];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    points.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t
    ]);
  }

  return points;
}

function sampleQuadratic(
  from: PointTuple,
  control: PointTuple,
  to: PointTuple,
  subdivisions: number
) {
  const steps = Math.max(
    8,
    Math.ceil(
      (Math.hypot(control[0] - from[0], control[1] - from[1]) +
        Math.hypot(to[0] - control[0], to[1] - control[1])) /
        8
    ),
    subdivisions
  );
  const points: PointTuple[] = [];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const inverse = 1 - t;
    points.push([
      inverse * inverse * from[0] + 2 * inverse * t * control[0] + t * t * to[0],
      inverse * inverse * from[1] + 2 * inverse * t * control[1] + t * t * to[1]
    ]);
  }

  return points;
}

function sampleCubic(
  from: PointTuple,
  control1: PointTuple,
  control2: PointTuple,
  to: PointTuple,
  subdivisions: number
) {
  const steps = Math.max(
    10,
    Math.ceil(
      (Math.hypot(control1[0] - from[0], control1[1] - from[1]) +
        Math.hypot(control2[0] - control1[0], control2[1] - control1[1]) +
        Math.hypot(to[0] - control2[0], to[1] - control2[1])) /
        8
    ),
    subdivisions
  );
  const points: PointTuple[] = [];

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const inverse = 1 - t;
    points.push([
      inverse * inverse * inverse * from[0] +
        3 * inverse * inverse * t * control1[0] +
        3 * inverse * t * t * control2[0] +
        t * t * t * to[0],
      inverse * inverse * inverse * from[1] +
        3 * inverse * inverse * t * control1[1] +
        3 * inverse * t * t * control2[1] +
        t * t * t * to[1]
    ]);
  }

  return points;
}

export function getPointBounds(points: PointTuple[]): PathBounds {
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    };
  }

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

export function svgPathToPoints(pathData: string, options: SampleOptions = {}) {
  const tokens = pathData.match(TOKEN_RE) ?? [];
  if (tokens.length === 0) {
    return [] as PointTuple[];
  }

  const curveSubdivisions = options.curveSubdivisions ?? 16;
  const maxPoints = options.maxPoints ?? 192;

  let index = 0;
  let command: PathCommand | "" = "";
  let current: PointTuple = [0, 0];
  let subpathStart: PointTuple = [0, 0];
  let lastCubicControl: PointTuple | null = null;
  let lastQuadraticControl: PointTuple | null = null;
  const points: PointTuple[] = [];

  const peek = () => tokens[index];
  const next = () => tokens[index++];
  const hasNumber = () => {
    const token = peek();
    return token !== undefined && !COMMAND_RE.test(token);
  };
  const readNumber = () => {
    const token = next();
    if (token === undefined) {
      throw new Error("Unexpected end of SVG path.");
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new Error("Invalid SVG path number.");
    }
    return value;
  };
  const appendSamples = (samples: PointTuple[]) => {
    for (const sample of samples) {
      points.push([sample[0], sample[1]]);
    }
  };

  while (index < tokens.length) {
    const token = peek();
    if (!token) {
      break;
    }

    if (COMMAND_RE.test(token)) {
      command = next() as PathCommand;
    } else if (!command) {
      throw new Error("SVG path must start with a command.");
    }

    switch (command) {
      case "M":
      case "m": {
        const relative = command === "m";
        let firstPair = true;
        while (hasNumber()) {
          const x = readNumber();
          const y = readNumber();
          const nextPoint: PointTuple = relative
            ? [current[0] + x, current[1] + y]
            : [x, y];

          if (firstPair) {
            current = nextPoint;
            subpathStart = nextPoint;
            points.push(nextPoint);
            firstPair = false;
          } else {
            appendSamples(sampleLine(current, nextPoint));
            current = nextPoint;
          }

          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      }

      case "L":
      case "l": {
        const relative = command === "l";
        while (hasNumber()) {
          const x = readNumber();
          const y = readNumber();
          const nextPoint: PointTuple = relative
            ? [current[0] + x, current[1] + y]
            : [x, y];
          appendSamples(sampleLine(current, nextPoint));
          current = nextPoint;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      }

      case "H":
      case "h": {
        const relative = command === "h";
        while (hasNumber()) {
          const x = readNumber();
          const nextPoint: PointTuple = relative ? [current[0] + x, current[1]] : [x, current[1]];
          appendSamples(sampleLine(current, nextPoint));
          current = nextPoint;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      }

      case "V":
      case "v": {
        const relative = command === "v";
        while (hasNumber()) {
          const y = readNumber();
          const nextPoint: PointTuple = relative ? [current[0], current[1] + y] : [current[0], y];
          appendSamples(sampleLine(current, nextPoint));
          current = nextPoint;
          lastCubicControl = null;
          lastQuadraticControl = null;
        }
        break;
      }

      case "C":
      case "c": {
        const relative = command === "c";
        while (hasNumber()) {
          const control1: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];
          const control2: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];
          const nextPoint: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];

          appendSamples(sampleCubic(current, control1, control2, nextPoint, curveSubdivisions));
          current = nextPoint;
          lastCubicControl = control2;
          lastQuadraticControl = null;
        }
        break;
      }

      case "S":
      case "s": {
        const relative = command === "s";
        while (hasNumber()) {
          const control1: PointTuple = lastCubicControl
            ? [current[0] * 2 - lastCubicControl[0], current[1] * 2 - lastCubicControl[1]]
            : current;
          const control2: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];
          const nextPoint: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];

          appendSamples(sampleCubic(current, control1, control2, nextPoint, curveSubdivisions));
          current = nextPoint;
          lastCubicControl = control2;
          lastQuadraticControl = null;
        }
        break;
      }

      case "Q":
      case "q": {
        const relative = command === "q";
        while (hasNumber()) {
          const control: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];
          const nextPoint: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];

          appendSamples(sampleQuadratic(current, control, nextPoint, curveSubdivisions));
          current = nextPoint;
          lastQuadraticControl = control;
          lastCubicControl = null;
        }
        break;
      }

      case "T":
      case "t": {
        const relative = command === "t";
        while (hasNumber()) {
          const control: PointTuple = lastQuadraticControl
            ? [
                current[0] * 2 - lastQuadraticControl[0],
                current[1] * 2 - lastQuadraticControl[1]
              ]
            : current;
          const nextPoint: PointTuple = relative
            ? [current[0] + readNumber(), current[1] + readNumber()]
            : [readNumber(), readNumber()];

          appendSamples(sampleQuadratic(current, control, nextPoint, curveSubdivisions));
          current = nextPoint;
          lastQuadraticControl = control;
          lastCubicControl = null;
        }
        break;
      }

      case "Z":
      case "z": {
        appendSamples(sampleLine(current, subpathStart));
        current = subpathStart;
        lastCubicControl = null;
        lastQuadraticControl = null;
        index += 0;
        break;
      }
    }
  }

  return downsamplePoints(dedupeSequentialPoints(points), maxPoints);
}

export function projectPointsToFrame(
  points: PointTuple[],
  frame: ObjectBoundingBox,
  viewBox?: SvgViewBox
) {
  if (points.length === 0) {
    return [] as PointTuple[];
  }

  const sourceBounds = getPointBounds(points);
  const sourceX = viewBox ? 0 : sourceBounds.minX;
  const sourceY = viewBox ? 0 : sourceBounds.minY;
  const sourceWidth = Math.max(1, viewBox?.width ?? sourceBounds.width ?? 1);
  const sourceHeight = Math.max(1, viewBox?.height ?? sourceBounds.height ?? 1);

  return points.map(([x, y]) => [
    frame.x + ((x - sourceX) / sourceWidth) * frame.width,
    frame.y + ((y - sourceY) / sourceHeight) * frame.height
  ] as PointTuple);
}

export function svgPathToFramePoints(
  pathData: string,
  frame: ObjectBoundingBox,
  viewBox?: SvgViewBox,
  options: SampleOptions = {}
) {
  const points = svgPathToPoints(pathData, options);
  return projectPointsToFrame(points, frame, viewBox).map(([x, y]) => [
    Math.round(clamp(x, 0, Number.MAX_SAFE_INTEGER)),
    Math.round(clamp(y, 0, Number.MAX_SAFE_INTEGER))
  ] as PointTuple);
}
