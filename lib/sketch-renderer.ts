import {
  compiledObjectActionSchema,
  type CompiledObjectAction,
  type ObjectBoundingBox,
  type ObjectFamily,
  type PlannerHumanContext,
  type RenderedRecipe,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject,
  type StrokeTiming
} from "@/lib/draw-types";
import {
  gridCellsToBounds,
  pointToGridCell,
  semanticGridCellLabel
} from "@/lib/scene-anchors";
import { svgPathToFramePoints } from "@/lib/svg-path";

export type SketchRenderInput = {
  canvasWidth: number;
  canvasHeight: number;
  activeStrokeSize: number;
  palette: string[];
  humanDelta: PlannerHumanContext[];
};

const ASSET_VIEWBOX = {
  width: 100,
  height: 100
} as const;

export const SVG_ASSETS: Record<ObjectFamily, string[]> = {
  house: [
    "M 14 82 L 14 48 L 50 18 L 86 48 L 86 82 L 14 82 Z",
    "M 28 82 L 28 56 L 72 56 L 72 82",
    "M 38 82 L 38 64 L 50 64 L 50 82",
    "M 58 64 L 70 64 L 70 76 L 58 76 Z"
  ],
  tree: [
    "M 50 84 L 50 58",
    "M 50 26 C 70 26 78 40 74 52 C 84 52 86 66 74 70 C 66 80 34 80 26 70 C 14 66 16 52 26 52 C 22 40 30 26 50 26 Z"
  ],
  sun: [
    "M 50 34 C 58 34 66 42 66 50 C 66 58 58 66 50 66 C 42 66 34 58 34 50 C 34 42 42 34 50 34 Z",
    "M 50 10 L 50 24 M 50 76 L 50 90 M 10 50 L 24 50 M 76 50 L 90 50 M 22 22 L 31 31 M 69 69 L 78 78 M 22 78 L 31 69 M 69 31 L 78 22"
  ],
  cloud: [
    "M 22 64 C 14 64 10 58 10 52 C 10 44 16 38 24 38 C 27 28 35 22 45 24 C 52 16 64 16 72 24 C 82 24 90 32 90 42 C 90 52 82 60 72 60 H 28 C 26 63 24 64 22 64 Z"
  ],
  dog: [
    "M 18 72 L 22 46 L 42 38 L 64 38 L 78 48 L 82 62 L 72 70 L 60 70 L 56 84 M 34 70 L 30 84 M 72 70 L 76 84",
    "M 22 46 L 16 30 L 26 22 L 34 38",
    "M 62 42 L 74 34 L 82 40"
  ],
  cat: [
    "M 22 74 L 28 42 L 38 26 L 46 40 L 54 26 L 62 40 L 72 42 L 78 74 L 64 74 L 60 88 M 40 74 L 36 88",
    "M 28 56 C 38 48 62 48 72 56",
    "M 22 54 L 12 48 M 22 60 L 10 60 M 78 54 L 88 48 M 78 60 L 90 60"
  ],
  bird: [
    "M 18 58 C 28 42 40 42 50 58 C 60 42 72 42 82 58"
  ],
  flower: [
    "M 50 82 L 50 44",
    "M 50 26 C 56 26 60 30 60 36 C 60 42 56 46 50 46 C 44 46 40 42 40 36 C 40 30 44 26 50 26 Z",
    "M 38 30 C 42 30 46 34 46 38 C 46 42 42 46 38 46 C 34 46 30 42 30 38 C 30 34 34 30 38 30 Z",
    "M 62 30 C 66 30 70 34 70 38 C 70 42 66 46 62 46 C 58 46 54 42 54 38 C 54 34 58 30 62 30 Z"
  ],
  bush: [
    "M 16 76 C 14 62 24 50 38 50 C 42 38 56 34 66 42 C 80 40 90 52 88 66 C 88 74 82 80 74 80 H 30 C 22 80 18 78 16 76 Z"
  ],
  fence: [
    "M 10 82 L 90 82",
    "M 18 82 L 18 48 L 26 38 L 34 48 L 34 82",
    "M 46 82 L 46 48 L 54 38 L 62 48 L 62 82",
    "M 74 82 L 74 48 L 82 38 L 90 48 L 90 82",
    "M 12 58 L 88 58"
  ],
  path: [
    "M 46 18 C 42 38 32 54 26 82",
    "M 54 18 C 58 38 68 54 74 82"
  ],
  pond: [
    "M 18 58 C 30 42 70 42 82 58 C 74 72 26 72 18 58 Z"
  ],
  water: [
    "M 10 58 C 20 50 30 50 40 58 C 50 66 60 66 70 58 C 80 50 90 50 96 58",
    "M 8 72 C 18 64 30 64 40 72 C 50 80 62 80 72 72 C 82 64 92 64 98 72"
  ],
  hill: [
    "M 4 82 C 20 62 34 52 50 58 C 64 40 80 38 96 58"
  ],
  chimney: [
    "M 34 80 L 34 36 L 56 36 L 56 80",
    "M 30 36 L 60 36"
  ],
  smoke: [
    "M 44 82 C 32 70 34 56 44 48 C 54 40 56 28 48 18",
    "M 58 82 C 48 70 50 58 60 50 C 70 42 70 30 62 18"
  ],
  mailbox: [
    "M 44 84 L 44 42",
    "M 36 40 C 36 28 64 28 68 40 L 68 58 L 36 58 Z",
    "M 36 44 L 68 44"
  ],
  lamp: [
    "M 50 84 L 50 28",
    "M 38 28 C 42 16 58 16 62 28 L 58 46 L 42 46 Z",
    "M 44 84 L 56 84"
  ],
  bench: [
    "M 22 54 L 78 54",
    "M 18 68 L 82 68",
    "M 26 54 L 24 84 M 74 54 L 76 84"
  ],
  person: [
    "M 50 12 C 56 12 60 16 60 22 C 60 28 56 32 50 32 C 44 32 40 28 40 22 C 40 16 44 12 50 12 Z",
    "M 50 32 L 50 64 M 32 46 L 68 46 M 50 64 L 34 88 M 50 64 L 66 88"
  ],
  detail: [
    "M 20 68 C 34 42 66 42 80 68"
  ]
};

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

