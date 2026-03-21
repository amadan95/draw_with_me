import {
  compiledObjectActionSchema,
  type CompiledObjectAction,
  type ObjectBoundingBox,
  type ObjectFamily,
  type PlannerHumanContext,
  type PlacementHint,
  type RenderedRecipe,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject,
  type StrokeTiming
} from "@/lib/draw-types";
import { getSubjectAnchors } from "@/lib/scene-anchors";

export type SketchRenderInput = {
  canvasWidth: number;
  canvasHeight: number;
  palette: string[];
  humanDelta: PlannerHumanContext[];
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

type RecipeKey =
  | "house"
  | "tree"
  | "chimney"
  | "smoke"
  | "cloud"
  | "sun"
  | "moon"
  | "bird"
  | "grass"
  | "bush"
  | "flower"
  | "fence"
  | "path"
  | "hill"
  | "water"
  | "mailbox"
  | "lamp"
  | "bench"
  | "flag"
  | "animal"
  | "vehicle"
  | "tool"
  | "garden"
  | "face"
  | "structure"
  | "figure"
  | "loop";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed: string) {
  let state = hashString(seed) || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519);
    state ^= state + Math.imul(state ^ (state >>> 7), 3266489917);
    return ((state ^ (state >>> 16)) >>> 0) / 4294967295;
  };
}

function jitter(rng: () => number, amount: number) {
  return (rng() - 0.5) * amount * 2;
}

function point(
  x: number,
  y: number,
  input: SketchRenderInput
): [number, number] {
  return [
    Math.round(clamp(x, 0, input.canvasWidth)),
    Math.round(clamp(y, 0, input.canvasHeight))
  ];
}

function action(
  input: SketchRenderInput,
  config: Omit<CompiledObjectAction, "points"> & { points: Array<[number, number]> }
) {
  const requestedSpeed = config.timing?.speed ?? 1;
  const requestedPause = config.timing?.pauseAfterMs ?? 70;
  const timing: StrokeTiming = {
    speed: clamp(requestedSpeed * 0.62, 0.22, 1.25),
    pauseAfterMs: Math.round(clamp(requestedPause + 55, 40, 420))
  };

  return compiledObjectActionSchema.parse({
    ...config,
    timing,
    points: config.points.map(([x, y]) => point(x, y, input))
  });
}

function bboxToBounds(bbox: ObjectBoundingBox): Bounds {
  return {
    minX: bbox.x,
    minY: bbox.y,
    maxX: bbox.x + bbox.width,
    maxY: bbox.y + bbox.height,
    width: bbox.width,
    height: bbox.height
  };
}

function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t;
}

function clampRatio(value: number | undefined, fallback: number) {
  return clamp(value ?? fallback, 0, 1);
}

function getHintedSize(
  base: Bounds,
  defaults: { width: number; height: number },
  addition: SceneAddition,
  input: SketchRenderInput
) {
  let width = addition.scaleHint?.widthRatio
    ? base.width * addition.scaleHint.widthRatio
    : defaults.width;
  let height = addition.scaleHint?.heightRatio
    ? base.height * addition.scaleHint.heightRatio
    : defaults.height;

  if (addition.orientationHint === "horizontal" && height > width) {
    [width, height] = [height, width];
  }
  if (
    (addition.orientationHint === "vertical" || addition.orientationHint === "upright") &&
    width > height
  ) {
    [width, height] = [height, width];
  }

  return {
    width: clamp(width, 18, input.canvasWidth * 0.85),
    height: clamp(height, 18, input.canvasHeight * 0.85)
  };
}

function applyHintBias(
  origin: { x: number; y: number },
  base: Bounds,
  hint: PlacementHint | undefined
) {
  const x = origin.x + (hint?.biasX ?? 0) * Math.min(base.width * 0.16, 64);
  const y = origin.y + (hint?.biasY ?? 0) * Math.min(base.height * 0.16, 64);
  return { x, y };
}

function makeBoxFromCenter(
  center: { x: number; y: number },
  size: { width: number; height: number },
  input: SketchRenderInput
) {
  return fitBox(
    {
      x: center.x - size.width * 0.5,
      y: center.y - size.height * 0.5,
      width: size.width,
      height: size.height
    },
    input
  );
}

function placeBesideTarget(
  targetBounds: Bounds,
  targetAnchors: ReturnType<typeof getSubjectAnchors> | null,
  size: { width: number; height: number },
  side: "left" | "right",
  hint: PlacementHint | undefined,
  input: SketchRenderInput,
  verticalMode: "ground" | "middle" = "ground"
) {
  const distanceFactor = clampRatio(hint?.xRatio, 0.5);
  const gap = clamp(
    targetBounds.width * 0.06 + size.width * (0.08 + distanceFactor * 0.18),
    10,
    52
  );

  const centerX =
    side === "left"
      ? targetBounds.minX - gap - size.width * 0.5
      : targetBounds.maxX + gap + size.width * 0.5;

  const centerY =
    verticalMode === "ground"
      ? (targetAnchors?.groundCenter.y ?? targetBounds.maxY) - size.height * 0.46
      : targetBounds.minY + targetBounds.height * clampRatio(hint?.yRatio, 0.68);

  const biasedOrigin = applyHintBias(
    {
      x: centerX - size.width * 0.5,
      y: centerY - size.height * 0.5
    },
    targetBounds,
    {
      biasX:
        side === "left"
          ? Math.min(0, hint?.biasX ?? 0)
          : Math.max(0, hint?.biasX ?? 0),
      biasY: hint?.biasY
    }
  );

  return boxFromOrigin(
    biasedOrigin.x,
    biasedOrigin.y,
    size.width,
    size.height,
    input
  );
}

