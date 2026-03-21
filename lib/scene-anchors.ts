import type {
  ObjectBoundingBox,
  PlannerHumanContext,
  SceneSubject
} from "@/lib/draw-types";

export type AnchorPoint = {
  x: number;
  y: number;
};

export type SubjectAnchors = {
  bounds: ObjectBoundingBox;
  center: AnchorPoint;
  top: AnchorPoint;
  bottom: AnchorPoint;
  left: AnchorPoint;
  right: AnchorPoint;
  roofLeft: AnchorPoint;
  roofPeak: AnchorPoint;
  roofRight: AnchorPoint;
  doorwayCenter: AnchorPoint;
  groundCenter: AnchorPoint;
  trunkBase: AnchorPoint;
  canopyCenter: AnchorPoint;
};

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function normalizeSubjectKind(subject: SceneSubject) {
  const text = `${subject.family} ${subject.label}`.toLowerCase();

  if (includesAny(text, ["house", "home", "barn", "hut", "cabin", "shed", "garage"])) {
    return "house";
  }
  if (includesAny(text, ["tree", "oak", "pine", "palm"])) {
    return "tree";
  }
  if (includesAny(text, ["hill", "mountain", "ridge"])) {
    return "hill";
  }
  if (includesAny(text, ["water", "river", "lake", "pond", "stream", "sea"])) {
    return "water";
  }
  if (includesAny(text, ["person", "face", "head", "portrait", "figure", "character"])) {
    return "figure";
  }

  return "generic";
}

function defaultAnchors(subject: SceneSubject): SubjectAnchors {
  const { x, y, width, height } = subject.bbox;
  const center = { x: x + width * 0.5, y: y + height * 0.5 };

  return {
    bounds: subject.bbox,
    center,
    top: { x: center.x, y },
    bottom: { x: center.x, y: y + height },
    left: { x, y: center.y },
    right: { x: x + width, y: center.y },
    roofLeft: { x: x + width * 0.22, y: y + height * 0.22 },
    roofPeak: { x: x + width * 0.5, y: y + height * 0.08 },
    roofRight: { x: x + width * 0.78, y: y + height * 0.22 },
    doorwayCenter: { x: x + width * 0.5, y: y + height * 0.78 },
    groundCenter: { x: x + width * 0.5, y: y + height },
    trunkBase: { x: x + width * 0.5, y: y + height },
    canopyCenter: { x: x + width * 0.5, y: y + height * 0.25 }
  };
}

function pointInExpandedBox(
  x: number,
  y: number,
  bbox: ObjectBoundingBox,
  marginX: number,
  marginY: number
) {
  return (
    x >= bbox.x - marginX &&
    x <= bbox.x + bbox.width + marginX &&
    y >= bbox.y - marginY &&
    y <= bbox.y + bbox.height + marginY
  );
}

function collectContextPoints(subject: SceneSubject, humanContext: PlannerHumanContext[]) {
  const marginX = subject.bbox.width * 0.14;
  const marginY = subject.bbox.height * 0.14;
  const points: AnchorPoint[] = [];

  for (const item of humanContext) {
    if (item.kind === "humanStroke") {
      for (const [x, y] of item.points) {
        if (pointInExpandedBox(x, y, subject.bbox, marginX, marginY)) {
          points.push({ x, y });
        }
      }
      continue;
    }

    if (item.kind === "asciiBlock") {
      if (pointInExpandedBox(item.x, item.y, subject.bbox, marginX, marginY)) {
        points.push({ x: item.x, y: item.y });
      }
      continue;
    }

    const left = item.x - item.width * 0.5;
    const right = item.x + item.width * 0.5;
    const top = item.y - item.height * 0.5;
    const bottom = item.y + item.height * 0.5;

    if (
      pointInExpandedBox(left, top, subject.bbox, marginX, marginY) ||
      pointInExpandedBox(right, bottom, subject.bbox, marginX, marginY)
    ) {
      points.push(
        { x: left, y: top },
        { x: right, y: top },
        { x: left, y: bottom },
        { x: right, y: bottom }
      );
    }
  }

  return points;
}

