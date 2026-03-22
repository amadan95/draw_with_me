import {
  semanticGridCellSchema,
  semanticGridColumns,
  type ObjectBoundingBox,
  type PlannerHumanContext,
  type SemanticGridCell,
  type SemanticGridColumn
} from "@/lib/draw-types";

export const SEMANTIC_GRID_SIZE = 12;

export type UnitScale = {
  averageWidth: number;
  averageHeight: number;
  unit: number;
  sampleCount: number;
};

export type HumanContextGridSummary = {
  kind: PlannerHumanContext["kind"];
  label: string;
  bbox: ObjectBoundingBox;
  occupiedGridCells: SemanticGridCell[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundBox(box: ObjectBoundingBox): ObjectBoundingBox {
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height))
  };
}

function getCellSize(canvasWidth: number, canvasHeight: number) {
  return {
    width: canvasWidth / SEMANTIC_GRID_SIZE,
    height: canvasHeight / SEMANTIC_GRID_SIZE
  };
}

function gridColumnAt(index: number): SemanticGridColumn {
  return semanticGridColumns[clamp(index, 0, SEMANTIC_GRID_SIZE - 1)];
}

function makeGridCell(column: SemanticGridColumn, row: number) {
  return semanticGridCellSchema.parse([column, clamp(row, 1, 12)]);
}

function boxRight(box: ObjectBoundingBox) {
  return box.x + box.width;
}

function boxBottom(box: ObjectBoundingBox) {
  return box.y + box.height;
}

export function semanticGridCellLabel(cell: SemanticGridCell) {
  return `${cell[0]}${cell[1]}`;
}

export function getHumanContextBoundingBox(item: PlannerHumanContext): ObjectBoundingBox {
  if (item.kind === "humanStroke") {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const [x, y] of item.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const padding = Math.max(2, item.size * 0.5);
    return roundBox({
      x: minX - padding,
      y: minY - padding,
      width: Math.max(1, maxX - minX + padding * 2),
      height: Math.max(1, maxY - minY + padding * 2)
    });
  }

  if (item.kind === "asciiBlock") {
    const estimatedWidth = Math.max(
      item.fontSize * 2.4,
      item.text.length * item.fontSize * 0.56
    );
    const estimatedHeight = Math.max(item.fontSize, item.text.split("\n").length * item.fontSize);
    return roundBox({
      x: item.x,
      y: item.y,
      width: estimatedWidth,
      height: estimatedHeight
    });
  }

  return roundBox({
    x: item.x - item.width * 0.5,
    y: item.y - item.height * 0.5,
    width: item.width,
    height: item.height
  });
}

export function getGridCellBounds(
  cell: SemanticGridCell,
  canvasWidth: number,
  canvasHeight: number
): ObjectBoundingBox {
  const { width: cellWidth, height: cellHeight } = getCellSize(canvasWidth, canvasHeight);
  const columnIndex = semanticGridColumns.indexOf(cell[0]);
  const rowIndex = cell[1] - 1;

  return roundBox({
    x: columnIndex * cellWidth,
    y: rowIndex * cellHeight,
    width: cellWidth,
    height: cellHeight
  });
}

export function pointToGridCell(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): SemanticGridCell {
  const { width: cellWidth, height: cellHeight } = getCellSize(canvasWidth, canvasHeight);
  const columnIndex = clamp(Math.floor(x / cellWidth), 0, SEMANTIC_GRID_SIZE - 1);
  const rowIndex = clamp(Math.floor(y / cellHeight), 0, SEMANTIC_GRID_SIZE - 1);
  return makeGridCell(gridColumnAt(columnIndex), rowIndex + 1);
}

export function gridCellsToBounds(
  cells: SemanticGridCell[],
  canvasWidth: number,
  canvasHeight: number
): ObjectBoundingBox {
  const unique = dedupeGridCells(cells);
  if (unique.length === 0) {
    const cellWidth = canvasWidth / SEMANTIC_GRID_SIZE;
    const cellHeight = canvasHeight / SEMANTIC_GRID_SIZE;
    return roundBox({
      x: canvasWidth * 0.5 - cellWidth * 0.5,
      y: canvasHeight * 0.5 - cellHeight * 0.5,
      width: cellWidth,
      height: cellHeight
    });
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const cell of unique) {
    const bounds = getGridCellBounds(cell, canvasWidth, canvasHeight);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, boxRight(bounds));
    maxY = Math.max(maxY, boxBottom(bounds));
  }

  return roundBox({
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  });
}

export function mapBoundsToGridCells(
  bounds: ObjectBoundingBox,
  canvasWidth: number,
  canvasHeight: number
): SemanticGridCell[] {
  const { width: cellWidth, height: cellHeight } = getCellSize(canvasWidth, canvasHeight);
  const left = clamp(Math.floor(bounds.x / cellWidth), 0, SEMANTIC_GRID_SIZE - 1);
  const top = clamp(Math.floor(bounds.y / cellHeight), 0, SEMANTIC_GRID_SIZE - 1);
  const right = clamp(
    Math.floor((Math.max(bounds.x + bounds.width - 1, bounds.x)) / cellWidth),
    0,
    SEMANTIC_GRID_SIZE - 1
  );
  const bottom = clamp(
    Math.floor((Math.max(bounds.y + bounds.height - 1, bounds.y)) / cellHeight),
    0,
    SEMANTIC_GRID_SIZE - 1
  );

  const cells: SemanticGridCell[] = [];
  for (let column = left; column <= right; column += 1) {
    for (let row = top; row <= bottom; row += 1) {
      cells.push(makeGridCell(gridColumnAt(column), row + 1));
    }
  }

  return cells;
}

export function dedupeGridCells(cells: SemanticGridCell[]) {
  const seen = new Set<string>();
  const deduped: SemanticGridCell[] = [];

  for (const cell of cells) {
    const key = semanticGridCellLabel(cell);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(cell);
  }

  return deduped;
}

export function summarizeHumanContextGrid(
  humanDelta: PlannerHumanContext[],
  canvasWidth: number,
  canvasHeight: number
): HumanContextGridSummary[] {
  return humanDelta.map((item, index) => {
    const bbox = getHumanContextBoundingBox(item);
    const occupiedGridCells = mapBoundsToGridCells(bbox, canvasWidth, canvasHeight);
    const label =
      item.kind === "humanStroke"
        ? `${item.tool} stroke ${index + 1}`
        : item.kind === "asciiBlock"
          ? `text block ${index + 1}`
          : `${item.shape} shape ${index + 1}`;

    return {
      kind: item.kind,
      label,
      bbox,
      occupiedGridCells
    };
  });
}

export function calculateUnitScale(
  humanDelta: PlannerHumanContext[],
  canvasWidth: number,
  canvasHeight: number
): UnitScale {
  const boxes = humanDelta
    .map((item) => getHumanContextBoundingBox(item))
    .filter((box) => box.width > 0 && box.height > 0);

  if (boxes.length === 0) {
    const fallback = Math.min(canvasWidth, canvasHeight) / SEMANTIC_GRID_SIZE;
    return {
      averageWidth: fallback,
      averageHeight: fallback,
      unit: fallback,
      sampleCount: 0
    };
  }

  const totals = boxes.reduce(
    (sum, box) => ({
      width: sum.width + box.width,
      height: sum.height + box.height
    }),
    { width: 0, height: 0 }
  );

  const averageWidth = totals.width / boxes.length;
  const averageHeight = totals.height / boxes.length;

  return {
    averageWidth,
    averageHeight,
    unit: (averageWidth + averageHeight) * 0.5,
    sampleCount: boxes.length
  };
}