function getSceneBounds(
  analysis: SceneAnalysis,
  input: SketchRenderInput
): Bounds {
  if (analysis.subjects.length === 0) {
    const width = input.canvasWidth * 0.4;
    const height = input.canvasHeight * 0.35;
    return {
      minX: input.canvasWidth * 0.3,
      minY: input.canvasHeight * 0.28,
      maxX: input.canvasWidth * 0.7,
      maxY: input.canvasHeight * 0.63,
      width,
      height
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const subject of analysis.subjects) {
    minX = Math.min(minX, subject.bbox.x);
    minY = Math.min(minY, subject.bbox.y);
    maxX = Math.max(maxX, subject.bbox.x + subject.bbox.width);
    maxY = Math.max(maxY, subject.bbox.y + subject.bbox.height);
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

function familyLabel(family: ObjectFamily) {
  return family.replaceAll("_", " ");
}

function familyPhrase(family: ObjectFamily) {
  switch (family) {
    case "grass":
      return "grass";
    case "water":
      return "water";
    case "smoke":
      return "smoke";
    default:
      return `a ${familyLabel(family)}`;
  }
}

function getRecipeKey(family: ObjectFamily): RecipeKey {
  const text = family.toLowerCase();

  if (includesAny(text, ["house", "home", "barn", "hut", "cabin", "shed", "garage"])) {
    return "house";
  }
  if (includesAny(text, ["tree", "oak", "pine", "palm"])) {
    return "tree";
  }
  if (includesAny(text, ["chimney", "stack", "flue"])) {
    return "chimney";
  }
  if (includesAny(text, ["smoke", "steam", "plume", "mist"])) {
    return "smoke";
  }
  if (includesAny(text, ["cloud"])) {
    return "cloud";
  }
  if (includesAny(text, ["sun", "star", "balloon"])) {
    return "sun";
  }
  if (includesAny(text, ["moon", "crescent"])) {
    return "moon";
  }
  if (includesAny(text, ["bird"])) {
    return "bird";
  }
  if (includesAny(text, ["grass", "reed", "weed", "lawn", "tuft"])) {
    return "grass";
  }
  if (includesAny(text, ["bush", "shrub", "hedge", "foliage", "leaf"])) {
    return "bush";
  }
  if (includesAny(text, ["flower", "rose", "daisy", "petal", "tulip", "bloom"])) {
    return "flower";
  }
  if (includesAny(text, ["garden", "planter", "flower patch", "bed", "window box"])) {
    return "garden";
  }
  if (includesAny(text, ["fence", "gate", "railing"])) {
    return "fence";
  }
  if (includesAny(text, ["path", "trail", "road", "sidewalk", "walkway", "porch"])) {
    return "path";
  }
  if (includesAny(text, ["hill", "mountain", "ridge"])) {
    return "hill";
  }
  if (includesAny(text, ["water", "river", "lake", "pond", "ocean", "stream", "sea"])) {
    return "water";
  }
  if (includesAny(text, ["mailbox", "postbox"])) {
    return "mailbox";
  }
  if (includesAny(text, ["lamp", "lantern", "porch light", "streetlight"])) {
    return "lamp";
  }
  if (includesAny(text, ["bench", "chair", "table", "stool"])) {
    return "bench";
  }
  if (includesAny(text, ["flag", "banner", "pennant"])) {
    return "flag";
  }
  if (includesAny(text, ["animal", "cat", "dog", "horse", "rabbit", "birdhouse"])) {
    return "animal";
  }
  if (includesAny(text, ["car", "truck", "bike", "bicycle", "wagon", "vehicle"])) {
    return "vehicle";
  }
  if (includesAny(text, ["tool", "shovel", "rake", "watering can", "broom"])) {
    return "tool";
  }
  if (includesAny(text, ["face", "head", "portrait"])) {
    return "face";
  }
  if (includesAny(text, ["person", "cat", "dog", "horse", "animal", "figure", "character"])) {
    return "figure";
  }
  if (includesAny(text, ["mailbox", "sign", "lamp", "post", "window", "door", "bench", "well", "crate"])) {
    return "structure";
  }

  return "loop";
}

function familyNeedsTarget(family: ObjectFamily) {
  const key = getRecipeKey(family);
  return (
    key === "chimney" ||
    key === "smoke" ||
    key === "path" ||
    key === "flag" ||
    key === "garden"
  );
}

function preferredTargetFamilies(family: ObjectFamily): ObjectFamily[] {
  switch (getRecipeKey(family)) {
    case "chimney":
    case "path":
      return ["house"];
    case "smoke":
      return ["chimney", "house"];
    case "flag":
      return ["house", "bench"];
    case "grass":
    case "bush":
    case "flower":
    case "garden":
    case "fence":
    case "mailbox":
    case "lamp":
    case "bench":
    case "tool":
    case "structure":
      return ["house", "tree", "hill"];
    case "tree":
    case "figure":
    case "animal":
    case "vehicle":
      return ["house", "hill"];
    default:
      return [];
  }
}

function matchesSubject(subject: SceneSubject, family: ObjectFamily) {
  return (
    includesAny(subject.family, [family]) ||
    includesAny(subject.label, [family]) ||
    getRecipeKey(subject.family) === getRecipeKey(family)
  );
}

function resolveTargetSubject(
  analysis: SceneAnalysis,
  addition: SceneAddition
): SceneSubject | null {
  if (addition.targetSubjectId) {
    const direct = analysis.subjects.find((subject) => subject.id === addition.targetSubjectId);
    if (direct) {
      return direct;
    }
  }

  const preferred = preferredTargetFamilies(addition.family);
  if (preferred.length === 0) {
    return null;
  }

  for (const family of preferred) {
    const match = analysis.subjects.find((subject) => matchesSubject(subject, family));
    if (match) {
      return match;
    }
  }

  return null;
}

function fitBox(
  box: ObjectBoundingBox,
  input: SketchRenderInput
): ObjectBoundingBox {
  return {
    x: Math.round(clamp(box.x, 0, Math.max(0, input.canvasWidth - box.width))),
    y: Math.round(clamp(box.y, 0, Math.max(0, input.canvasHeight - box.height))),
    width: Math.round(clamp(box.width, 20, input.canvasWidth)),
    height: Math.round(clamp(box.height, 20, input.canvasHeight))
  };
}

function boxCenter(box: ObjectBoundingBox) {
  return {
    x: box.x + box.width * 0.5,
    y: box.y + box.height * 0.5
  };
}

function intersectArea(a: ObjectBoundingBox, b: ObjectBoundingBox) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  if (right <= left || bottom <= top) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

function translateBox(
  box: ObjectBoundingBox,
  dx: number,
  dy: number,
  input: SketchRenderInput
) {
  return fitBox(
    {
      x: box.x + dx,
      y: box.y + dy,
      width: box.width,
      height: box.height
    },
    input
  );
}

function scaleBoxFromCenter(
  box: ObjectBoundingBox,
  scale: number,
  input: SketchRenderInput
) {
  const center = boxCenter(box);
  return fitBox(
    {
      x: center.x - (box.width * scale) / 2,
      y: center.y - (box.height * scale) / 2,
      width: box.width * scale,
      height: box.height * scale
    },
    input
  );
}

function boxFromOrigin(
  x: number,
  y: number,
  width: number,
  height: number,
  input: SketchRenderInput
) {
  return fitBox({ x, y, width, height }, input);
}

function getRoofPoint(
  relation: SceneAddition["relation"],
  hint: PlacementHint | undefined,
  anchors: ReturnType<typeof getSubjectAnchors>
) {
  if (relation === "attach_roof_left") {
    const t = clampRatio(hint?.xRatio, 0.56);
    return {
      x: lerp(anchors.roofLeft.x, anchors.roofPeak.x, t),
      y: lerp(anchors.roofLeft.y, anchors.roofPeak.y, t)
    };
  }

  if (relation === "attach_roof_center") {
    const offset = (hint?.biasX ?? 0) * 14;
    return {
      x: anchors.roofPeak.x + offset,
      y: anchors.roofPeak.y + (hint?.biasY ?? 0) * 8
    };
  }

  const t = clampRatio(hint?.xRatio, 0.42);
  return {
    x: lerp(anchors.roofPeak.x, anchors.roofRight.x, t),
    y: lerp(anchors.roofPeak.y, anchors.roofRight.y, t)
  };
}

function resolvePlacementBox(
  addition: SceneAddition,
  target: SceneSubject | null,
  analysis: SceneAnalysis,
  input: SketchRenderInput
) {
  const targetBounds = target ? bboxToBounds(target.bbox) : null;
  const targetAnchors = target ? getSubjectAnchors(target, input.humanDelta) : null;
  const sceneBounds = getSceneBounds(analysis, input);
  const base = targetBounds ?? sceneBounds;
  const key = getRecipeKey(addition.family);

  const rel = addition.relation;
  const small = Math.max(28, Math.min(base.width, base.height) * 0.18);
  const mediumW = Math.max(38, base.width * 0.22);
  const mediumH = Math.max(34, base.height * 0.18);
  const hint = addition.placementHint;

  const centeredBox = (
    width: number,
    height: number,
    fallbackXR: number,
    fallbackYR: number,
    bounds: Bounds = base
  ) => {
    const center = {
      x: bounds.minX + bounds.width * clampRatio(hint?.xRatio, fallbackXR),
      y: bounds.minY + bounds.height * clampRatio(hint?.yRatio, fallbackYR)
    };
    const biased = applyHintBias(
      { x: center.x - width * 0.5, y: center.y - height * 0.5 },
      bounds,
      hint
    );
    return boxFromOrigin(biased.x, biased.y, width, height, input);
  };

  switch (key) {
    case "chimney": {
      if (!targetBounds || !targetAnchors) {
        return null;
      }
      const size = getHintedSize(
        targetBounds,
        {
          width: Math.max(22, targetBounds.width * 0.14),
          height: Math.max(44, targetBounds.height * 0.26)
        },
        addition,
        input
      );
      const roofPoint = getRoofPoint(rel, hint, targetAnchors);
      const origin = applyHintBias(
        {
          x: roofPoint.x - size.width * 0.44,
          y: roofPoint.y - size.height * 0.84
        },
        targetBounds,
        hint
      );
      return boxFromOrigin(origin.x, origin.y, size.width, size.height, input);
    }
    case "smoke": {
      const size = getHintedSize(
        base,
        {
          width: Math.max(34, mediumW * 0.9),
          height: Math.max(46, mediumH * 1.3)
        },
        addition,
        input
      );
      const center = targetAnchors
        ? {
            x: getRoofPoint("attach_roof_right", hint, targetAnchors).x + size.width * 0.18,
            y: targetAnchors.roofPeak.y - size.height * 0.3
          }
        : {
            x: base.minX + base.width * clampRatio(hint?.xRatio, 0.6),
            y: base.minY - size.height * 0.2
          };
      return makeBoxFromCenter(center, size, input);
    }
    case "cloud": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(68, sceneBounds.width * 0.18),
          height: Math.max(36, sceneBounds.height * 0.1)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "sky_above_left" ? 0.24 : rel === "sky_above_right" ? 0.78 : 0.56,
        0.02,
        targetBounds ?? sceneBounds
      );
    }
    case "sun":
    case "moon": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(34, sceneBounds.width * 0.11),
          height: Math.max(34, sceneBounds.width * 0.11)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "sky_above_left" ? 0.14 : 0.82,
        0.02,
        sceneBounds
      );
    }
    case "bird": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(22, small),
          height: Math.max(14, small * 0.55)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "sky_above_right" ? 0.76 : rel === "sky_above_left" ? 0.26 : 0.56,
        0.08,
        sceneBounds
      );
    }
    case "grass": {
      const size = getHintedSize(
        targetBounds ?? sceneBounds,
        {
          width: Math.max(60, (targetBounds ?? sceneBounds).width * 0.42),
          height: Math.max(24, (targetBounds ?? sceneBounds).height * 0.12)
        },
        addition,
        input
      );
      return centeredBox(size.width, size.height, 0.5, 0.96, targetBounds ?? sceneBounds);
    }
    case "bush": {
      const size = getHintedSize(
        base,
        {
          width: Math.max(52, mediumW),
          height: Math.max(34, mediumH)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" || rel === "ground_left" ? 0.12 : rel === "ground_right" || rel === "beside_right" ? 0.84 : 0.62,
        0.88,
        base
      );
    }
    case "flower": {
      const size = getHintedSize(
        base,
        {
          width: Math.max(28, small * 0.8),
          height: Math.max(56, small * 1.6)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.22 : rel === "beside_right" ? 0.8 : 0.36,
        0.82,
        base
      );
    }
    case "fence": {
      const size = getHintedSize(
        targetBounds ?? sceneBounds,
        {
          width: Math.max(70, (targetBounds ?? sceneBounds).width * 0.48),
          height: Math.max(32, (targetBounds ?? sceneBounds).height * 0.16)
        },
        addition,
        input
      );
      return centeredBox(size.width, size.height, 0.5, 0.9, targetBounds ?? sceneBounds);
    }
    case "path": {
      if (!targetBounds || !targetAnchors) {
        return null;
      }
      const size = getHintedSize(
        targetBounds,
        {
          width: Math.max(42, targetBounds.width * 0.34),
          height: Math.max(58, targetBounds.height * 0.45)
        },
        addition,
        input
      );
      const doorway = targetAnchors.doorwayCenter;
      const origin = applyHintBias(
        {
          x: doorway.x - size.width * 0.5,
          y: doorway.y - size.height * 0.08
        },
        targetBounds,
        hint
      );
      return boxFromOrigin(origin.x, origin.y, size.width, size.height, input);
    }
    case "hill": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(120, sceneBounds.width * 0.6),
          height: Math.max(40, sceneBounds.height * 0.18)
        },
        addition,
        input
      );
      return centeredBox(size.width, size.height, 0.5, 0.94, sceneBounds);
    }
    case "water": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(84, sceneBounds.width * 0.32),
          height: Math.max(26, sceneBounds.height * 0.1)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "ground_left" ? 0.24 : rel === "ground_right" ? 0.76 : 0.5,
        0.94,
        sceneBounds
      );
    }
    case "tree": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(58, sceneBounds.width * 0.16),
          height: Math.max(120, sceneBounds.height * 0.42)
        },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.18 : 0.82,
        0.74,
        base
      );
    }
    case "house": {
      const size = getHintedSize(
        sceneBounds,
        {
          width: Math.max(84, sceneBounds.width * 0.24),
          height: Math.max(92, sceneBounds.height * 0.28)
        },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.18 : 0.82,
        0.76,
        base
      );
    }
    case "mailbox": {
      const size = getHintedSize(
        base,
        { width: Math.max(28, mediumW * 0.54), height: Math.max(58, mediumH * 1.55) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.22 : 0.78,
        0.82,
        base
      );
    }
    case "lamp": {
      const size = getHintedSize(
        base,
        { width: Math.max(24, mediumW * 0.48), height: Math.max(76, mediumH * 1.95) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.2 : 0.8,
        0.78,
        base
      );
    }
    case "bench": {
      const size = getHintedSize(
        base,
        { width: Math.max(52, mediumW), height: Math.max(42, mediumH) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.22 : rel === "beside_right" ? 0.78 : 0.5,
        0.9,
        base
      );
    }
    case "flag": {
      const size = getHintedSize(
        base,
        { width: Math.max(30, mediumW * 0.6), height: Math.max(86, mediumH * 2.1) },
        addition,
        input
      );
      if (targetAnchors && rel.startsWith("attach_roof")) {
        const roofPoint = getRoofPoint(rel, hint, targetAnchors);
        const origin = applyHintBias(
          {
            x: roofPoint.x - size.width * 0.22,
            y: roofPoint.y - size.height * 0.9
          },
          targetBounds ?? base,
          hint
        );
        return boxFromOrigin(origin.x, origin.y, size.width, size.height, input);
      }
      return centeredBox(size.width, size.height, 0.82, 0.66, base);
    }
    case "animal": {
      const size = getHintedSize(
        base,
        { width: Math.max(52, mediumW), height: Math.max(46, mediumH * 1.2) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.24 : rel === "beside_right" ? 0.76 : 0.56,
        0.9,
        base
      );
    }
    case "vehicle": {
      const size = getHintedSize(
        base,
        { width: Math.max(68, mediumW * 1.1), height: Math.max(34, mediumH * 0.9) },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "ground_left" ? 0.24 : rel === "ground_right" ? 0.76 : 0.56,
        0.92,
        base
      );
    }
    case "tool": {
      const size = getHintedSize(
        base,
        { width: Math.max(26, mediumW * 0.48), height: Math.max(72, mediumH * 1.8) },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.2 : 0.8,
        0.82,
        base
      );
    }
    case "garden": {
      const size = getHintedSize(
        base,
        { width: Math.max(66, mediumW * 1.1), height: Math.max(42, mediumH * 1.05) },
        addition,
        input
      );
      return centeredBox(
        size.width,
        size.height,
        rel === "ground_left" ? 0.26 : rel === "ground_right" ? 0.74 : 0.5,
        0.9,
        base
      );
    }
    case "structure": {
      const size = getHintedSize(
        base,
        { width: Math.max(28, mediumW * 0.75), height: Math.max(52, mediumH * 1.55) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "middle"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.2 : rel === "sky_above" ? 0.5 : 0.8,
        rel === "sky_above" ? 0.04 : 0.82,
        base
      );
    }
    case "figure": {
      const size = getHintedSize(
        base,
        { width: Math.max(34, small), height: Math.max(72, mediumH * 1.9) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "ground"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "beside_left" ? 0.24 : 0.76,
        0.8,
        base
      );
    }
    case "loop": {
      const size = getHintedSize(
        base,
        { width: Math.max(40, mediumW * 0.95), height: Math.max(34, mediumH * 0.95) },
        addition,
        input
      );
      if (targetBounds && targetAnchors && (rel === "beside_left" || rel === "beside_right")) {
        return placeBesideTarget(
          targetBounds,
          targetAnchors,
          size,
          rel === "beside_left" ? "left" : "right",
          hint,
          input,
          "middle"
        );
      }
      return centeredBox(
        size.width,
        size.height,
        rel === "sky_above" ? 0.5 : rel === "beside_left" ? 0.22 : rel === "beside_right" ? 0.78 : 0.56,
        rel === "sky_above" ? 0.08 : rel === "ground_front" ? 0.88 : 0.5,
        base
      );
    }
    default:
      return null;
  }
}

function adjustPlacementForCollisions(
  box: ObjectBoundingBox,
  addition: SceneAddition,
  target: SceneSubject | null,
  analysis: SceneAnalysis,
  input: SketchRenderInput
) {
  let adjusted = box;
  const attached = addition.relation.startsWith("attach_roof");
  const targetId = target?.id ?? null;

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;

    for (const subject of analysis.subjects) {
      if (subject.id === targetId) {
        continue;
      }

      const overlap = intersectArea(adjusted, subject.bbox);
      const adjustedArea = adjusted.width * adjusted.height;
      if (overlap <= adjustedArea * 0.12) {
        continue;
      }

      changed = true;
      const subjectCenter = boxCenter(subject.bbox);
      const adjustedCenter = boxCenter(adjusted);
      const moveLeft = adjustedCenter.x < subjectCenter.x;
      const dx = moveLeft
        ? -(overlap / Math.max(1, adjusted.height)) - 18
        : overlap / Math.max(1, adjusted.height) + 18;
      const dy =
        addition.relation.startsWith("sky_")
          ? -12
          : addition.relation.startsWith("ground_") || addition.relation === "ground_front"
            ? 10
            : 0;
      adjusted = translateBox(adjusted, dx, dy, input);
    }

    if (target && !attached) {
      const overlap = intersectArea(adjusted, target.bbox);
      const adjustedArea = adjusted.width * adjusted.height;
      if (overlap > 0 && (addition.relation === "beside_left" || addition.relation === "beside_right")) {
        changed = true;
        const gap = clamp(target.bbox.width * 0.05, 10, 28);
        adjusted =
          addition.relation === "beside_left"
            ? fitBox(
                {
                  x: target.bbox.x - adjusted.width - gap,
                  y: adjusted.y,
                  width: adjusted.width,
                  height: adjusted.height
                },
                input
              )
            : fitBox(
                {
                  x: target.bbox.x + target.bbox.width + gap,
                  y: adjusted.y,
                  width: adjusted.width,
                  height: adjusted.height
                },
                input
              );
      }
      if (overlap > adjustedArea * 0.28) {
        changed = true;
        adjusted = scaleBoxFromCenter(adjusted, 0.88, input);
      }
    }

    if (!changed) {
      break;
    }
  }

  return adjusted;
}

function getStrokeColors(family: ObjectFamily, palette: string[]) {
  const key = getRecipeKey(family);
  const ink = palette[0] ?? "#262523";
  const cool = palette[1] ?? ink;
  const warm = palette[3] ?? palette[2] ?? ink;
  const organic = palette[4] ?? ink;

  switch (key) {
    case "sun":
      return { primary: warm, secondary: ink };
    case "water":
      return { primary: cool, secondary: ink };
    case "flower":
    case "flag":
      return { primary: ink, secondary: warm };
    case "grass":
    case "bush":
    case "tree":
    case "garden":
      return { primary: organic, secondary: ink };
    default:
      return { primary: ink, secondary: ink };
  }
}

function renderChimney(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x + bbox.width * 0.24 + jitter(rng, 2);
  const right = bbox.x + bbox.width * 0.76 + jitter(rng, 2);
  const top = bbox.y + bbox.height * 0.12 + jitter(rng, 2);
  const bottom = bbox.y + bbox.height + jitter(rng, 3);

  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 4,
      opacity: 0.94,
      points: [
        [left, bottom],
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom]
      ],
      timing: { speed: 1, pauseAfterMs: 90 }
    })
  ];
}