function averagePoint(points: AnchorPoint[], fallback: AnchorPoint): AnchorPoint {
  if (points.length === 0) {
    return fallback;
  }

  const total = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function minBy(points: AnchorPoint[], selector: (point: AnchorPoint) => number) {
  return points.reduce<AnchorPoint | null>((best, point) => {
    if (!best || selector(point) < selector(best)) {
      return point;
    }
    return best;
  }, null);
}

function maxBy(points: AnchorPoint[], selector: (point: AnchorPoint) => number) {
  return points.reduce<AnchorPoint | null>((best, point) => {
    if (!best || selector(point) > selector(best)) {
      return point;
    }
    return best;
  }, null);
}

export function getSubjectAnchors(
  subject: SceneSubject,
  humanContext: PlannerHumanContext[]
): SubjectAnchors {
  const fallback = defaultAnchors(subject);
  const points = collectContextPoints(subject, humanContext);
  if (points.length < 6) {
    return fallback;
  }

  const center = averagePoint(points, fallback.center);
  const top = minBy(points, (point) => point.y) ?? fallback.top;
  const bottom = maxBy(points, (point) => point.y) ?? fallback.bottom;
  const left = minBy(points, (point) => point.x) ?? fallback.left;
  const right = maxBy(points, (point) => point.x) ?? fallback.right;
  const kind = normalizeSubjectKind(subject);

  if (kind === "house") {
    const roofBand = points.filter((point) => point.y <= subject.bbox.y + subject.bbox.height * 0.42);
    const leftRoofBand = roofBand.filter((point) => point.x <= subject.bbox.x + subject.bbox.width * 0.48);
    const rightRoofBand = roofBand.filter((point) => point.x >= subject.bbox.x + subject.bbox.width * 0.52);
    const doorBand = points.filter(
      (point) =>
        point.y >= subject.bbox.y + subject.bbox.height * 0.58 &&
        point.x >= subject.bbox.x + subject.bbox.width * 0.34 &&
        point.x <= subject.bbox.x + subject.bbox.width * 0.66
    );
    const groundBand = points.filter((point) => point.y >= subject.bbox.y + subject.bbox.height * 0.86);

    return {
      ...fallback,
      center,
      top,
      bottom,
      left,
      right,
      roofPeak: minBy(roofBand, (point) => point.y) ?? fallback.roofPeak,
      roofLeft: minBy(leftRoofBand, (point) => point.x) ?? fallback.roofLeft,
      roofRight: maxBy(rightRoofBand, (point) => point.x) ?? fallback.roofRight,
      doorwayCenter: averagePoint(doorBand, fallback.doorwayCenter),
      groundCenter: averagePoint(groundBand, fallback.groundCenter),
      trunkBase: averagePoint(groundBand, fallback.trunkBase),
      canopyCenter: averagePoint(roofBand, fallback.canopyCenter)
    };
  }

  if (kind === "tree") {
    const canopyBand = points.filter((point) => point.y <= subject.bbox.y + subject.bbox.height * 0.46);
    const trunkBand = points.filter(
      (point) =>
        point.y >= subject.bbox.y + subject.bbox.height * 0.42 &&
        point.x >= subject.bbox.x + subject.bbox.width * 0.34 &&
        point.x <= subject.bbox.x + subject.bbox.width * 0.66
    );
    const groundBand = points.filter((point) => point.y >= subject.bbox.y + subject.bbox.height * 0.86);

    return {
      ...fallback,
      center,
      top,
      bottom,
      left,
      right,
      roofPeak: minBy(canopyBand, (point) => point.y) ?? fallback.roofPeak,
      roofLeft: minBy(canopyBand, (point) => point.x) ?? fallback.roofLeft,
      roofRight: maxBy(canopyBand, (point) => point.x) ?? fallback.roofRight,
      canopyCenter: averagePoint(canopyBand, fallback.canopyCenter),
      trunkBase: averagePoint(groundBand.length > 0 ? groundBand : trunkBand, fallback.trunkBase),
      groundCenter: averagePoint(groundBand, fallback.groundCenter),
      doorwayCenter: averagePoint(trunkBand, fallback.doorwayCenter)
    };
  }

  if (kind === "figure") {
    const headBand = points.filter((point) => point.y <= subject.bbox.y + subject.bbox.height * 0.24);
    const footBand = points.filter((point) => point.y >= subject.bbox.y + subject.bbox.height * 0.84);

    return {
      ...fallback,
      center,
      top,
      bottom,
      left,
      right,
      roofPeak: averagePoint(headBand, fallback.roofPeak),
      groundCenter: averagePoint(footBand, fallback.groundCenter),
      trunkBase: averagePoint(footBand, fallback.trunkBase),
      canopyCenter: averagePoint(headBand, fallback.canopyCenter)
    };
  }

  return {
    ...fallback,
    center,
    top,
    bottom,
    left,
    right
  };
}
