import {
  compiledObjectActionSchema,
  type CompiledObjectAction,
  type ObjectBoundingBox,
  type ObjectFamily,
  type RenderedRecipe,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject,
  type StrokeTiming
} from "@/lib/draw-types";

export type SketchRenderInput = {
  canvasWidth: number;
  canvasHeight: number;
  palette: string[];
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
  return key === "chimney" || key === "smoke" || key === "path";
}

function preferredTargetFamilies(family: ObjectFamily): ObjectFamily[] {
  switch (getRecipeKey(family)) {
    case "chimney":
    case "path":
      return ["house"];
    case "smoke":
      return ["chimney", "house"];
    case "grass":
    case "bush":
    case "flower":
    case "fence":
    case "structure":
      return ["house", "tree", "hill"];
    case "tree":
    case "figure":
      return ["house", "hill"];
    default:
      return [];
  }
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
    const match = analysis.subjects.find((subject) => subject.family === family);
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

function resolvePlacementBox(
  addition: SceneAddition,
  target: SceneSubject | null,
  analysis: SceneAnalysis,
  input: SketchRenderInput
) {
  const targetBounds = target ? bboxToBounds(target.bbox) : null;
  const sceneBounds = getSceneBounds(analysis, input);
  const base = targetBounds ?? sceneBounds;
  const key = getRecipeKey(addition.family);

  const rel = addition.relation;
  const small = Math.max(28, Math.min(base.width, base.height) * 0.18);
  const mediumW = Math.max(38, base.width * 0.22);
  const mediumH = Math.max(34, base.height * 0.18);

  switch (key) {
    case "chimney": {
      if (!targetBounds) {
        return null;
      }
      const width = Math.max(22, targetBounds.width * 0.14);
      const height = Math.max(44, targetBounds.height * 0.26);
      const relationOffset =
        rel === "attach_roof_left" ? 0.28 : rel === "attach_roof_center" ? 0.48 : 0.68;
      const x = targetBounds.minX + targetBounds.width * relationOffset - width * 0.5;
      const roofBandBottom = targetBounds.minY + targetBounds.height * 0.26;
      const y = roofBandBottom - height;
      return fitBox({ x, y, width, height }, input);
    }
    case "smoke": {
      const width = Math.max(34, mediumW * 0.9);
      const height = Math.max(46, mediumH * 1.3);
      const x = base.minX + base.width * 0.55 - width * 0.5;
      const y = base.minY - height * 0.9;
      return fitBox({ x, y, width, height }, input);
    }
    case "cloud": {
      const width = Math.max(68, sceneBounds.width * 0.18);
      const height = Math.max(36, sceneBounds.height * 0.1);
      const x =
        rel === "sky_above_left"
          ? sceneBounds.minX + sceneBounds.width * 0.14
          : rel === "sky_above_right"
            ? sceneBounds.maxX - width - sceneBounds.width * 0.1
            : (targetBounds ?? sceneBounds).minX + (targetBounds ?? sceneBounds).width * 0.5 - width * 0.5;
      const y = (targetBounds ?? sceneBounds).minY - height - 26;
      return fitBox({ x, y, width, height }, input);
    }
    case "sun":
    case "moon": {
      const size = Math.max(34, sceneBounds.width * 0.11);
      const x =
        rel === "sky_above_left"
          ? sceneBounds.minX + sceneBounds.width * 0.06
          : sceneBounds.maxX - size - sceneBounds.width * 0.06;
      const y = sceneBounds.minY - size - 34;
      return fitBox({ x, y, width: size, height: size }, input);
    }
    case "bird": {
      const width = Math.max(22, small);
      const height = Math.max(14, small * 0.55);
      const x =
        rel === "sky_above_right"
          ? sceneBounds.maxX - width - sceneBounds.width * 0.12
          : rel === "sky_above_left"
            ? sceneBounds.minX + sceneBounds.width * 0.12
            : sceneBounds.minX + sceneBounds.width * 0.5 - width * 0.5;
      const y = sceneBounds.minY - height - 18;
      return fitBox({ x, y, width, height }, input);
    }
    case "grass": {
      const width = Math.max(60, (targetBounds ?? sceneBounds).width * 0.42);
      const height = Math.max(24, (targetBounds ?? sceneBounds).height * 0.12);
      const x = (targetBounds ?? sceneBounds).minX + (targetBounds ?? sceneBounds).width * 0.5 - width * 0.5;
      const y = (targetBounds ?? sceneBounds).maxY - height * 0.4;
      return fitBox({ x, y, width, height }, input);
    }
    case "bush": {
      const width = Math.max(52, mediumW);
      const height = Math.max(34, mediumH);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.8
          : rel === "ground_left"
            ? base.minX - width * 0.5
            : rel === "ground_right" || rel === "beside_right"
              ? base.maxX - width * 0.3
              : base.minX + base.width * 0.56;
      const y = base.maxY - height * 0.92;
      return fitBox({ x, y, width, height }, input);
    }
    case "flower": {
      const width = Math.max(28, small * 0.8);
      const height = Math.max(56, small * 1.6);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.35
          : rel === "beside_right"
            ? base.maxX - width * 0.65
            : base.minX + base.width * 0.32;
      const y = base.maxY - height * 0.92;
      return fitBox({ x, y, width, height }, input);
    }
    case "fence": {
      const width = Math.max(70, (targetBounds ?? sceneBounds).width * 0.48);
      const height = Math.max(32, (targetBounds ?? sceneBounds).height * 0.16);
      const x = (targetBounds ?? sceneBounds).minX + (targetBounds ?? sceneBounds).width * 0.5 - width * 0.5;
      const y = (targetBounds ?? sceneBounds).maxY - height * 0.7;
      return fitBox({ x, y, width, height }, input);
    }
    case "path": {
      if (!targetBounds) {
        return null;
      }
      const width = Math.max(42, targetBounds.width * 0.34);
      const height = Math.max(58, targetBounds.height * 0.45);
      const x = targetBounds.minX + targetBounds.width * 0.5 - width * 0.5;
      const y = targetBounds.maxY - height * 0.05;
      return fitBox({ x, y, width, height }, input);
    }
    case "hill": {
      const width = Math.max(120, sceneBounds.width * 0.6);
      const height = Math.max(40, sceneBounds.height * 0.18);
      const x = sceneBounds.minX + sceneBounds.width * 0.5 - width * 0.5;
      const y = sceneBounds.maxY - height * 0.2;
      return fitBox({ x, y, width, height }, input);
    }
    case "water": {
      const width = Math.max(84, sceneBounds.width * 0.32);
      const height = Math.max(26, sceneBounds.height * 0.1);
      const x =
        rel === "ground_left"
          ? sceneBounds.minX + sceneBounds.width * 0.08
          : rel === "ground_right"
            ? sceneBounds.maxX - width - sceneBounds.width * 0.08
            : sceneBounds.minX + sceneBounds.width * 0.5 - width * 0.5;
      const y = sceneBounds.maxY - height * 0.2;
      return fitBox({ x, y, width, height }, input);
    }
    case "tree": {
      const width = Math.max(58, sceneBounds.width * 0.16);
      const height = Math.max(120, sceneBounds.height * 0.42);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.72
          : base.maxX - width * 0.28;
      const y = base.maxY - height * 0.92;
      return fitBox({ x, y, width, height }, input);
    }
    case "house": {
      const width = Math.max(84, sceneBounds.width * 0.24);
      const height = Math.max(92, sceneBounds.height * 0.28);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.82
          : base.maxX - width * 0.18;
      const y = base.maxY - height * 0.96;
      return fitBox({ x, y, width, height }, input);
    }
    case "structure": {
      const width = Math.max(28, mediumW * 0.75);
      const height = Math.max(52, mediumH * 1.55);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.72
          : rel === "sky_above"
            ? base.minX + base.width * 0.5 - width * 0.5
            : base.maxX - width * 0.28;
      const y =
        rel === "sky_above" ? base.minY - height - 18 : base.maxY - height * 0.94;
      return fitBox({ x, y, width, height }, input);
    }
    case "figure": {
      const width = Math.max(34, small);
      const height = Math.max(72, mediumH * 1.9);
      const x =
        rel === "beside_left"
          ? base.minX - width * 0.62
          : base.maxX - width * 0.38;
      const y = base.maxY - height * 0.96;
      return fitBox({ x, y, width, height }, input);
    }
    case "loop": {
      const width = Math.max(40, mediumW * 0.95);
      const height = Math.max(34, mediumH * 0.95);
      const x =
        rel === "sky_above"
          ? base.minX + base.width * 0.5 - width * 0.5
          : rel === "beside_left"
            ? base.minX - width * 0.58
            : rel === "beside_right"
              ? base.maxX - width * 0.42
              : base.minX + base.width * 0.52 - width * 0.5;
      const y =
        rel === "sky_above"
          ? base.minY - height - 18
          : rel === "ground_front"
            ? base.maxY - height * 0.9
            : base.minY + base.height * 0.46;
      return fitBox({ x, y, width, height }, input);
    }
    default:
      return null;
  }
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
      return { primary: ink, secondary: warm };
    case "grass":
    case "bush":
    case "tree":
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
  family: ObjectFamily,
  bbox: ObjectBoundingBox,
  colors: { primary: string; secondary: string },
  rng: () => number,
  input: SketchRenderInput
) {
  switch (getRecipeKey(family)) {
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

  const colors = getStrokeColors(addition.family, input.palette);
  const rng = createRng(`${addition.id}:${addition.family}:${analysis.scene}`);
  const actions = renderByFamily(addition.family, bbox, colors, rng, input);

  if (actions.length === 0) {
    return null;
  }

  return {
    addition,
    targetSubject,
    actions
  };
}