function renderSmoke(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x;
  const top = bbox.y;
  const w = bbox.width;
  const h = bbox.height;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.68,
      points: [
        [left + w * 0.18, top + h * 0.85],
        [left + w * 0.32 + jitter(rng, 6), top + h * 0.55],
        [left + w * 0.24 + jitter(rng, 8), top + h * 0.34],
        [left + w * 0.42 + jitter(rng, 8), top + h * 0.14]
      ],
      timing: { speed: 1.08, pauseAfterMs: 60 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.54,
      points: [
        [left + w * 0.42, top + h * 0.68],
        [left + w * 0.58 + jitter(rng, 6), top + h * 0.48],
        [left + w * 0.5 + jitter(rng, 8), top + h * 0.24],
        [left + w * 0.7 + jitter(rng, 8), top + h * 0.08]
      ],
      timing: { speed: 1.1, pauseAfterMs: 90 }
    })
  ];
}

function renderCloud(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x;
  const top = bbox.y;
  const right = bbox.x + bbox.width;
  const centerY = bbox.y + bbox.height * 0.55;

  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.5,
      opacity: 0.86,
      points: [
        [left + bbox.width * 0.12, centerY],
        [left + bbox.width * 0.28 + jitter(rng, 6), top + bbox.height * 0.1],
        [left + bbox.width * 0.5, centerY - bbox.height * 0.12],
        [left + bbox.width * 0.72 + jitter(rng, 5), top + bbox.height * 0.14],
        [right - bbox.width * 0.12, centerY]
      ],
      timing: { speed: 1.05, pauseAfterMs: 80 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.7,
      points: [
        [left + bbox.width * 0.2, centerY + bbox.height * 0.06],
        [left + bbox.width * 0.38, bbox.y + bbox.height * 0.82],
        [left + bbox.width * 0.62, bbox.y + bbox.height * 0.8],
        [right - bbox.width * 0.16, centerY + bbox.height * 0.04]
      ],
      timing: { speed: 1.05, pauseAfterMs: 100 }
    })
  ];
}

