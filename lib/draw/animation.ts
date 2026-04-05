import {
  type CursorPhase,
  type PersistedAsciiBlock,
  type PersistedShapeElement,
  type Point
} from "@/lib/draw/elements";
import {
  estimateShapeLength,
  getShapeCenterPoint,
  getShapeStartPoint,
  sampleShapePoint,
  type PointTuple
} from "@/lib/draw/shapes";

export type AnimatedVisual =
  | {
      type: "shape";
      element: PersistedShapeElement;
      progress: number;
    }
  | {
      type: "block";
      block: PersistedAsciiBlock;
      visibleText: string;
      progress: number;
    };

export type CursorUpdate = {
  phase: CursorPhase;
  point: Point;
};

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function easeInOutSine(progress: number) {
  return -(Math.cos(Math.PI * progress) - 1) * 0.5;
}

function quadraticArc(a: PointTuple, b: PointTuple, progress: number, lift = 24): Point {
  const midX = (a[0] + b[0]) * 0.5;
  const midY = (a[1] + b[1]) * 0.5 - lift;
  const t = progress;
  const inverse = 1 - t;
  return {
    x: inverse * inverse * a[0] + 2 * inverse * t * midX + t * t * b[0],
    y: inverse * inverse * a[1] + 2 * inverse * t * midY + t * t * b[1]
  };
}

export function getAnimationDuration(element: PersistedShapeElement) {
  const length = estimateShapeLength(element.shape);
  return Math.max(340, Math.min(2800, 220 + length * 3.2));
}

export function getCursorStartPoint(element: PersistedShapeElement): Point {
  const [x, y] = getShapeStartPoint(element.shape);
  return { x, y };
}

export function getCursorTracePoint(element: PersistedShapeElement, progress: number): Point {
  const [x, y] = sampleShapePoint(element.shape, progress);
  return { x, y };
}

export function getCursorHoverPoint(element: PersistedShapeElement): Point {
  const [x, y] = getShapeCenterPoint(element.shape);
  return { x, y };
}

export async function animateCursorGlide(options: {
  from: Point;
  to: Point;
  onUpdate: (update: CursorUpdate) => void;
}) {
  const start: PointTuple = [options.from.x, options.from.y];
  const end: PointTuple = [options.to.x, options.to.y];
  const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const duration = Math.max(180, Math.min(640, distance * 2.4));

  await new Promise<void>((resolve) => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const raw = Math.min(1, (now - startTime) / duration);
      const point = quadraticArc(start, end, easeInOutSine(raw), Math.min(48, 12 + distance * 0.08));
      options.onUpdate({
        phase: "gliding",
        point
      });
      if (raw < 1) {
        window.requestAnimationFrame(tick);
        return;
      }
      resolve();
    };

    window.requestAnimationFrame(tick);
  });
}

export async function animateCursorTrace(options: {
  element: PersistedShapeElement;
  onFrame: (visual: AnimatedVisual, update: CursorUpdate) => void;
}) {
  const duration = getAnimationDuration(options.element);

  await new Promise<void>((resolve) => {
    const startTime = performance.now();
    const tick = (now: number) => {
      const raw = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutSine(raw);
      options.onFrame(
        {
          type: "shape",
          element: options.element,
          progress: eased
        },
        {
          phase: "tracing",
          point: getCursorTracePoint(options.element, eased)
        }
      );

      if (raw < 1) {
        window.requestAnimationFrame(tick);
        return;
      }
      resolve();
    };

    window.requestAnimationFrame(tick);
  });
}

export async function animateBlockReveal(options: {
  block: PersistedAsciiBlock;
  onFrame: (visual: AnimatedVisual, update: CursorUpdate) => void;
}) {
  const chars = options.block.text.split("");
  let visible = "";

  for (const char of chars) {
    visible += char;
    options.onFrame(
      {
        type: "block",
        block: options.block,
        visibleText: visible,
        progress: visible.length / chars.length
      },
      {
        phase: "speaking",
        point: {
          x: options.block.x,
          y: options.block.y
        }
      }
    );
    await sleep(char === "\n" ? 18 : 26);
  }
}
