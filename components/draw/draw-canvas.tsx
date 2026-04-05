"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { type AnimatedVisual } from "@/lib/draw/animation";
import {
  type AiCursorPresence,
  type CommentThread,
  type HumanStroke,
  type PersistedAsciiBlock,
  type PersistedShapeElement,
  type Point,
  type SpeechDraft,
  type ToolMode
} from "@/lib/draw-types";
import {
  clamp,
  getActiveRegionBounds,
  getBoardBounds,
  humanStrokeToPathData,
  screenToWorld,
  serializeBoardSvg,
  worldToScreen,
  type Viewport
} from "@/lib/draw/rendering";
import { shapeToPathData } from "@/lib/draw/shapes";
import { PAPER_COLOR } from "@/lib/draw/shared";
import { rasterizeSvgMarkup } from "@/lib/draw/rasterize";
import { PenCursorIcon } from "@/components/draw/pen-cursor-icon";
import { TextCursorIcon } from "@/components/draw/text-cursor-icon";

export type DrawCanvasHandle = {
  captureSnapshot: (options?: {
    maxWidth?: number;
    maxHeight?: number;
    mimeType?: string;
    quality?: number;
  }) => Promise<string>;
  captureFocusSnapshot: (options?: {
    maxWidth?: number;
    maxHeight?: number;
    mimeType?: string;
    quality?: number;
    padding?: number;
  }) => Promise<string>;
  exportSvg: () => string;
  getCanvasMetrics: () => {
    width: number;
    height: number;
    originX: number;
    originY: number;
  };
};

const DEFAULT_SNAPSHOT_WIDTH = 1600;
const DEFAULT_SNAPSHOT_HEIGHT = 1000;
const SNAPSHOT_PADDING = 140;
const INITIAL_VIEW_PADDING = 180;

type DrawCanvasProps = {
  humanStrokes: HumanStroke[];
  currentStroke: HumanStroke | null;
  drawingElements: PersistedShapeElement[];
  asciiBlocks: PersistedAsciiBlock[];
  activeAnimation: AnimatedVisual | null;
  comments: CommentThread[];
  activeCommentId: string | null;
  commentComposer:
    | {
        x: number;
        y: number;
        text: string;
      }
    | null;
  speechDraft: SpeechDraft | null;
  aiCursor: AiCursorPresence;
  tool: ToolMode;
  strokeColor: string;
  backgroundMode: "dots" | "grid";
  loading: boolean;
  onStartStroke: (point: Point) => void;
  onMoveStroke: (point: Point) => void;
  onEndStroke: () => void;
  onStampAscii: (point: Point) => void;
  onPlaceComment: (point: Point) => void;
  onSelectComment: (id: string | null) => void;
  onCommentComposerChange: (text: string) => void;
  onCommentComposerSubmit: () => void;
  onCommentComposerClose: () => void;
  onAskAiAboutComment: (id: string) => void;
};

type GestureState =
  | {
      type: "draw";
    }
  | {
      type: "pan";
      startViewport: Viewport;
      startPoint: Point;
    }
  | {
      type: "pinch";
      startViewport: Viewport;
      startDistance: number;
      startCenter: Point;
    }
  | null;