function renderSun(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const cx = bbox.x + bbox.width * 0.5;
  const cy = bbox.y + bbox.height * 0.5;
  const r = bbox.width * 0.34;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.5,
      opacity: 0.88,
      points: [
        [cx - r, cy],
        [cx - r * 0.2, cy - r],
        [cx + r, cy],
        [cx + r * 0.16, cy + r],
        [cx - r, cy]
      ],
      timing: { speed: 1.08, pauseAfterMs: 80 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.72,
      points: [
        [cx, bbox.y + jitter(rng, 2)],
        [cx, bbox.y - bbox.height * 0.18]
      ],
      timing: { speed: 1.15, pauseAfterMs: 30 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.72,
      points: [
        [bbox.x + bbox.width * 0.16, cy - bbox.height * 0.1],
        [bbox.x - bbox.width * 0.06, cy - bbox.height * 0.18]
      ],
      timing: { speed: 1.15, pauseAfterMs: 50 }
    })
  ];
}

function renderMoon(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x + bbox.width * 0.22;
  const top = bbox.y + bbox.height * 0.14;
  const right = bbox.x + bbox.width * 0.74;
  const bottom = bbox.y + bbox.height * 0.86;
  return [
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 3.2,
      opacity: 0.84,
      points: [
        [left, bottom - bbox.height * 0.14],
        [left - bbox.width * 0.04, bbox.y + bbox.height * 0.42],
        [left + bbox.width * 0.1, top],
        [right, bbox.y + bbox.height * 0.24]
      ],
      timing: { speed: 1.05, pauseAfterMs: 70 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.7,
      points: [
        [bbox.x + bbox.width * 0.44, bottom],
        [bbox.x + bbox.width * 0.24, bbox.y + bbox.height * 0.52],
        [bbox.x + bbox.width * 0.54, top + jitter(rng, 3)]
      ],
      timing: { speed: 1.1, pauseAfterMs: 90 }
    })
  ];
}

