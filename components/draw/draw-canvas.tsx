"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import {
  type CommentPin,
  type DrawingElement,
  type HumanStroke,
  type Point,
  type ToolMode
} from "@/lib/draw-types";
import {
  clamp,
  elementsToSvg,
  renderDrawing,
  type Viewport,
  worldToScreen
} from "@/lib/draw-utils";
import { PenCursorIcon } from "@/components/draw/pen-cursor-icon";

export type DrawCanvasHandle = {
  captureSnapshot: (options?: {
    maxWidth?: number;
    maxHeight?: number;
    mimeType?: string;
    quality?: number;
  }) => string;
  exportSvg: () => string;
  getCanvasMetrics: () => { width: number; height: number };
};

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1000;

type DrawCanvasProps = {
  elements: DrawingElement[];
  currentStroke: HumanStroke | null;
  ephemeralElement: DrawingElement | null;
  comments: CommentPin[];
  activeCommentId: string | null;
  commentComposer:
    | {
        x: number;
        y: number;
        text: string;
      }
    | null;
  tool: ToolMode;
  strokeColor: string;
  backgroundMode: "dots" | "grid";
  loading: boolean;
  narration: string;
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

export const DrawCanvas = forwardRef<DrawCanvasHandle, DrawCanvasProps>(
  function DrawCanvas(
    {
      elements,
      currentStroke,
      ephemeralElement,
      comments,
      activeCommentId,
      commentComposer,
      tool,
      strokeColor,
      backgroundMode,
      loading,
      narration,
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
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [containerSize, setContainerSize] = useState({ width: 1200, height: 760 });
    const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
    const [gesture, setGesture] = useState<GestureState>(null);
    const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
    const touchStateRef = useRef<Map<number, Point>>(new Map());
    const animationFrameRef = useRef<number | null>(null);

    const fitScale = useMemo(
      () =>
        Math.min(
          containerSize.width / WORLD_WIDTH,
          containerSize.height / WORLD_HEIGHT
        ),
      [containerSize.height, containerSize.width]
    );

    const worldOffset = useMemo(
      () => ({
        x: (containerSize.width - WORLD_WIDTH * fitScale) / 2,
        y: (containerSize.height - WORLD_HEIGHT * fitScale) / 2
      }),
      [containerSize.height, containerSize.width, fitScale]
    );

    const totalScale = fitScale * viewport.scale;

    const convertClientToWorld = useCallback(
      (clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return null;
        }

        return {
          x: (clientX - rect.left - worldOffset.x - viewport.x) / totalScale,
          y: (clientY - rect.top - worldOffset.y - viewport.y) / totalScale
        };
      },
      [totalScale, viewport.x, viewport.y, worldOffset.x, worldOffset.y]
    );

    const convertWorldToClient = useCallback(
      (point: Point) =>
        worldToScreen(point, {
          x: worldOffset.x + viewport.x,
          y: worldOffset.y + viewport.y,
          scale: totalScale
        }),
      [totalScale, viewport.x, viewport.y, worldOffset.x, worldOffset.y]
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

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }

      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(containerSize.width * ratio));
      canvas.height = Math.max(1, Math.floor(containerSize.height * ratio));
      canvas.style.width = `${containerSize.width}px`;
      canvas.style.height = `${containerSize.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      const drawFrame = (time: number) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(
          ratio * totalScale,
          0,
          0,
          ratio * totalScale,
          ratio * (worldOffset.x + viewport.x),
          ratio * (worldOffset.y + viewport.y)
        );
        renderDrawing(
          ctx,
          WORLD_WIDTH,
          WORLD_HEIGHT,
          ephemeralElement ? [...elements, ephemeralElement] : elements,
          currentStroke,
          { motionTimeMs: time }
        );
        animationFrameRef.current = window.requestAnimationFrame(drawFrame);
      };

      animationFrameRef.current = window.requestAnimationFrame(drawFrame);

      return () => {
        if (animationFrameRef.current) {
          window.cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
      };
    }, [
      containerSize.height,
      containerSize.width,
      currentStroke,
      elements,
      ephemeralElement,
      totalScale,
      viewport.x,
      viewport.y,
      worldOffset.x,
      worldOffset.y
    ]);

    useImperativeHandle(
      ref,
      () => ({
        captureSnapshot: (options) => {
          const maxWidth = options?.maxWidth ?? 640;
          const maxHeight = options?.maxHeight ?? 400;
          const scale = Math.min(
            1,
            maxWidth / WORLD_WIDTH,
            maxHeight / WORLD_HEIGHT
          );
          const exportCanvas = document.createElement("canvas");
          exportCanvas.width = Math.max(1, Math.round(WORLD_WIDTH * scale));
          exportCanvas.height = Math.max(1, Math.round(WORLD_HEIGHT * scale));
          const ctx = exportCanvas.getContext("2d");
          if (!ctx) {
            return "";
          }
          ctx.scale(scale, scale);
          ctx.fillStyle = "#faf9f7";
          ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
          renderDrawing(ctx, WORLD_WIDTH, WORLD_HEIGHT, elements);
          return exportCanvas.toDataURL(
            options?.mimeType ?? "image/jpeg",
            options?.quality ?? 0.72
          );
        },
        exportSvg: () => elementsToSvg(elements, WORLD_WIDTH, WORLD_HEIGHT),
        getCanvasMetrics: () => ({
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT
        })
      }),
      [elements]
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

        const clamped = {
          x: clamp(worldPoint.x, 0, WORLD_WIDTH),
          y: clamp(worldPoint.y, 0, WORLD_HEIGHT)
        };

        if (tool === "draw" || tool === "erase") {
          setGesture({ type: "draw" });
          onStartStroke(clamped);
          return;
        }

        if (tool === "ascii") {
          onStampAscii(clamped);
          return;
        }

        if (tool === "comment") {
          onPlaceComment(clamped);
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
          0.65,
          2.6
        );

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        const pointer = {
          x: event.clientX - rect.left - worldOffset.x,
          y: event.clientY - rect.top - worldOffset.y
        };
        const scaleRatio = nextScale / viewport.scale;
        setViewport((current) => ({
          scale: nextScale,
          x: pointer.x - (pointer.x - current.x) * scaleRatio,
          y: pointer.y - (pointer.y - current.y) * scaleRatio
        }));
      },
      [viewport.scale, worldOffset.x, worldOffset.y]
    );

    const handleTouchStart = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        const touches = Array.from(event.touches);
        touches.forEach((touch) => {
          touchStateRef.current.set(touch.identifier, {
            x: touch.clientX,
            y: touch.clientY
          });
        });

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
            scale: clamp(gesture.startViewport.scale * scaleRatio, 0.65, 2.6),
            x:
              gesture.startViewport.x + (center.x - gesture.startCenter.x),
            y:
              gesture.startViewport.y + (center.y - gesture.startCenter.y)
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

    const handleTouchEnd = useCallback(
      (event: ReactTouchEvent<HTMLDivElement>) => {
        if (gesture?.type === "draw") {
          onEndStroke();
        }
        setGesture(null);
      },
      [gesture?.type, onEndStroke]
    );

    const activeComment = useMemo(
      () => comments.find((comment) => comment.id === activeCommentId) ?? null,
      [activeCommentId, comments]
    );

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
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            transform: `translate(${worldOffset.x + viewport.x}px, ${
              worldOffset.y + viewport.y
            }px) scale(${totalScale})`
          }}
        />
        <canvas ref={canvasRef} className="draw-canvas" />

        <div
          className="draw-overlay-layer"
          style={{
            transform: `translate(${worldOffset.x + viewport.x}px, ${
              worldOffset.y + viewport.y
            }px) scale(${totalScale})`
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
                {loading ? "Thinking..." : "Ask AI to respond"}
              </button>
            </div>
          ) : null}
        </div>

        {cursorPoint && tool === "draw" ? (
          <div
            className="draw-pen-cursor"
            style={{ left: cursorPoint.x, top: cursorPoint.y }}
          >
            <PenCursorIcon style={{ color: strokeColor }} className="draw-pen-cursor__icon" />
          </div>
        ) : null}

      </div>
    );
  }
);
