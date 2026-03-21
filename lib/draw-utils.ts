import {
  type AiStroke,
  type AsciiBlock,
  type DrawingElement,
  type HumanStroke,
  type Point,
  type ShapeElement
} from "@/lib/draw-types";

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function screenToWorld(
  point: Point,
  rect: DOMRect,
  viewport: Viewport
): Point {
  return {
    x: (point.x - rect.left - viewport.x) / viewport.scale,
    y: (point.y - rect.top - viewport.y) / viewport.scale
  };
}

export function worldToScreen(
  point: Point,
  viewport: Viewport
): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y
  };
}

type RenderOptions = {
  motionTimeMs?: number;
};

type SplinePoint = Point & {
  tangentX: number;
  tangentY: number;
};

type AnimatedSplinePoint = SplinePoint & {
  handleOffsetX: number;
  handleOffsetY: number;
};

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getSplinePoints(points: Point[]): SplinePoint[] {
  return points.map((point, index, source) => {
    const prev = source[Math.max(0, index - 1)];
    const next = source[Math.min(source.length - 1, index + 1)];
    const tangentX = next.x - prev.x;
    const tangentY = next.y - prev.y;
    const tangentLength = Math.hypot(tangentX, tangentY) || 1;

    return {
      ...point,
      tangentX: tangentX / tangentLength,
      tangentY: tangentY / tangentLength
    };
  });
}

function getPathDistances(points: Point[]) {
  const distances = new Array<number>(points.length).fill(0);
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    totalLength += distance(points[index - 1], points[index]);
    distances[index] = totalLength;
  }

  return {
    distances,
    totalLength
  };
}

function resampleStrokePoints(points: Point[], spacing: number) {
  if (points.length < 2) {
    return points;
  }

  const resampled: Point[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const segmentLength = distance(start, end);
    const segmentCount = Math.max(1, Math.ceil(segmentLength / spacing));

    for (let step = 1; step <= segmentCount; step += 1) {
      const progress = step / segmentCount;
      resampled.push({
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress
      });
    }
  }

  return resampled;
}

function sampleContourBoil(
  progress: number,
  arcDistance: number,
  time: number,
  seed: number,
  phaseOffset = 0
) {
  const phase = time * 0.78 + seed * Math.PI * 2 + phaseOffset;
  const longWave = Math.sin(progress * Math.PI * 2.4 + phase);
  const midWave = Math.cos(progress * Math.PI * 4.1 - time * 0.58 + seed * 8.2 + phaseOffset);
  const arcWave = Math.sin(arcDistance * 0.018 + time * 0.92 + seed * 13.7 + phaseOffset);
  const shimmer = Math.cos(arcDistance * 0.033 - time * 1.06 + seed * 19.1 + phaseOffset);

  return (
    longWave * 0.44 +
    midWave * 0.31 +
    arcWave * 0.17 +
    shimmer * 0.08
  );
}

function getAnimatedStrokePoints(
  stroke: HumanStroke | AiStroke,
  motionTimeMs?: number
) : AnimatedSplinePoint[] {
  if (stroke.points.length < 2) {
    return [];
  }

  if (stroke.kind === "humanStroke" && stroke.tool === "erase") {
    return getSplinePoints(stroke.points).map((point) => ({
      ...point,
      handleOffsetX: 0,
      handleOffsetY: 0
    }));
  }

  const splinePoints = getSplinePoints(stroke.points);
  if (!motionTimeMs) {
    return splinePoints.map((point) => ({
      ...point,
      handleOffsetX: 0,
      handleOffsetY: 0
    }));
  }

  const time = motionTimeMs / 1000;
  const seed = hashString(stroke.id);
  const animatedPoints = resampleStrokePoints(
    stroke.points,
    Math.max(6, 12 - stroke.size * 0.25)
  );
  const animatedSplinePoints = getSplinePoints(animatedPoints);
  const { distances, totalLength } = getPathDistances(animatedPoints);
  const contourAmplitude = Math.min(2.6, Math.max(0.6, stroke.size * 0.18));
  const tangentAmplitude = contourAmplitude * 0.16;

  return animatedSplinePoints.map((point, index, points) => {
    const progress =
      totalLength > 0
        ? distances[index] / totalLength
        : index / Math.max(1, points.length - 1);
    const arcDistance = distances[index];
    const normalX = -point.tangentY;
    const normalY = point.tangentX;
    const edgeFade = 0.74 + Math.sin(progress * Math.PI) * 0.26;
    const contourField = sampleContourBoil(progress, arcDistance, time, seed);
    const contourDetail = sampleContourBoil(
      progress,
      arcDistance,
      time * 1.12,
      seed,
      1.9
    );
    const tangentField = sampleContourBoil(
      progress,
      arcDistance,
      time * 0.9,
      seed,
      3.7
    );
    const microVibration =
      Math.sin(arcDistance * 0.05 + time * 3.8 + seed * 27.4) *
      contourAmplitude *
      0.12;
    const secondaryVibration =
      Math.cos(progress * Math.PI * 9.4 - time * 2.7 + seed * 33.1) *
      contourAmplitude *
      0.06;

    const normalOffset =
      (contourField * 0.82 + contourDetail * 0.18) *
      contourAmplitude *
      edgeFade +
      microVibration +
      secondaryVibration;
    const tangentOffset =
      tangentField * tangentAmplitude +
      Math.sin(arcDistance * 0.03 + time * 1.9 + seed * 14.2) *
        contourAmplitude *
        0.03;
    const handleLift =
      normalOffset * 0.84 +
      contourDetail * contourAmplitude * 0.34 +
      Math.sin(progress * Math.PI * 6.4 + time * 0.62 + seed * 24.1) *
        contourAmplitude *
        0.12;

    return {
      ...point,
      x: point.x + normalX * normalOffset + point.tangentX * tangentOffset,
      y: point.y + normalY * normalOffset + point.tangentY * tangentOffset,
      handleOffsetX:
        normalX * handleLift +
        point.tangentX * tangentOffset * 0.65,
      handleOffsetY:
        normalY * handleLift +
        point.tangentY * tangentOffset * 0.65
    };
  });
}