function renderBird(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const y = bbox.y + bbox.height * 0.5;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.88,
      points: [
        [bbox.x, y],
        [bbox.x + bbox.width * 0.24, bbox.y + jitter(rng, 4)],
        [bbox.x + bbox.width * 0.48, y]
      ],
      timing: { speed: 1.2, pauseAfterMs: 30 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.88,
      points: [
        [bbox.x + bbox.width * 0.48, y],
        [bbox.x + bbox.width * 0.72, bbox.y + jitter(rng, 4)],
        [bbox.x + bbox.width, y]
      ],
      timing: { speed: 1.2, pauseAfterMs: 60 }
    })
  ];
}

function renderGrass(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [0.12, 0.28, 0.44, 0.62, 0.8].map((offset, index) =>
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.86,
      points: [
        [bbox.x + bbox.width * offset, bbox.y + bbox.height],
        [bbox.x + bbox.width * (offset - 0.04) + jitter(rng, 3), bbox.y + bbox.height * 0.58],
        [bbox.x + bbox.width * offset + jitter(rng, 4), bbox.y + bbox.height * (0.12 + index * 0.02)]
      ],
      timing: { speed: 1.1, pauseAfterMs: 28 }
    })
  );
}

function renderBush(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.84,
      points: [
        [bbox.x + bbox.width * 0.12, bbox.y + bbox.height * 0.74],
        [bbox.x + bbox.width * 0.24, bbox.y + bbox.height * 0.18],
        [bbox.x + bbox.width * 0.46, bbox.y + bbox.height * 0.26],
        [bbox.x + bbox.width * 0.56, bbox.y + bbox.height * 0.04],
        [bbox.x + bbox.width * 0.78, bbox.y + bbox.height * 0.22],
        [bbox.x + bbox.width * 0.88, bbox.y + bbox.height * 0.68]
      ],
      timing: { speed: 1.02, pauseAfterMs: 80 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.6,
      opacity: 0.5,
      points: [
        [bbox.x + bbox.width * 0.18, bbox.y + bbox.height * 0.76],
        [bbox.x + bbox.width * 0.44 + jitter(rng, 5), bbox.y + bbox.height * 0.84],
        [bbox.x + bbox.width * 0.8, bbox.y + bbox.height * 0.74]
      ],
      timing: { speed: 1.06, pauseAfterMs: 100 }
    })
  ];
}

function renderFlower(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const stemX = bbox.x + bbox.width * 0.52;
  const bloomY = bbox.y + bbox.height * 0.2;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.84,
      points: [
        [stemX, bbox.y + bbox.height],
        [stemX + jitter(rng, 4), bbox.y + bbox.height * 0.66],
        [stemX + jitter(rng, 6), bbox.y + bbox.height * 0.38],
        [stemX, bloomY + bbox.height * 0.14]
      ],
      timing: { speed: 1.08, pauseAfterMs: 35 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 3,
      opacity: 0.82,
      points: [
        [stemX - bbox.width * 0.2, bloomY + bbox.height * 0.1],
        [stemX, bloomY - bbox.height * 0.06],
        [stemX + bbox.width * 0.2, bloomY + bbox.height * 0.1],
        [stemX, bloomY + bbox.height * 0.26],
        [stemX - bbox.width * 0.2, bloomY + bbox.height * 0.1]
      ],
      timing: { speed: 1.05, pauseAfterMs: 70 }
    })
  ];
}

