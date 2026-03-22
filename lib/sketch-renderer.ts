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
    "M 12 80 L 15 50 L 48 20 L 88 52 L 84 84 Z",
    "M 26 82 L 27 58 L 74 54 L 70 80",
    "M 36 82 L 39 66 L 52 64 L 48 82",
    "M 56 62 L 72 65 L 68 78 L 59 75 Z"
  ],
  tree: [
    "M 48 86 C 49 70 47 62 52 56",
    "M 46 28 C 68 22 80 44 72 54 C 86 56 82 68 72 72 C 62 82 36 82 28 72 C 12 68 18 50 28 54 C 20 42 32 24 46 28 Z"
  ],
  sun: [
    "M 50 32 C 60 30 68 40 64 52 C 66 60 56 68 48 64 C 40 66 32 56 36 48 C 34 40 42 32 50 32 Z",
    "M 50 8 C 51 16 49 20 50 26 M 50 74 C 49 82 51 86 50 92 M 8 50 C 16 49 20 51 26 50 M 74 50 C 82 51 86 49 92 50 M 20 20 C 26 26 28 28 32 32 M 68 68 C 74 74 76 76 80 80 M 20 80 C 26 74 28 72 32 68 M 68 32 C 74 26 76 24 80 20"
  ],
  cloud: [
    "M 20 62 C 12 60 8 54 12 48 C 8 40 18 36 26 40 C 30 28 40 20 50 26 C 58 18 70 20 74 30 C 86 28 92 38 88 48 C 94 56 84 64 74 62 H 26 C 24 64 22 65 20 62 Z"
  ],
  dog: [
    "M 16 70 C 20 50 24 48 40 40 L 66 40 C 76 46 80 58 84 64 L 74 72 L 62 68 L 58 82 M 36 68 L 32 86 M 74 72 L 78 86",
    "M 20 48 L 14 32 C 20 24 28 20 36 40",
    "M 60 44 L 76 36 L 84 42"
  ],
  cat: [
    "M 20 72 L 26 44 L 36 28 C 42 38 48 38 48 42 C 54 28 60 28 64 42 L 74 44 L 80 72 L 66 76 L 62 86 M 42 72 L 38 86",
    "M 26 58 C 36 50 64 50 74 58",
    "M 20 52 L 8 46 M 20 62 L 6 62 M 80 52 L 92 46 M 80 62 L 94 62"
  ],
  bird: [
    "M 16 56 C 26 40 42 44 50 56 C 58 44 74 40 84 56"
  ],
  flower: [
    "M 48 84 C 49 60 47 50 50 46",
    "M 50 24 C 58 22 62 28 62 36 C 64 44 58 48 50 48 C 42 48 36 44 38 36 C 38 28 42 22 50 24 Z",
    "M 36 28 C 42 26 48 32 48 40 C 46 48 40 50 36 48 C 30 46 28 40 30 36 C 30 30 34 26 36 28 Z",
    "M 64 28 C 70 26 74 32 76 36 C 76 40 70 46 64 48 C 60 50 54 48 52 40 C 52 32 58 26 64 28 Z"
  ],
  bush: [
    "M 14 74 C 10 58 26 48 40 52 C 46 36 60 32 70 44 C 84 38 92 54 86 68 C 90 76 80 82 72 82 H 28 C 20 82 16 80 14 74 Z"
  ],
  fence: [
    "M 8 80 C 40 82 60 78 92 82",
    "M 16 84 C 18 60 16 50 24 36 C 30 48 32 60 36 80",
    "M 44 84 C 46 60 44 50 52 36 C 58 48 60 60 64 80",
    "M 72 84 C 74 60 72 50 80 36 C 86 48 88 60 92 80",
    "M 10 56 C 40 58 60 54 90 58"
  ],
  path: [
    "M 44 16 C 40 40 28 58 22 84",
    "M 56 16 C 60 40 72 58 78 84"
  ],
  pond: [
    "M 16 56 C 32 40 68 38 84 56 C 72 74 28 74 16 56 Z"
  ],
  water: [
    "M 8 56 C 22 48 28 52 42 56 C 52 68 58 64 72 56 C 82 48 88 52 98 56",
    "M 6 74 C 20 62 32 66 42 74 C 52 82 60 78 74 70 C 84 62 90 66 96 74"
  ],
  hill: [
    "M 2 84 C 22 60 36 50 52 60 C 66 38 82 36 98 60"
  ],
  chimney: [
    "M 32 82 C 34 60 32 50 36 34 L 54 38 C 56 50 54 60 58 82",
    "M 28 34 C 40 36 50 34 62 38"
  ],
  smoke: [
    "M 42 84 C 28 72 32 54 46 46 C 58 38 60 26 50 16",
    "M 56 84 C 44 72 48 56 62 48 C 74 40 72 28 64 16"
  ],
  mailbox: [
    "M 42 86 C 44 60 42 50 46 44",
    "M 34 42 C 34 26 66 26 70 42 L 66 60 L 38 56 Z",
    "M 34 46 C 44 48 54 44 70 46"
  ],
  lamp: [
    "M 48 86 C 50 60 48 50 52 26",
    "M 36 26 C 44 14 56 12 64 26 L 56 48 L 40 44 Z",
    "M 42 86 C 48 84 52 88 58 86"
  ],
  bench: [
    "M 20 52 C 40 54 60 50 80 52",
    "M 16 66 C 40 68 60 64 84 66",
    "M 24 52 C 26 64 22 74 26 86 M 72 52 C 74 64 70 74 74 86"
  ],
  person: [
    "M 48 10 C 56 8 62 14 62 20 C 64 28 58 34 50 34 C 42 34 38 28 38 20 C 36 12 42 8 48 10 Z",
    "M 50 34 C 48 44 52 54 50 66 M 30 44 C 42 48 54 44 70 48 M 50 66 C 44 76 40 80 32 86 M 50 66 C 56 76 60 80 68 86"
  ],
  detail: [
    "M 18 66 C 36 40 64 38 82 66"
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
  const bounds = gridCellsToBounds(addition.gridCells, input.canvasWidth, input.canvasHeight);
  
  // Maintain a mostly square aspect ratio to prevent severe stretching
  // since the SVG assets are all drawn in a 100x100 viewBox
  const size = Math.max(bounds.width, bounds.height);
  const centerX = bounds.x + bounds.width * 0.5;
  const centerY = bounds.y + bounds.height * 0.5;

  return fitBox(
    {
      x: centerX - size * 0.5,
      y: centerY - size * 0.5,
      width: size,
      height: size
    },
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