function fitBox(box: ObjectBoundingBox, input: SketchRenderInput): ObjectBoundingBox {
  const width = clamp(box.width, 12, input.canvasWidth);
  const height = clamp(box.height, 12, input.canvasHeight);

  return {
    x: Math.round(clamp(box.x, 0, Math.max(0, input.canvasWidth - width))),
    y: Math.round(clamp(box.y, 0, Math.max(0, input.canvasHeight - height))),
    width: Math.round(width),
    height: Math.round(height)
  };
}

function familyLabel(family: ObjectFamily) {
  return family.replaceAll("_", " ");
}

function familyPhrase(family: ObjectFamily) {
  switch (family) {
    case "grass":
    case "water":
    case "smoke":
      return familyLabel(family);
    default:
      return `a ${familyLabel(family)}`;
  }
}

function resolveAssetFamily(family: ObjectFamily): ObjectFamily {
  const text = family.toLowerCase();

  if (includesAny(text, ["house", "home", "barn", "hut", "shed", "cabin"])) {
    return "house";
  }
  if (includesAny(text, ["tree", "oak", "pine", "palm"])) {
    return "tree";
  }
  if (includesAny(text, ["sun", "star"])) {
    return "sun";
  }
  if (includesAny(text, ["cloud"])) {
    return "cloud";
  }
  if (includesAny(text, ["dog", "puppy"])) {
    return "dog";
  }
  if (includesAny(text, ["cat", "kitten"])) {
    return "cat";
  }
  if (includesAny(text, ["bird"])) {
    return "bird";
  }
  if (includesAny(text, ["flower", "rose", "tulip", "daisy"])) {
    return "flower";
  }
  if (includesAny(text, ["bush", "shrub", "hedge"])) {
    return "bush";
  }
  if (includesAny(text, ["fence", "gate"])) {
    return "fence";
  }
  if (includesAny(text, ["path", "walkway", "road", "trail"])) {
    return "path";
  }
  if (includesAny(text, ["pond", "lake"])) {
    return "pond";
  }
  if (includesAny(text, ["water", "river", "waves"])) {
    return "water";
  }
  if (includesAny(text, ["hill", "mountain"])) {
    return "hill";
  }
  if (includesAny(text, ["chimney", "stack"])) {
    return "chimney";
  }
  if (includesAny(text, ["smoke", "steam"])) {
    return "smoke";
  }
  if (includesAny(text, ["mailbox"])) {
    return "mailbox";
  }
  if (includesAny(text, ["lamp", "lantern", "light"])) {
    return "lamp";
  }
  if (includesAny(text, ["bench", "chair"])) {
    return "bench";
  }
  if (includesAny(text, ["person", "figure", "character"])) {
    return "person";
  }

  return "detail";
}