function renderFence(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const posts = [0.16, 0.36, 0.58, 0.8];
  return [
    ...posts.map((offset) =>
      action(input, {
        tool: "brush",
        color: colors.primary,
        width: 3,
        opacity: 0.86,
        points: [
          [bbox.x + bbox.width * offset, bbox.y + bbox.height],
          [bbox.x + bbox.width * offset + jitter(rng, 2), bbox.y + bbox.height * 0.2]
        ],
        timing: { speed: 1.08, pauseAfterMs: 20 }
      })
    ),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.6,
      opacity: 0.76,
      points: [
        [bbox.x + bbox.width * 0.12, bbox.y + bbox.height * 0.44],
        [bbox.x + bbox.width * 0.88, bbox.y + bbox.height * 0.44]
      ],
      timing: { speed: 1.12, pauseAfterMs: 80 }
    })
  ];
}

function renderPath(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.82,
      points: [
        [bbox.x + bbox.width * 0.42, bbox.y],
        [bbox.x + bbox.width * 0.3 + jitter(rng, 4), bbox.y + bbox.height * 0.48],
        [bbox.x + bbox.width * 0.18, bbox.y + bbox.height]
      ],
      timing: { speed: 1, pauseAfterMs: 50 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.72,
      points: [
        [bbox.x + bbox.width * 0.58, bbox.y],
        [bbox.x + bbox.width * 0.72 + jitter(rng, 4), bbox.y + bbox.height * 0.48],
        [bbox.x + bbox.width * 0.84, bbox.y + bbox.height]
      ],
      timing: { speed: 1.05, pauseAfterMs: 90 }
    })
  ];
}

function renderHill(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.8,
      points: [
        [bbox.x, bbox.y + bbox.height],
        [bbox.x + bbox.width * 0.24, bbox.y + bbox.height * 0.24 + jitter(rng, 6)],
        [bbox.x + bbox.width * 0.52, bbox.y + bbox.height * 0.14 + jitter(rng, 6)],
        [bbox.x + bbox.width * 0.78, bbox.y + bbox.height * 0.4 + jitter(rng, 6)],
        [bbox.x + bbox.width, bbox.y + bbox.height]
      ],
      timing: { speed: 1.02, pauseAfterMs: 90 }
    })
  ];
}

function renderWater(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const makeWave = (offsetY: number) =>
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.76,
      points: [
        [bbox.x, bbox.y + offsetY],
        [bbox.x + bbox.width * 0.24, bbox.y + offsetY - bbox.height * 0.22 + jitter(rng, 3)],
        [bbox.x + bbox.width * 0.5, bbox.y + offsetY + jitter(rng, 2)],
        [bbox.x + bbox.width * 0.76, bbox.y + offsetY - bbox.height * 0.18 + jitter(rng, 3)],
        [bbox.x + bbox.width, bbox.y + offsetY]
      ],
      timing: { speed: 1.1, pauseAfterMs: 45 }
    });

  return [makeWave(bbox.height * 0.38), makeWave(bbox.height * 0.72)];
}

function renderTree(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const trunkX = bbox.x + bbox.width * 0.5;
  const canopyTop = bbox.y;
  const canopyBottom = bbox.y + bbox.height * 0.46;
  return [
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 3.6,
      opacity: 0.88,
      points: [
        [trunkX - bbox.width * 0.08, bbox.y + bbox.height],
        [trunkX - bbox.width * 0.04 + jitter(rng, 3), bbox.y + bbox.height * 0.7],
        [trunkX - bbox.width * 0.02, canopyBottom]
      ],
      timing: { speed: 1, pauseAfterMs: 26 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 3.6,
      opacity: 0.88,
      points: [
        [trunkX + bbox.width * 0.08, bbox.y + bbox.height],
        [trunkX + bbox.width * 0.04 + jitter(rng, 3), bbox.y + bbox.height * 0.7],
        [trunkX + bbox.width * 0.02, canopyBottom]
      ],
      timing: { speed: 1.02, pauseAfterMs: 42 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.4,
      opacity: 0.82,
      points: [
        [bbox.x + bbox.width * 0.14, canopyBottom],
        [bbox.x + bbox.width * 0.22, canopyTop + bbox.height * 0.12],
        [bbox.x + bbox.width * 0.46, canopyTop + jitter(rng, 6)],
        [bbox.x + bbox.width * 0.68, canopyTop + bbox.height * 0.16],
        [bbox.x + bbox.width * 0.86, canopyBottom],
        [bbox.x + bbox.width * 0.64, canopyBottom + bbox.height * 0.12],
        [bbox.x + bbox.width * 0.34, canopyBottom + bbox.height * 0.12],
        [bbox.x + bbox.width * 0.14, canopyBottom]
      ],
      timing: { speed: 1.02, pauseAfterMs: 90 }
    })
  ];
}

function renderHouse(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x;
  const right = bbox.x + bbox.width;
  const top = bbox.y + bbox.height * 0.36;
  const bottom = bbox.y + bbox.height;
  const roofPeakX = bbox.x + bbox.width * (0.5 + jitter(rng, 0.04));
  const roofPeakY = bbox.y;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.6,
      opacity: 0.92,
      points: [
        [left, top],
        [roofPeakX, roofPeakY],
        [right, top]
      ],
      timing: { speed: 1, pauseAfterMs: 40 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.6,
      opacity: 0.92,
      points: [
        [left, top],
        [left, bottom],
        [right, bottom],
        [right, top]
      ],
      timing: { speed: 1, pauseAfterMs: 90 }
    })
  ];
}

function renderMailbox(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const postX = bbox.x + bbox.width * 0.46;
  const boxLeft = bbox.x + bbox.width * 0.18;
  const boxRight = bbox.x + bbox.width * 0.82;
  const boxTop = bbox.y + bbox.height * 0.16;
  const boxBottom = bbox.y + bbox.height * 0.48;

  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.88,
      points: [
        [postX, bbox.y + bbox.height],
        [postX + jitter(rng, 2), boxBottom]
      ],
      timing: { speed: 1, pauseAfterMs: 40 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.9,
      points: [
        [boxLeft, boxBottom],
        [boxLeft, boxTop],
        [boxRight, boxTop],
        [boxRight, boxBottom]
      ],
      timing: { speed: 1.02, pauseAfterMs: 70 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.6,
      opacity: 0.72,
      points: [
        [boxLeft, boxTop + (boxBottom - boxTop) * 0.42],
        [boxRight, boxTop + (boxBottom - boxTop) * 0.42]
      ],
      timing: { speed: 1.02, pauseAfterMs: 90 }
    })
  ];
}

function renderLamp(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const poleX = bbox.x + bbox.width * 0.46;
  const topY = bbox.y + bbox.height * 0.1;
  const armY = bbox.y + bbox.height * 0.22;

  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.88,
      points: [
        [poleX, bbox.y + bbox.height],
        [poleX + jitter(rng, 2), topY]
      ],
      timing: { speed: 1.02, pauseAfterMs: 35 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.86,
      points: [
        [poleX, armY],
        [bbox.x + bbox.width * 0.76, armY],
        [bbox.x + bbox.width * 0.7, bbox.y + bbox.height * 0.32]
      ],
      timing: { speed: 1.04, pauseAfterMs: 50 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.6,
      opacity: 0.7,
      points: [
        [bbox.x + bbox.width * 0.64, bbox.y + bbox.height * 0.34],
        [bbox.x + bbox.width * 0.76, bbox.y + bbox.height * 0.44],
        [bbox.x + bbox.width * 0.68, bbox.y + bbox.height * 0.52]
      ],
      timing: { speed: 1.04, pauseAfterMs: 90 }
    })
  ];
}