function HumanStrokeSvg({
  stroke,
  preview
}: {
  stroke: HumanStroke;
  preview?: boolean;
}) {
  const path = humanStrokeToPathData(stroke);
  const isErase = stroke.tool === "erase";

  return (
    <path
      d={path}
      fill="none"
      stroke={isErase ? "rgba(246, 183, 160, 0.9)" : stroke.color}
      strokeWidth={stroke.size}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={preview ? 0.9 : 1}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function ShapeElementSvg({
  element,
  progress = 1
}: {
  element: PersistedShapeElement;
  progress?: number;
}) {
  const shape = element.shape;
  const stroke = "stroke" in shape ? shape.stroke ?? "#262523" : "#262523";
  const strokeWidth = "strokeWidth" in shape ? shape.strokeWidth ?? 3 : 3;
  const opacity = "opacity" in shape ? shape.opacity ?? 1 : 1;

  if (shape.kind === "erase") {
    return (
      <path
        d={shapeToPathData(shape)}
        fill="none"
        stroke="rgba(246, 183, 160, 0.86)"
        strokeWidth={shape.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.92}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - progress}
      />
    );
  }

  const fill = "fill" in shape ? shape.fill ?? "transparent" : "transparent";
  const path = shapeToPathData(shape);
  const fillOpacity =
    fill === "transparent" ? 0 : Math.max(0, Math.min(1, (progress - 0.72) / 0.28)) * opacity;

  return (
    <path
      d={path}
      fill={fill}
      fillOpacity={fillOpacity}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      vectorEffect="non-scaling-stroke"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - progress}
    />
  );
}