function resolveTargetSubject(
  analysis: SceneAnalysis,
  addition: SceneAddition,
  input: SketchRenderInput
): SceneSubject | null {
  if (addition.targetSubjectId) {
    return analysis.subjects.find((subject) => subject.id === addition.targetSubjectId) ?? null;
  }

  const targetCellBounds = gridCellsToBounds(
    addition.gridCells,
    input.canvasWidth,
    input.canvasHeight
  );
  const targetCell = pointToGridCell(
    targetCellBounds.x + targetCellBounds.width * 0.5,
    targetCellBounds.y + targetCellBounds.height * 0.5,
    input.canvasWidth,
    input.canvasHeight
  );

  let bestMatch: SceneSubject | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const subject of analysis.subjects) {
    const center = {
      x: subject.bbox.x + subject.bbox.width * 0.5,
      y: subject.bbox.y + subject.bbox.height * 0.5
    };
    const subjectCenterCell = pointToGridCell(
      center.x,
      center.y,
      input.canvasWidth,
      input.canvasHeight
    );
    const columnDistance = Math.abs(subjectCenterCell[0].charCodeAt(0) - targetCell[0].charCodeAt(0));
    const rowDistance = Math.abs(subjectCenterCell[1] - targetCell[1]);
    const distance = columnDistance + rowDistance;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = subject;
    }
  }

  return bestMatch;
}

function getAssetColors(family: ObjectFamily, palette: string[], pathCount: number) {
  const outline = palette[0];
  const blue = palette[1] ?? outline;
  const red = palette[2] ?? outline;
  const orange = palette[3] ?? outline;
  const green = palette[4] ?? outline;

  const assetFamily = resolveAssetFamily(family);

  switch (assetFamily) {
    case "tree":
    case "bush":
    case "flower":
      return Array.from({ length: pathCount }, (_, index) => (index === 0 ? outline : green));
    case "sun":
      return Array.from({ length: pathCount }, () => orange);
    case "cloud":
    case "water":
    case "pond":
      return Array.from({ length: pathCount }, () => blue);
    case "smoke":
      return Array.from({ length: pathCount }, () => red);
    default:
      return Array.from({ length: pathCount }, () => outline);
  }
}

function resolvePlacementBox(
  addition: SceneAddition,
  input: SketchRenderInput
) {
  return fitBox(
    gridCellsToBounds(addition.gridCells, input.canvasWidth, input.canvasHeight),
    input
  );
}

function compileAction(
  input: SketchRenderInput,
  color: string,
  points: [number, number][],
  timing?: StrokeTiming
) {
  return compiledObjectActionSchema.parse({
    tool: "brush",
    color,
    width: input.activeStrokeSize,
    opacity: 0.92,
    points,
    timing
  });
}

function getActionTiming(pathIndex: number): StrokeTiming {
  return {
    speed: clamp(0.48 + pathIndex * 0.06, 0.35, 0.85),
    pauseAfterMs: 90 + pathIndex * 24
  };
}

function renderAssetPaths(
  family: ObjectFamily,
  placementBox: ObjectBoundingBox,
  input: SketchRenderInput
) {
  const assetFamily = resolveAssetFamily(family);
  const assetPaths = SVG_ASSETS[assetFamily] ?? SVG_ASSETS.detail;
  const colors = getAssetColors(assetFamily, input.palette, assetPaths.length);

  return assetPaths
    .map((path, index) => {
      const points = svgPathToFramePoints(path, placementBox, ASSET_VIEWBOX, {
        curveSubdivisions: 18,
        maxPoints: 160
      });
      return points.length >= 2
        ? compileAction(input, colors[index] ?? colors[0], points, getActionTiming(index))
        : null;
    })
    .filter((action): action is CompiledObjectAction => action !== null);
}

export function describeRenderedAddition(recipe: RenderedRecipe) {
  if (recipe.targetSubject) {
    return `${familyPhrase(recipe.addition.family)} near the ${familyLabel(recipe.targetSubject.family)}`;
  }

  const leadCell = recipe.addition.gridCells[0];
  return `${familyPhrase(recipe.addition.family)} around ${semanticGridCellLabel(leadCell)}`;
}

export function renderSceneAddition(
  analysis: SceneAnalysis,
  addition: SceneAddition,
  input: SketchRenderInput
): RenderedRecipe | null {
  const targetSubject = resolveTargetSubject(analysis, addition, input);
  const placementBox = resolvePlacementBox(addition, input);
  const actions = renderAssetPaths(addition.family, placementBox, input);

  if (actions.length === 0) {
    return null;
  }

  return {
    addition,
    targetSubject,
    actions
  };
}