function renderBench(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const seatY = bbox.y + bbox.height * 0.58;
  const backY = bbox.y + bbox.height * 0.34;
  const left = bbox.x + bbox.width * 0.12;
  const right = bbox.x + bbox.width * 0.88;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.1,
      opacity: 0.9,
      points: [
        [left, seatY],
        [right, seatY]
      ],
      timing: { speed: 1.02, pauseAfterMs: 20 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.1,
      opacity: 0.84,
      points: [
        [left + bbox.width * 0.06, backY],
        [left + bbox.width * 0.08, seatY],
        [right - bbox.width * 0.1, backY + jitter(rng, 3)]
      ],
      timing: { speed: 1.02, pauseAfterMs: 42 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.8,
      opacity: 0.76,
      points: [
        [left + bbox.width * 0.18, seatY],
        [left + bbox.width * 0.14, bbox.y + bbox.height],
        [right - bbox.width * 0.18, seatY],
        [right - bbox.width * 0.14, bbox.y + bbox.height]
      ],
      timing: { speed: 1.04, pauseAfterMs: 90 }
    })
  ];
}

function renderFlag(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const poleX = bbox.x + bbox.width * 0.2;
  const topY = bbox.y + bbox.height * 0.08;
  const flagY = bbox.y + bbox.height * 0.18;

  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.9,
      points: [
        [poleX, bbox.y + bbox.height],
        [poleX, topY]
      ],
      timing: { speed: 1, pauseAfterMs: 26 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 3.1,
      opacity: 0.86,
      points: [
        [poleX, flagY],
        [bbox.x + bbox.width * 0.74, flagY + bbox.height * 0.06],
        [bbox.x + bbox.width * 0.62, flagY + bbox.height * 0.24],
        [poleX, flagY + bbox.height * 0.18]
      ],
      timing: { speed: 1.04, pauseAfterMs: 90 }
    })
  ];
}

function renderAnimal(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const midY = bbox.y + bbox.height * 0.56;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.1,
      opacity: 0.88,
      points: [
        [bbox.x + bbox.width * 0.12, midY],
        [bbox.x + bbox.width * 0.22, bbox.y + bbox.height * 0.3 + jitter(rng, 4)],
        [bbox.x + bbox.width * 0.52, bbox.y + bbox.height * 0.24],
        [bbox.x + bbox.width * 0.78, bbox.y + bbox.height * 0.36],
        [bbox.x + bbox.width * 0.88, midY]
      ],
      timing: { speed: 1.04, pauseAfterMs: 35 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.82,
      points: [
        [bbox.x + bbox.width * 0.7, midY],
        [bbox.x + bbox.width * 0.88, bbox.y + bbox.height * 0.4],
        [bbox.x + bbox.width * 0.82, bbox.y + bbox.height * 0.24]
      ],
      timing: { speed: 1.05, pauseAfterMs: 45 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.6,
      opacity: 0.76,
      points: [
        [bbox.x + bbox.width * 0.22, midY],
        [bbox.x + bbox.width * 0.18, bbox.y + bbox.height],
        [bbox.x + bbox.width * 0.46, midY],
        [bbox.x + bbox.width * 0.44, bbox.y + bbox.height],
        [bbox.x + bbox.width * 0.66, midY],
        [bbox.x + bbox.width * 0.64, bbox.y + bbox.height]
      ],
      timing: { speed: 1.05, pauseAfterMs: 90 }
    })
  ];
}

function renderVehicle(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const baseY = bbox.y + bbox.height * 0.76;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.9,
      points: [
        [bbox.x + bbox.width * 0.08, baseY],
        [bbox.x + bbox.width * 0.22, bbox.y + bbox.height * 0.44],
        [bbox.x + bbox.width * 0.66, bbox.y + bbox.height * 0.42],
        [bbox.x + bbox.width * 0.84, baseY],
        [bbox.x + bbox.width * 0.92, baseY]
      ],
      timing: { speed: 1.02, pauseAfterMs: 34 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.8,
      opacity: 0.8,
      points: [
        [bbox.x + bbox.width * 0.18, baseY],
        [bbox.x + bbox.width * 0.28, bbox.y + bbox.height * 0.9],
        [bbox.x + bbox.width * 0.38, baseY]
      ],
      timing: { speed: 1.02, pauseAfterMs: 18 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.8,
      opacity: 0.8,
      points: [
        [bbox.x + bbox.width * 0.62, baseY],
        [bbox.x + bbox.width * 0.72, bbox.y + bbox.height * 0.9],
        [bbox.x + bbox.width * 0.82, baseY]
      ],
      timing: { speed: 1.02, pauseAfterMs: 90 }
    })
  ];
}

function renderTool(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const handleStart = [bbox.x + bbox.width * 0.22, bbox.y + bbox.height] as [number, number];
  const handleEnd = [bbox.x + bbox.width * 0.68, bbox.y + bbox.height * 0.18] as [number, number];
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.88,
      points: [handleStart, handleEnd],
      timing: { speed: 1.02, pauseAfterMs: 28 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.8,
      opacity: 0.8,
      points: [
        [handleEnd[0] - bbox.width * 0.12, handleEnd[1] + bbox.height * 0.04],
        [handleEnd[0] + bbox.width * 0.08, handleEnd[1] - bbox.height * 0.08],
        [handleEnd[0] + bbox.width * 0.16, handleEnd[1] + bbox.height * 0.12]
      ],
      timing: { speed: 1.02, pauseAfterMs: 90 }
    })
  ];
}

function renderGarden(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [
    ...renderBush(
      {
        x: bbox.x + bbox.width * 0.02,
        y: bbox.y + bbox.height * 0.12,
        width: bbox.width * 0.54,
        height: bbox.height * 0.84
      },
      colors,
      rng,
      input
    ),
    ...renderFlower(
      {
        x: bbox.x + bbox.width * 0.48,
        y: bbox.y + bbox.height * 0.02,
        width: bbox.width * 0.46,
        height: bbox.height * 0.98
      },
      colors,
      rng,
      input
    )
  ];
}

function renderGenericStructure(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const left = bbox.x + bbox.width * 0.2;
  const right = bbox.x + bbox.width * 0.8;
  const top = bbox.y + bbox.height * 0.1;
  const bottom = bbox.y + bbox.height;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.2,
      opacity: 0.9,
      points: [
        [left, bottom],
        [left + jitter(rng, 2), top],
        [right + jitter(rng, 2), top],
        [right, bottom]
      ],
      timing: { speed: 1, pauseAfterMs: 55 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.6,
      opacity: 0.72,
      points: [
        [bbox.x + bbox.width * 0.28, bbox.y + bbox.height * 0.44],
        [bbox.x + bbox.width * 0.72, bbox.y + bbox.height * 0.44]
      ],
      timing: { speed: 1.08, pauseAfterMs: 80 }
    })
  ];
}