function AsciiBlockSvg({
  block,
  visibleText
}: {
  block: PersistedAsciiBlock;
  visibleText?: string;
}) {
  const text = visibleText ?? block.text;
  const lines = text.split("\n");

  return (
    <text
      x={block.x}
      y={block.y}
      fill={block.color}
      fontSize={block.fontSize}
      fontFamily='Caveat, "Courier New", monospace'
      dominantBaseline="hanging"
    >
      {lines.map((line, index) => (
        <tspan key={`${block.id}-${index}`} x={block.x} dy={index === 0 ? 0 : block.fontSize * 1.02}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function EraserMask({
  id,
  bounds,
  humanStrokes,
  drawingElements
}: {
  id: string;
  bounds: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
  humanStrokes: HumanStroke[];
  drawingElements: PersistedShapeElement[];
}) {
  const padding = 2048;
  const x = bounds.minX - padding;
  const y = bounds.minY - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;

  return (
    <mask
      id={id}
      maskUnits="userSpaceOnUse"
      maskContentUnits="userSpaceOnUse"
      x={x}
      y={y}
      width={width}
      height={height}
    >
      <rect x={x} y={y} width={width} height={height} fill="white" />
      {humanStrokes
        .filter((stroke) => stroke.tool === "erase")
        .map((stroke) => (
          <path
            key={stroke.id}
            d={humanStrokeToPathData(stroke)}
            fill="none"
            stroke="black"
            strokeWidth={stroke.size}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {drawingElements
        .filter((element) => element.shape.kind === "erase")
        .map((element) => {
          const shape = element.shape;
          return (
            <path
              key={element.id}
              d={shapeToPathData(shape)}
              fill="none"
              stroke="black"
              strokeWidth={shape.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
    </mask>
  );
}

export const DrawCanvas = forwardRef<DrawCanvasHandle, DrawCanvasProps>(
  function DrawCanvas(
    {
      humanStrokes,
      currentStroke,
      drawingElements,
      asciiBlocks,
      activeAnimation,
      comments,
      activeCommentId,
      commentComposer,
      speechDraft,
      aiCursor,
      tool,
      strokeColor,
      backgroundMode,
      loading,
      onStartStroke,
      onMoveStroke,
      onEndStroke,
      onStampAscii,
      onPlaceComment,
      onSelectComment,
      onCommentComposerChange,
      onCommentComposerSubmit,
      onCommentComposerClose,
      onAskAiAboutComment
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const maskId = useId();
    const [containerSize, setContainerSize] = useState({ width: 1200, height: 760 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
    const [gesture, setGesture] = useState<GestureState>(null);
    const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
    const hasInitializedViewportRef = useRef(false);

    const sceneBounds = useMemo(
      () =>
        getBoardBounds({
          humanStrokes,
          drawingElements,
          asciiBlocks,
          comments,
          currentStroke,
          padding: INITIAL_VIEW_PADDING,
          minWidth: DEFAULT_SNAPSHOT_WIDTH,
          minHeight: DEFAULT_SNAPSHOT_HEIGHT
        }),
      [asciiBlocks, comments, currentStroke, drawingElements, humanStrokes]
    );

    const totalScale = viewport.scale;

    useEffect(() => {
      if (hasInitializedViewportRef.current) {
        return;
      }

      const nextScale = clamp(
        Math.min(
          Math.max(1, containerSize.width - 72) / Math.max(1, sceneBounds.width),
          Math.max(1, containerSize.height - 140) / Math.max(1, sceneBounds.height)
        ),
        0.24,
        1
      );

      setViewport({
        scale: nextScale,
        x:
          containerSize.width * 0.5 -
          (sceneBounds.minX + sceneBounds.width * 0.5) * nextScale,
        y:
          containerSize.height * 0.5 -
          (sceneBounds.minY + sceneBounds.height * 0.5) * nextScale
      });
      hasInitializedViewportRef.current = true;
    }, [containerSize.height, containerSize.width, sceneBounds]);

    const convertClientToWorld = useCallback(
      (clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return null;
        }

        return screenToWorld(
          {
            x: clientX,
            y: clientY
          },
          rect,
          viewport
        );
      },
      [viewport]
    );

    const convertWorldToClient = useCallback(
      (point: Point) => worldToScreen(point, viewport),
      [viewport]
    );

    useEffect(() => {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) {
          return;
        }

        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      });

      if (containerRef.current) {
        observer.observe(containerRef.current);
      }

      return () => observer.disconnect();
    }, []);

    const snapshotBounds = useMemo(
      () =>
        getBoardBounds({
          humanStrokes,
          drawingElements,
          asciiBlocks,
          comments,
          currentStroke,
          padding: SNAPSHOT_PADDING,
          minWidth: DEFAULT_SNAPSHOT_WIDTH,
          minHeight: DEFAULT_SNAPSHOT_HEIGHT
        }),
      [asciiBlocks, comments, currentStroke, drawingElements, humanStrokes]
    );

    const focusBounds = useMemo(
      () =>
        getActiveRegionBounds({
          syncState: {
            humanStrokes,
            drawingElements,
            asciiBlocks
          },
          targetComment: comments.find((comment) => comment.id === activeCommentId) ?? null,
          fallbackBounds: snapshotBounds,
          padding: 140
        }),
      [activeCommentId, asciiBlocks, comments, drawingElements, humanStrokes, snapshotBounds]
    );

    useImperativeHandle(
      ref,
      () => ({
        captureSnapshot: async (options) => {
          const maxWidth = options?.maxWidth ?? 640;
          const maxHeight = options?.maxHeight ?? 400;
          const scale = Math.min(
            1,
            maxWidth / snapshotBounds.width,
            maxHeight / snapshotBounds.height
          );
          const width = Math.max(1, Math.round(snapshotBounds.width * scale));
          const height = Math.max(1, Math.round(snapshotBounds.height * scale));
          const markup = serializeBoardSvg({
            width: snapshotBounds.width,
            height: snapshotBounds.height,
            translateX: -snapshotBounds.minX,
            translateY: -snapshotBounds.minY,
            humanStrokes,
            drawingElements,
            asciiBlocks
          });

          return rasterizeSvgMarkup({
            markup,
            width,
            height,
            mimeType: options?.mimeType,
            quality: options?.quality
          });
        },
        captureFocusSnapshot: async (options) => {
          const maxWidth = options?.maxWidth ?? 1024;
          const maxHeight = options?.maxHeight ?? 1024;
          const padding = options?.padding ?? 80;
          const paddedBounds = {
            minX: focusBounds.minX - padding,
            minY: focusBounds.minY - padding,
            maxX: focusBounds.maxX + padding,
            maxY: focusBounds.maxY + padding,
            width: focusBounds.width + padding * 2,
            height: focusBounds.height + padding * 2
          };
          const scale = Math.min(
            1,
            maxWidth / paddedBounds.width,
            maxHeight / paddedBounds.height
          );
          const width = Math.max(1, Math.round(paddedBounds.width * scale));
          const height = Math.max(1, Math.round(paddedBounds.height * scale));
          const markup = serializeBoardSvg({
            width: paddedBounds.width,
            height: paddedBounds.height,
            translateX: -paddedBounds.minX,
            translateY: -paddedBounds.minY,
            humanStrokes,
            drawingElements,
            asciiBlocks
          });

          return rasterizeSvgMarkup({
            markup,
            width,
            height,
            mimeType: options?.mimeType,
            quality: options?.quality
          });
        },
        exportSvg: () =>
          serializeBoardSvg({
            width: snapshotBounds.width,
            height: snapshotBounds.height,
            translateX: -snapshotBounds.minX,
            translateY: -snapshotBounds.minY,
            humanStrokes,
            drawingElements,
            asciiBlocks
          }),
        getCanvasMetrics: () => ({
          width: Math.round(snapshotBounds.width),
          height: Math.round(snapshotBounds.height),
          originX: snapshotBounds.minX,
          originY: snapshotBounds.minY
        })
      }),
      [activeCommentId, asciiBlocks, comments, drawingElements, focusBounds, humanStrokes, snapshotBounds]
    );

    const startPan = useCallback(
      (point: Point) => {
        setGesture({
          type: "pan",
          startViewport: viewport,
          startPoint: point
        });
      },
      [viewport]
    );

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button === 1) {
          startPan({ x: event.clientX, y: event.clientY });
          return;
        }

        const worldPoint = convertClientToWorld(event.clientX, event.clientY);
        if (!worldPoint) {
          return;
        }

        if (tool === "draw" || tool === "erase") {
          setGesture({ type: "draw" });
          onStartStroke(worldPoint);
          return;
        }

        if (tool === "ascii") {
          onStampAscii(worldPoint);
          return;
        }

        if (tool === "comment") {
          onPlaceComment(worldPoint);
        }
      },
      [
        convertClientToWorld,
        onPlaceComment,
        onStampAscii,
        onStartStroke,
        startPan,
        tool
      ]
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        setCursorPoint({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        const worldPoint = convertClientToWorld(event.clientX, event.clientY);
        if (!worldPoint) {
          return;
        }

        if (gesture?.type === "draw") {
          onMoveStroke(worldPoint);
          return;
        }

        if (gesture?.type === "pan") {
          setViewport({
            ...gesture.startViewport,
            x: gesture.startViewport.x + (event.clientX - gesture.startPoint.x),
            y: gesture.startViewport.y + (event.clientY - gesture.startPoint.y)
          });
        }
      },
      [convertClientToWorld, gesture, onMoveStroke]
    );

    const handlePointerUp = useCallback(() => {
      if (gesture?.type === "draw") {
        onEndStroke();
      }
      setGesture(null);
    }, [gesture?.type, onEndStroke]);

    const handlePointerLeave = useCallback(() => {
      setCursorPoint(null);
      if (gesture?.type === "draw") {
        onEndStroke();
      }
      setGesture(null);
    }, [gesture?.type, onEndStroke]);

    const handleWheel = useCallback(
      (event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const nextScale = clamp(
          viewport.scale + (event.deltaY < 0 ? 0.08 : -0.08),
          0.24,
          3.2
        );

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        const pointer = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
        const scaleRatio = nextScale / viewport.scale;
        setViewport((current) => ({
          scale: nextScale,
          x: pointer.x - (pointer.x - current.x) * scaleRatio,
          y: pointer.y - (pointer.y - current.y) * scaleRatio
        }));
      },
      [viewport.scale]
    );

    const handleTouchStart = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        const touches = Array.from(event.touches);

        if (touches.length === 2) {
          const [a, b] = touches;
          const center = {
            x: (a.clientX + b.clientX) / 2,
            y: (a.clientY + b.clientY) / 2
          };
          const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          setGesture({
            type: "pinch",
            startViewport: viewport,
            startDistance: distance,
            startCenter: center
          });
          return;
        }

        if (touches.length === 1) {
          const worldPoint = convertClientToWorld(
            touches[0].clientX,
            touches[0].clientY
          );
          if (!worldPoint) {
            return;
          }

          if (tool === "draw" || tool === "erase") {
            setGesture({ type: "draw" });
            onStartStroke(worldPoint);
          } else if (tool === "ascii") {
            onStampAscii(worldPoint);
          } else if (tool === "comment") {
            onPlaceComment(worldPoint);
          }
        }
      },
      [
        convertClientToWorld,
        onPlaceComment,
        onStampAscii,
        onStartStroke,
        tool,
        viewport
      ]
    );

    const handleTouchMove = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        const touches = Array.from(event.touches);

        if (gesture?.type === "pinch" && touches.length === 2) {
          const [a, b] = touches;
          const nextDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
          const center = {
            x: (a.clientX + b.clientX) / 2,
            y: (a.clientY + b.clientY) / 2
          };
          const scaleRatio = nextDistance / gesture.startDistance;
          setViewport({
            scale: clamp(gesture.startViewport.scale * scaleRatio, 0.24, 3.2),
            x: gesture.startViewport.x + (center.x - gesture.startCenter.x),
            y: gesture.startViewport.y + (center.y - gesture.startCenter.y)
          });
          return;
        }

        if (gesture?.type === "draw" && touches.length === 1) {
          const point = convertClientToWorld(touches[0].clientX, touches[0].clientY);
          if (point) {
            onMoveStroke(point);
          }
        }
      },
      [convertClientToWorld, gesture, onMoveStroke]
    );

    const handleTouchEnd = useCallback(() => {
      if (gesture?.type === "draw") {
        onEndStroke();
      }
      setGesture(null);
    }, [gesture?.type, onEndStroke]);

    const activeComment = useMemo(
      () => comments.find((comment) => comment.id === activeCommentId) ?? null,
      [activeCommentId, comments]
    );

    const aiCursorPoint = aiCursor.visible
      ? convertWorldToClient({
          x: aiCursor.x,
          y: aiCursor.y
        })
      : null;

    const speechPoint = speechDraft
      ? convertWorldToClient({
          x: speechDraft.x ?? aiCursor.x,
          y: speechDraft.y ?? aiCursor.y
        })
      : null;

    return (
      <div
        ref={containerRef}
        className={`draw-canvas-container${
          tool === "draw" ? " draw-canvas-container--pen-cursor" : ""
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`draw-world draw-world--${backgroundMode}`}
          style={{
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
            backgroundSize:
              backgroundMode === "dots"
                ? `${19 * totalScale}px ${19 * totalScale}px`
                : `${26 * totalScale}px ${26 * totalScale}px`
          }}
        />

        <svg
          className="draw-canvas"
          width={containerSize.width}
          height={containerSize.height}
          viewBox={`0 0 ${containerSize.width} ${containerSize.height}`}
        >
          <defs>
            <EraserMask
              id={maskId}
              bounds={sceneBounds}
              humanStrokes={humanStrokes}
              drawingElements={drawingElements}
            />
          </defs>

          <g transform={`translate(${viewport.x} ${viewport.y}) scale(${totalScale})`}>
            <g mask={`url(#${maskId})`}>
              {asciiBlocks.map((block) => (
                <AsciiBlockSvg key={block.id} block={block} />
              ))}
              {humanStrokes
                .filter((stroke) => stroke.tool !== "erase")
                .map((stroke) => (
                  <HumanStrokeSvg key={stroke.id} stroke={stroke} />
                ))}
              {drawingElements
                .filter((element) => element.shape.kind !== "erase")
                .map((element) => (
                  <ShapeElementSvg key={element.id} element={element} />
                ))}
            </g>

            {drawingElements
              .filter((element) => element.shape.kind === "erase")
              .map((element) => (
                <ShapeElementSvg key={element.id} element={element} />
              ))}

            {activeAnimation?.type === "shape" ? (
              <ShapeElementSvg
                element={activeAnimation.element}
                progress={activeAnimation.progress}
              />
            ) : null}
            {activeAnimation?.type === "block" ? (
              <AsciiBlockSvg
                block={activeAnimation.block}
                visibleText={activeAnimation.visibleText}
              />
            ) : null}
            {currentStroke ? <HumanStrokeSvg stroke={currentStroke} preview /> : null}
          </g>
        </svg>

        <div
          className="draw-overlay-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${totalScale})`
          }}
        >
          {comments.map((comment) => (
            <button
              key={comment.id}
              className={`draw-comment-pin${
                comment.id === activeCommentId ? " is-active" : ""
              }`}
              style={{ left: comment.x, top: comment.y }}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectComment(comment.id === activeCommentId ? null : comment.id);
              }}
            >
              <span />
            </button>
          ))}

          {commentComposer ? (
            <div
              className="draw-comment-composer"
              style={{ left: commentComposer.x, top: commentComposer.y }}
              onClick={(event) => event.stopPropagation()}
            >
              <textarea
                value={commentComposer.text}
                onChange={(event) => onCommentComposerChange(event.target.value)}
                placeholder="Pin a thought on the page..."
              />
              <div className="draw-comment-composer-actions">
                <button type="button" onClick={onCommentComposerClose}>
                  Cancel
                </button>
                <button type="button" onClick={onCommentComposerSubmit}>
                  Pin
                </button>
              </div>
            </div>
          ) : null}

          {activeComment ? (
            <div
              className="draw-comment-thread"
              style={{ left: activeComment.x + 18, top: activeComment.y + 18 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="draw-comment-thread-head">
                <span>{activeComment.author}</span>
                <button type="button" onClick={() => onSelectComment(null)}>
                  Close
                </button>
              </div>
              <div className="draw-comment-thread-body">
                {activeComment.thread.map((message) => (
                  <div
                    key={message.id}
                    className={`draw-thread-message draw-thread-message--${message.author}`}
                  >
                    <span>{message.author === "ai" ? "AI" : "You"}</span>
                    <p>{message.text}</p>
                  </div>
                ))}
              </div>
              <button
                className="draw-thread-ai"
                type="button"
                disabled={loading}
                onClick={() => onAskAiAboutComment(activeComment.id)}
              >
                {loading ? "Working..." : "Reply or draw here"}
              </button>
            </div>
          ) : null}
        </div>

        {speechDraft && speechPoint ? (
          <div
            className="draw-ai-speech"
            style={{
              left: speechPoint.x,
              top: speechPoint.y
            }}
          >
            <span>{speechDraft.text}</span>
          </div>
        ) : null}

        {aiCursorPoint ? (
          <div
            className={`draw-pen-cursor draw-pen-cursor--${aiCursor.phase}`}
            style={{ left: aiCursorPoint.x, top: aiCursorPoint.y }}
          >
            <PenCursorIcon variant="ai" className="draw-pen-cursor__icon" />
          </div>
        ) : null}

        {tool === "draw" && cursorPoint ? (
          <div
            className="draw-local-cursor"
            style={{ left: cursorPoint.x, top: cursorPoint.y, color: strokeColor }}
          >
            <PenCursorIcon variant="solid" className="draw-pen-cursor__icon" />
          </div>
        ) : null}

        {tool === "ascii" && cursorPoint ? (
          <div
            className="draw-local-cursor draw-local-cursor--text"
            style={{ left: cursorPoint.x, top: cursorPoint.y, color: strokeColor }}
          >
            <TextCursorIcon className="draw-text-cursor__icon" />
          </div>
        ) : null}
      </div>
    );
  }
);