function drawBezierSpline(
  ctx: CanvasRenderingContext2D,
  points: AnimatedSplinePoint[],
  strokeSize: number
) {
  if (points.length < 2) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const segmentLength = Math.hypot(next.x - current.x, next.y - current.y);
    const handleLength = Math.min(
      segmentLength * 0.34,
      22 + strokeSize * 0.9
    );

    ctx.bezierCurveTo(
      current.x + current.tangentX * handleLength + current.handleOffsetX,
      current.y + current.tangentY * handleLength + current.handleOffsetY,
      next.x - next.tangentX * handleLength + next.handleOffsetX,
      next.y - next.tangentY * handleLength + next.handleOffsetY,
      next.x,
      next.y
    );
  }

  ctx.stroke();
}

function drawStrokePath(
  ctx: CanvasRenderingContext2D,
  stroke: HumanStroke | AiStroke,
  options?: RenderOptions
) {
  const points = getAnimatedStrokePoints(stroke, options?.motionTimeMs);
  drawBezierSpline(ctx, points, stroke.size);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: ShapeElement) {
  const shouldFill = Boolean(shape.fill && shape.fill !== "transparent");
  ctx.save();
  ctx.translate(shape.x, shape.y);
  ctx.rotate(shape.rotation ?? 0);
  ctx.lineWidth = shape.strokeWidth ?? 2;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.fill ?? "transparent";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (shape.shape) {
    case "rect":
      if (shouldFill) {
        ctx.fillRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
      }
      ctx.strokeRect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
      break;
    case "circle":
      ctx.beginPath();
      ctx.ellipse(0, 0, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
      if (shouldFill) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    case "triangle":
      ctx.beginPath();
      ctx.moveTo(0, -shape.height / 2);
      ctx.lineTo(shape.width / 2, shape.height / 2);
      ctx.lineTo(-shape.width / 2, shape.height / 2);
      ctx.closePath();
      if (shouldFill) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    case "trapezoid": {
      const topWidth = shape.width * 0.58;
      ctx.beginPath();
      ctx.moveTo(-topWidth / 2, -shape.height / 2);
      ctx.lineTo(topWidth / 2, -shape.height / 2);
      ctx.lineTo(shape.width / 2, shape.height / 2);
      ctx.lineTo(-shape.width / 2, shape.height / 2);
      ctx.closePath();
      if (shouldFill) {
        ctx.fill();
      }
      ctx.stroke();
      break;
    }
    case "line":
      ctx.beginPath();
      ctx.moveTo(-shape.width / 2, -shape.height / 2);
      ctx.lineTo(shape.width / 2, shape.height / 2);
      ctx.stroke();
      break;
    case "arrow":
      ctx.beginPath();
      ctx.moveTo(-shape.width / 2, 0);
      ctx.lineTo(shape.width / 2, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(shape.width / 2, 0);
      ctx.lineTo(shape.width / 2 - 12, -8);
      ctx.lineTo(shape.width / 2 - 12, 8);
      ctx.closePath();
      ctx.fillStyle = shape.color;
      ctx.fill();
      break;
    case "scribble":
      ctx.beginPath();
      ctx.moveTo(-shape.width / 2, 0);
      for (let index = 0; index < 8; index += 1) {
        const progress = index / 7;
        ctx.lineTo(
          -shape.width / 2 + shape.width * progress,
          Math.sin(progress * Math.PI * 3) * (shape.height / 2)
        );
      }
      ctx.stroke();
      break;
  }

  ctx.restore();
}

function drawAsciiBlock(ctx: CanvasRenderingContext2D, block: AsciiBlock) {
  ctx.save();
  ctx.font = `${block.fontSize}px "Caveat", "Courier New", monospace`;
  ctx.fillStyle = block.color;
  ctx.textBaseline = "top";
  const lines = block.text.split("\n");
  lines.forEach((line, index) => {
    ctx.fillText(line, block.x, block.y + index * block.fontSize * 0.95);
  });
  ctx.restore();
}

export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elements: DrawingElement[],
  currentStroke?: HumanStroke | null,
  options?: RenderOptions
) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const element of elements) {
    switch (element.kind) {
      case "humanStroke":
      case "aiStroke":
        ctx.save();
        ctx.strokeStyle = element.color;
        ctx.lineWidth = element.size;
        ctx.globalAlpha = element.opacity ?? 1;
        ctx.globalCompositeOperation =
          element.kind === "humanStroke" && element.tool === "erase"
            ? "destination-out"
            : "source-over";
        drawStrokePath(ctx, element, options);
        ctx.restore();
        break;
      case "shape":
        drawShape(ctx, element);
        break;
      case "asciiBlock":
        drawAsciiBlock(ctx, element);
        break;
    }
  }

  if (currentStroke) {
    ctx.save();
    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.size;
    ctx.globalCompositeOperation =
      currentStroke.tool === "erase" ? "destination-out" : "source-over";
    drawStrokePath(ctx, currentStroke, options);
    ctx.restore();
  }
}