function renderGenericFigure(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  const cx = bbox.x + bbox.width * 0.5;
  const headY = bbox.y + bbox.height * 0.18;
  const shoulderY = bbox.y + bbox.height * 0.34;
  const hipY = bbox.y + bbox.height * 0.68;
  const bottom = bbox.y + bbox.height;
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.88,
      points: [
        [cx - bbox.width * 0.18, headY + bbox.height * 0.08],
        [cx, headY - bbox.height * 0.02],
        [cx + bbox.width * 0.18, headY + bbox.height * 0.08],
        [cx, headY + bbox.height * 0.18],
        [cx - bbox.width * 0.18, headY + bbox.height * 0.08]
      ],
      timing: { speed: 1.05, pauseAfterMs: 40 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3,
      opacity: 0.84,
      points: [
        [cx, shoulderY],
        [cx + jitter(rng, 4), hipY]
      ],
      timing: { speed: 1.05, pauseAfterMs: 20 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.8,
      points: [
        [cx - bbox.width * 0.2, shoulderY + bbox.height * 0.06],
        [cx, shoulderY],
        [cx + bbox.width * 0.22, shoulderY + bbox.height * 0.08]
      ],
      timing: { speed: 1.08, pauseAfterMs: 26 }
    }),
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 2.8,
      opacity: 0.8,
      points: [
        [cx, hipY],
        [cx - bbox.width * 0.18, bottom],
        [cx + bbox.width * 0.18, bottom]
      ],
      timing: { speed: 1.08, pauseAfterMs: 90 }
    })
  ];
}

function renderGenericLoop(
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  return [
    action(input, {
      tool: "brush",
      color: colors.primary,
      width: 3.1,
      opacity: 0.84,
      points: [
        [bbox.x + bbox.width * 0.12, bbox.y + bbox.height * 0.6],
        [bbox.x + bbox.width * 0.22, bbox.y + bbox.height * 0.18],
        [bbox.x + bbox.width * 0.54 + jitter(rng, 4), bbox.y + bbox.height * 0.08],
        [bbox.x + bbox.width * 0.84, bbox.y + bbox.height * 0.28],
        [bbox.x + bbox.width * 0.78, bbox.y + bbox.height * 0.68],
        [bbox.x + bbox.width * 0.46, bbox.y + bbox.height * 0.9],
        [bbox.x + bbox.width * 0.14, bbox.y + bbox.height * 0.72]
      ],
      timing: { speed: 1.04, pauseAfterMs: 70 }
    }),
    action(input, {
      tool: "brush",
      color: colors.secondary,
      width: 2.6,
      opacity: 0.58,
      points: [
        [bbox.x + bbox.width * 0.22, bbox.y + bbox.height * 0.68],
        [bbox.x + bbox.width * 0.46 + jitter(rng, 5), bbox.y + bbox.height * 0.5],
        [bbox.x + bbox.width * 0.72, bbox.y + bbox.height * 0.7]
      ],
      timing: { speed: 1.08, pauseAfterMs: 100 }
    })
  ];
}

function renderByFamily(
  addition: SceneAddition,
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  switch (getRecipeKey(addition.family)) {
    case "chimney":
      return renderChimney(bbox, colors, rng, input);
    case "smoke":
      return renderSmoke(bbox, colors, rng, input);
    case "cloud":
      return renderCloud(bbox, colors, rng, input);
    case "sun":
      return renderSun(bbox, colors, rng, input);
    case "moon":
      return renderMoon(bbox, colors, rng, input);
    case "bird":
      return renderBird(bbox, colors, rng, input);
    case "grass":
      return renderGrass(bbox, colors, rng, input);
    case "bush":
      return renderBush(bbox, colors, rng, input);
    case "flower":
      return renderFlower(bbox, colors, rng, input);
    case "fence":
      return renderFence(bbox, colors, rng, input);
    case "path":
      return renderPath(bbox, colors, rng, input);
    case "hill":
      return renderHill(bbox, colors, rng, input);
    case "water":
      return renderWater(bbox, colors, rng, input);
    case "tree":
      return renderTree(bbox, colors, rng, input);
    case "house":
      return renderHouse(bbox, colors, rng, input);
    case "mailbox":
      return renderMailbox(bbox, colors, rng, input);
    case "lamp":
      return renderLamp(bbox, colors, rng, input);
    case "bench":
      return renderBench(bbox, colors, rng, input);
    case "flag":
      return renderFlag(bbox, colors, rng, input);
    case "animal":
      return renderAnimal(bbox, colors, rng, input);
    case "vehicle":
      return renderVehicle(bbox, colors, rng, input);
    case "tool":
      return renderTool(bbox, colors, rng, input);
    case "garden":
      return renderGarden(bbox, colors, rng, input);
    case "face":
      return renderGenericFigure(bbox, colors, rng, input);
    case "structure":
      return renderGenericStructure(bbox, colors, rng, input);
    case "figure":
      return renderGenericFigure(bbox, colors, rng, input);
    case "loop":
      return renderGenericLoop(bbox, colors, rng, input);
    default:
      return renderGenericLoop(bbox, colors, rng, input);
  }
}

export function describeRenderedAddition(recipe: RenderedRecipe) {
  if (!recipe.targetSubject) {
    return familyPhrase(recipe.addition.family);
  }

  switch (recipe.addition.relation) {
    case "attach_roof_left":
    case "attach_roof_center":
    case "attach_roof_right":
      return `${familyPhrase(recipe.addition.family)} on the ${familyLabel(recipe.targetSubject.family)}`;
    case "ground_front":
      return `${familyPhrase(recipe.addition.family)} in front of the ${familyLabel(recipe.targetSubject.family)}`;
    case "beside_left":
    case "beside_right":
      return `${familyPhrase(recipe.addition.family)} beside the ${familyLabel(recipe.targetSubject.family)}`;
    case "sky_above":
    case "sky_above_left":
    case "sky_above_right":
      return `${familyPhrase(recipe.addition.family)} above the ${familyLabel(recipe.targetSubject.family)}`;
    default:
      return `${familyPhrase(recipe.addition.family)} near the ${familyLabel(recipe.targetSubject.family)}`;
  }
}

export function renderSceneAddition(
  analysis: SceneAnalysis,
  addition: SceneAddition,
  input: SketchRenderInput
): RenderedRecipe | null {
  const targetSubject = resolveTargetSubject(analysis, addition);
  if (familyNeedsTarget(addition.family) && !targetSubject) {
    return null;
  }

  const bbox = resolvePlacementBox(addition, targetSubject, analysis, input);
  if (!bbox) {
    return null;
  }
  const adjustedBbox = adjustPlacementForCollisions(
    bbox,
    addition,
    targetSubject,
    analysis,
    input
  );

  const colors = getStrokeColors(addition.family, input.palette);
  const rng = createRng(`${addition.id}:${addition.family}:${analysis.scene}`);
  const actions = renderByFamily(addition, adjustedBbox, colors, rng, input);

  if (actions.length === 0) {
    return null;
  }

  return {
    addition,
    targetSubject,
    actions
  };
}