function getSplineSvgPath(points: Point[], strokeSize: number) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const splinePoints = getSplinePoints(points);
  let path = `M ${splinePoints[0].x} ${splinePoints[0].y}`;

  for (let index = 0; index < splinePoints.length - 1; index += 1) {
    const current = splinePoints[index];
    const next = splinePoints[index + 1];
    const segmentLength = Math.hypot(next.x - current.x, next.y - current.y);
    const handleLength = Math.min(
      segmentLength * 0.34,
      22 + strokeSize * 0.9
    );

    path += ` C ${current.x + current.tangentX * handleLength} ${
      current.y + current.tangentY * handleLength
    }, ${next.x - next.tangentX * handleLength} ${
      next.y - next.tangentY * handleLength
    }, ${next.x} ${next.y}`;
  }

  return path;
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function elementsToSvg(
  elements: DrawingElement[],
  width: number,
  height: number
) {
  const body = elements
    .map((element) => {
      switch (element.kind) {
        case "humanStroke":
        case "aiStroke": {
          const path = getSplineSvgPath(element.points, element.size);
          return `<path d="${path}" fill="none" stroke="${element.color}" stroke-opacity="${element.opacity ?? 1}" stroke-width="${element.size}" stroke-linecap="round" stroke-linejoin="round" />`;
        }
        case "shape":
          if (element.shape === "circle") {
            return `<ellipse cx="${element.x}" cy="${element.y}" rx="${element.width / 2}" ry="${element.height / 2}" fill="${element.fill ?? "transparent"}" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" />`;
          }
          if (element.shape === "rect") {
            return `<rect x="${element.x - element.width / 2}" y="${element.y - element.height / 2}" width="${element.width}" height="${element.height}" fill="${element.fill ?? "transparent"}" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" />`;
          }
          if (element.shape === "triangle") {
            return `<polygon points="${element.x},${element.y - element.height / 2} ${element.x + element.width / 2},${element.y + element.height / 2} ${element.x - element.width / 2},${element.y + element.height / 2}" fill="${element.fill ?? "transparent"}" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" stroke-linejoin="round" />`;
          }
          if (element.shape === "trapezoid") {
            const topWidth = element.width * 0.58;
            return `<polygon points="${element.x - topWidth / 2},${element.y - element.height / 2} ${element.x + topWidth / 2},${element.y - element.height / 2} ${element.x + element.width / 2},${element.y + element.height / 2} ${element.x - element.width / 2},${element.y + element.height / 2}" fill="${element.fill ?? "transparent"}" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" stroke-linejoin="round" />`;
          }
          if (element.shape === "line") {
            return `<line x1="${element.x - element.width / 2}" y1="${element.y - element.height / 2}" x2="${element.x + element.width / 2}" y2="${element.y + element.height / 2}" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round" />`;
          }
          if (element.shape === "arrow") {
            const startX = element.x - element.width / 2;
            const endX = element.x + element.width / 2;
            return `<g stroke="${element.color}" fill="${element.color}" stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round"><line x1="${startX}" y1="${element.y}" x2="${endX}" y2="${element.y}" /><path d="M ${endX} ${element.y} L ${endX - 12} ${element.y - 8} L ${endX - 12} ${element.y + 8} Z" /></g>`;
          }
          return `<path d="M ${element.x - element.width / 2} ${element.y} C ${element.x - element.width / 4} ${element.y - element.height / 2}, ${element.x + element.width / 4} ${element.y + element.height / 2}, ${element.x + element.width / 2} ${element.y}" fill="none" stroke="${element.color}" stroke-width="${element.strokeWidth ?? 2}" stroke-linecap="round" />`;
        case "asciiBlock":
          return `<text x="${element.x}" y="${element.y}" fill="${element.color}" font-size="${element.fontSize}" font-family="Caveat, monospace">${escapeXml(
            element.text
          )}</text>`;
      }
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#faf9f7" />${body}</svg>`;
}

export function getHumanDelta(
  elements: DrawingElement[],
  lastAiElementIndex: number
): Array<HumanStroke | AsciiBlock | ShapeElement> {
  return elements
    .slice(lastAiElementIndex)
    .filter(
      (element): element is HumanStroke | AsciiBlock | ShapeElement =>
        element.kind === "humanStroke" ||
        element.kind === "asciiBlock" ||
        element.kind === "shape"
    );
}

export function getRecentHumanContext(
  elements: DrawingElement[],
  lastAiElementIndex: number,
  maxElements = 6
) {
  return getHumanDelta(elements, lastAiElementIndex)
    .slice(-maxElements)
    .map((element) => {
      if (element.kind === "humanStroke") {
        return {
          kind: element.kind,
          tool: element.tool,
          color: element.color,
          size: element.size,
          points: element.points
            .filter((_, index) => index % Math.max(1, Math.ceil(element.points.length / 24)) === 0)
            .slice(0, 24)
            .map((point) => [Math.round(point.x), Math.round(point.y)] as [number, number])
        };
      }

      if (element.kind === "asciiBlock") {
        return {
          kind: element.kind,
          color: element.color,
          fontSize: element.fontSize,
          x: Math.round(element.x),
          y: Math.round(element.y),
          text: element.text.slice(0, 80)
        };
      }

      return {
        kind: element.kind,
        shape: element.shape,
        color: element.color,
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width),
        height: Math.round(element.height),
        strokeWidth: element.strokeWidth ?? 2
      };
    });
}

export function getCanvasHumanContext(
  elements: DrawingElement[],
  maxElements = 24
) {
  return elements
    .filter(
      (element): element is HumanStroke | AsciiBlock | ShapeElement =>
        element.kind === "humanStroke" ||
        element.kind === "asciiBlock" ||
        element.kind === "shape"
    )
    .slice(-maxElements)
    .map((element) => {
      if (element.kind === "humanStroke") {
        return {
          kind: element.kind,
          tool: element.tool,
          color: element.color,
          size: element.size,
          points: element.points
            .filter((_, index) => index % Math.max(1, Math.ceil(element.points.length / 24)) === 0)
            .slice(0, 24)
            .map((point) => [Math.round(point.x), Math.round(point.y)] as [number, number])
        };
      }

      if (element.kind === "asciiBlock") {
        return {
          kind: element.kind,
          color: element.color,
          fontSize: element.fontSize,
          x: Math.round(element.x),
          y: Math.round(element.y),
          text: element.text.slice(0, 80)
        };
      }

      return {
        kind: element.kind,
        shape: element.shape,
        color: element.color,
        x: Math.round(element.x),
        y: Math.round(element.y),
        width: Math.round(element.width),
        height: Math.round(element.height),
        strokeWidth: element.strokeWidth ?? 2
      };
    });
}

export function getRecentAiContext(
  elements: DrawingElement[],
  maxElements = 4
) {
  return elements
    .filter((element): element is AiStroke => element.kind === "aiStroke")
    .slice(-maxElements)
    .map((stroke) => ({
      color: stroke.color,
      width: stroke.size,
      opacity: stroke.opacity ?? 1,
      points: stroke.points
        .filter((_, index) => index % Math.max(1, Math.ceil(stroke.points.length / 24)) === 0)
        .slice(0, 24)
        .map((point) => [Math.round(point.x), Math.round(point.y)] as [number, number])
    }));
}

export async function parseNdjsonStream<T>(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: T) => Promise<void> | void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      await onLine(JSON.parse(line) as T);
    }
  }

  if (buffer.trim()) {
    await onLine(JSON.parse(buffer) as T);
  }
}
