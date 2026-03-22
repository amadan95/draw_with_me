"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthControls } from "@/components/draw/auth-controls";
import { DrawCanvas, type DrawCanvasHandle } from "@/components/draw/draw-canvas";
import { Header } from "@/components/draw/header";
import { TwinkleClusterIcon } from "@/components/draw/twinkle-cluster-icon";
import { useDrawStore } from "@/lib/draw-store";
import {
  type DrawStreamEvent,
  type DrawingElement,
  type Point,
  createId,
  getPalette,
} from "@/lib/draw-types";
import {
  getCanvasHumanContext,
  getRecentAiContext,
  parseNdjsonStream,
  translateAiContext,
  translateComments,
  translateHumanContext
} from "@/lib/draw-utils";

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const strokeSteps = [3, 6, 12] as const;

function getStrokeMeasurements(points: Point[]) {
  const cumulativeDistances = [0];
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    totalLength += Math.hypot(current.x - previous.x, current.y - previous.y);
    cumulativeDistances.push(totalLength);
  }

  return {
    cumulativeDistances,
    totalLength
  };
}

function interpolatePoint(start: Point, end: Point, t: number): Point {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t
  };
}

function getSegmentAngle(start: Point, end: Point) {
  return Math.atan2(end.y - start.y, end.x - start.x) * (180 / Math.PI);
}

function sampleStrokeAtDistance(
  points: Point[],
  cumulativeDistances: number[],
  travelDistance: number
) {
  if (points.length < 2) {
    return {
      partialPoints: points,
      angle: -10
    };
  }

  const totalLength = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
  const clampedDistance = Math.max(0, Math.min(totalLength, travelDistance));
  const partialPoints: Point[] = [points[0]];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentStart = cumulativeDistances[index - 1] ?? 0;
    const segmentEnd = cumulativeDistances[index] ?? segmentStart;

    if (clampedDistance >= segmentEnd) {
      partialPoints.push(current);
      continue;
    }

    const segmentLength = segmentEnd - segmentStart;
    const segmentProgress =
      segmentLength <= 0 ? 1 : (clampedDistance - segmentStart) / segmentLength;
    partialPoints.push(interpolatePoint(previous, current, segmentProgress));

    return {
      partialPoints,
      angle: getSegmentAngle(previous, current)
    };
  }

  return {
    partialPoints: points,
    angle: getSegmentAngle(points[points.length - 2], points[points.length - 1])
  };
}

function easeInOutSine(progress: number) {
  return -(Math.cos(Math.PI * progress) - 1) * 0.5;
}

export function DrawApp() {
  const canvasRef = useRef<DrawCanvasHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const animationChainRef = useRef<Promise<void>>(Promise.resolve());
  const [ephemeralElement, setEphemeralElement] = useState<DrawingElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageBanner, setUsageBanner] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const auth = hasClerk ? useAuth() : null;
  const isSignedIn = auth?.isSignedIn ?? false;

  const {
    elements,
    comments,
    turnHistory,
    tool,
    strokeSize,
    paletteIndex,
    strokeColor,
    aiTemperature,
    aiMaxOutputTokens,
    backgroundMode,
    currentStroke,
    turnState,
    showThinkingPanel,
    thinkingText,
    thinkingMessages,
    narration,
    aiSummary,
    activeCommentId,
    commentComposer,
    usage,
    setTool,
    setStrokeSize,
    setPaletteIndex,
    setStrokeColor,
    setAiTemperature,
    setAiMaxOutputTokens,
    cyclePalette,
    setTurnState,
    setThinkingText,
    clearThinkingMessages,
    setNarration,
    setAiSummary,
    setShowThinkingPanel,
    setActiveCommentId,
    setUsage,
    beginStroke,
    appendStrokePoint,
    commitStroke,
    cancelStroke,
    stampAscii,
    openCommentComposer,
    updateCommentComposer,
    closeCommentComposer,
    submitCommentComposer,
    appendCommentReply,
    addAiElement,
    addHistoryEntry,
    checkpointAiState,
    clearBoard
  } = useDrawStore();

  const palette = useMemo(() => getPalette(paletteIndex), [paletteIndex]);
  const visibleHistory = useMemo(
    () =>
      turnHistory.filter(
        (entry) =>
          !(
            entry.role === "user" &&
            (entry.summary === "Added a freehand stroke." ||
              entry.summary === "Erased part of the page.")
          )
      ),
    [turnHistory]
  );
  const isLoading =
    turnState === "awaitingModel" ||
    turnState === "modelStreaming" ||
    turnState === "modelAnimating";

  const translateSnapshotEvent = (
    event: DrawStreamEvent,
    originX: number,
    originY: number
  ): DrawStreamEvent => {
    switch (event.type) {
      case "stroke":
        return {
          ...event,
          stroke: {
            ...event.stroke,
            points: event.stroke.points.map((point) => ({
              ...point,
              x: point.x + originX,
              y: point.y + originY
            }))
          }
        };
      case "shape":
        return {
          ...event,
          shape: {
            ...event.shape,
            x: event.shape.x + originX,
            y: event.shape.y + originY
          }
        };
      case "ascii_block":
        return {
          ...event,
          block: {
            ...event.block,
            x: event.block.x + originX,
            y: event.block.y + originY
          }
        };
      default:
        return event;
    }
  };

  const queueAnimation = (event: DrawStreamEvent) => {
    animationChainRef.current = animationChainRef.current.then(async () => {
      setTurnState("modelAnimating");

      switch (event.type) {
        case "stroke": {
          const fullStroke = event.stroke;
          const strokeSpeed = Math.min(
            1.25,
            Math.max(0.2, fullStroke.timing?.speed ?? 0.65)
          );
          const { cumulativeDistances, totalLength } = getStrokeMeasurements(fullStroke.points);
          const pixelsPerSecond = 95 + strokeSpeed * 110;
          const minimumDuration = totalLength < 56 ? 420 : 620;
          const totalDuration = Math.max(
            minimumDuration,
            Math.min(4200, Math.round((totalLength / pixelsPerSecond) * 1000))
          );

          await new Promise<void>((resolve) => {
            const startTime = performance.now();

            const animateStroke = (now: number) => {
              const rawProgress = Math.min(1, (now - startTime) / totalDuration);
              const easedProgress = easeInOutSine(rawProgress);
              const { partialPoints } = sampleStrokeAtDistance(
                fullStroke.points,
                cumulativeDistances,
                totalLength * easedProgress
              );

              setEphemeralElement({
                ...fullStroke,
                points: partialPoints
              });

              if (rawProgress < 1) {
                window.requestAnimationFrame(animateStroke);
                return;
              }

              resolve();
            };

            window.requestAnimationFrame(animateStroke);
          });

          setEphemeralElement(fullStroke);
          await new Promise((resolve) => setTimeout(resolve, 42));
          setEphemeralElement(null);
          addAiElement(fullStroke);
          if (fullStroke.timing?.pauseAfterMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, fullStroke.timing?.pauseAfterMs)
            );
          }
          break;
        }
        case "shape":
          setEphemeralElement({
            ...event.shape,
            width: event.shape.width * 0.35,
            height: event.shape.height * 0.35
          });
          await new Promise((resolve) => setTimeout(resolve, 80));
          setEphemeralElement(null);
          addAiElement(event.shape);
          break;
        case "ascii_block": {
          const lines = event.block.text.split("\n");
          let currentText = "";
          for (const line of lines) {
            currentText += `${currentText ? "\n" : ""}${line}`;
            setEphemeralElement({
              ...event.block,
              text: currentText
            });
            await new Promise((resolve) => setTimeout(resolve, 55));
          }
          setEphemeralElement(null);
          addAiElement(event.block);
          break;
        }
        case "comment_reply":
          appendCommentReply(event.commentId, event.text);
          break;
        case "set_palette":
          setPaletteIndex(event.index);
          break;
        default:
          break;
      }
    });
  };

  const finalizeTurn = (summary: string, nextUsage?: { used: number; limit: number }) => {
    animationChainRef.current = animationChainRef.current.then(async () => {
      setAiSummary(summary);
      addHistoryEntry({
        id: createId("turn"),
        role: "ai",
        summary,
        createdAt: Date.now()
      });
      checkpointAiState();
      setUsage(nextUsage ?? usage);
      setTurnState("idle");
      setEphemeralElement(null);
    });
  };

  const handleResponse = async (
    response: Response,
    snapshotOrigin: { x: number; y: number }
  ) => {
    if (!response.ok || !response.body) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; usage?: { used: number; limit: number } }
        | null;

      if (response.status === 429 && payload?.usage) {
        setUsage(payload.usage);
        setUsageBanner(`Daily quota reached: ${payload.usage.used}/${payload.usage.limit}`);
      }

      throw new Error(payload?.error ?? `Request failed with ${response.status}`);
    }

    setTurnState("modelStreaming");
    await parseNdjsonStream<DrawStreamEvent>(response.body, async (event) => {
      const translatedEvent = translateSnapshotEvent(
        event,
        snapshotOrigin.x,
        snapshotOrigin.y
      );

      switch (translatedEvent.type) {
        case "thinking":
          setThinkingText(translatedEvent.text);
          break;
        case "say":
          setNarration(translatedEvent.text);
          break;
        case "stroke":
        case "shape":
        case "ascii_block":
        case "comment_reply":
        case "set_palette":
          queueAnimation(translatedEvent);
          break;
        case "done":
          finalizeTurn(translatedEvent.summary, translatedEvent.usage);
          break;
        case "error":
          setTurnState("idle");
          setErrorMessage(translatedEvent.message);
          break;
      }
    });
  };

  const sendTurn = async (targetCommentId?: string) => {
    setErrorMessage(null);
    setUsageBanner(null);

    if (hasClerk && !isSignedIn) {
      setErrorMessage("Sign in to send an AI turn.");
      return;
    }

    const snapshot = canvasRef.current?.captureSnapshot({
      maxWidth: 640,
      maxHeight: 400,
      mimeType: "image/jpeg",
      quality: 0.72
    });
    const metrics = canvasRef.current?.getCanvasMetrics();
    if (!snapshot || !metrics) {
      setErrorMessage("Canvas export is not ready yet.");
      return;
    }

    setTurnState("awaitingModel");
    clearThinkingMessages();
    setThinkingText("");
    setAiSummary(null);
    setNarration("");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(
        targetCommentId ? "/api/draw/comment" : "/api/draw/turn",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            snapshotBase64: snapshot,
            canvasWidth: metrics.width,
            canvasHeight: metrics.height,
            activeStrokeSize: strokeSize,
            palette,
            aiTemperature,
            aiMaxOutputTokens,
            humanDelta: translateHumanContext(
              getCanvasHumanContext(elements, 24),
              metrics.originX,
              metrics.originY
            ),
            aiDelta: translateAiContext(
              getRecentAiContext(elements, 4),
              metrics.originX,
              metrics.originY
            ),
            comments: translateComments(
              comments,
              metrics.originX,
              metrics.originY
            ),
            turnHistory: turnHistory.slice(-8),
            mode: targetCommentId ? "comment" : "turn",
            targetCommentId
          }),
          signal: controller.signal
        }
      );

      await handleResponse(response, {
        x: metrics.originX,
        y: metrics.originY
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setAiSummary("Stopped the turn.");
        setTurnState("idle");
        return;
      }

      setErrorMessage(
        error instanceof Error ? error.message : "Failed to stream the turn."
      );
      setTurnState("idle");
    }
  };

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInput(event.target)) {
        return;
      }

      if (event.code === "Space") {
        if (!event.repeat) {
          event.preventDefault();
          if (!isLoading) {
            void sendTurn();
          }
        }
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "p") {
        setTool("draw");
        setStrokeSize(3);
      } else if (key === "b") {
        setTool("draw");
        setStrokeSize(Math.max(6, strokeSize));
      } else if (key === "e") {
        setTool("erase");
      } else if (key === "t") {
        setTool("ascii");
      } else if (key === "c") {
        setTool("comment");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isLoading, sendTurn, setStrokeSize, setTool, strokeSize]);

  const stopTurn = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurnState("idle");
    setEphemeralElement(null);
  };

  const handlePrimaryAction = () => {
    if (isLoading) {
      stopTurn();
      return;
    }

    void sendTurn();
  };

  return (
    <main className="draw-page-shell">
      <section className="draw-main draw-main--fullscreen">
        <div className="draw-stage draw-stage--fullscreen">
          <Header
            turnState={turnState}
            clearCanvas={clearBoard}
            thinkingMessages={thinkingMessages}
            aiSummary={aiSummary}
            setAiSummary={setAiSummary}
            onToggleSettings={() => setSettingsOpen((open) => !open)}
            settingsOpen={settingsOpen}
            onBack={() => {
              window.location.href = "/";
            }}
          />

          {hasClerk ? (
            <div className="pointer-events-none fixed right-4 top-20 z-[55]">
              <div className="pointer-events-auto">
                <AuthControls />
              </div>
            </div>
          ) : null}

          <DrawCanvas
            ref={canvasRef}
            elements={elements}
            currentStroke={currentStroke}
            ephemeralElement={ephemeralElement}
            comments={comments}
            activeCommentId={activeCommentId}
            commentComposer={commentComposer}
            tool={tool}
            strokeColor={strokeColor}
            backgroundMode={backgroundMode}
            loading={isLoading}
            narration={narration}
            onStartStroke={beginStroke}
            onMoveStroke={appendStrokePoint}
            onEndStroke={() => {
              commitStroke();
            }}
            onStampAscii={stampAscii}
            onPlaceComment={(point) => openCommentComposer(point.x, point.y)}
            onSelectComment={setActiveCommentId}
            onCommentComposerChange={updateCommentComposer}
            onCommentComposerSubmit={() => {
              submitCommentComposer();
            }}
            onCommentComposerClose={closeCommentComposer}
            onAskAiAboutComment={(commentId) => sendTurn(commentId)}
          />

          {showThinkingPanel ? (
            <aside className="draw-thinking-float">
              <div className="draw-thinking-float-head">
                <span>thinking</span>
                <button
                  type="button"
                  className="draw-inline-close"
                  onClick={() => setShowThinkingPanel(false)}
                >
                  hide
                </button>
              </div>
              <p className="draw-thinking-float-text">
                {thinkingText ||
                  "When the model streams, its planning text appears here before marks land on the page."}
              </p>
              <div className="draw-thinking-float-history">
                {visibleHistory.slice(-3).map((entry) => (
                  <div
                    key={entry.id}
                    className={`draw-history-item draw-history-item--${entry.role}`}
                  >
                    <strong>{entry.role === "ai" ? "AI" : "You"}</strong>
                    <p>{entry.summary}</p>
                  </div>
                ))}
              </div>
            </aside>
          ) : null}

          {settingsOpen ? (
            <div className="draw-settings-popover">
                <div className="draw-settings-popover__head">
                  <strong>Generation</strong>
                  <button
                    type="button"
                    className="draw-settings-popover__toggle"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    hide
                  </button>
                </div>

                <label className="draw-slider-field">
                  <span>
                    Temperature
                    <em>{aiTemperature.toFixed(2)}</em>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={aiTemperature}
                    onChange={(event) =>
                      setAiTemperature(Number(event.currentTarget.value))
                    }
                  />
                </label>

                <label className="draw-slider-field">
                  <span>
                    Output Tokens
                    <em>{aiMaxOutputTokens}</em>
                  </span>
                  <input
                    type="range"
                    min="512"
                    max="8192"
                    step="256"
                    value={aiMaxOutputTokens}
                    onChange={(event) =>
                      setAiMaxOutputTokens(Number(event.currentTarget.value))
                    }
                  />
                </label>
            </div>
          ) : null}

          <div className="draw-dock">
            <div className="draw-dock-top">
              <div className="draw-tool-cluster">
                <button
                  className={`draw-dock-tool draw-dock-tool--pencil${
                    tool === "draw" ? " is-active" : ""
                  }`}
                  type="button"
                  onClick={() => {
                    setTool("draw");
                    setStrokeSize(3);
                  }}
                  aria-label="Pencil tool"
                  title="Pencil tool"
                >
                  <span className="draw-tool-sticker" aria-hidden="true">
                    <img
                      className="draw-tool-sticker__asset draw-tool-sticker__asset--pencil"
                      src="/toolbar-pencil.svg"
                      alt=""
                    />
                  </span>
                </button>
                <button
                  className={`draw-dock-tool draw-dock-tool--eraser${
                    tool === "erase" ? " is-active" : ""
                  }`}
                  type="button"
                  onClick={() => {
                    setTool("erase");
                  }}
                  aria-label="Eraser tool"
                  title="Eraser tool"
                >
                  <span className="draw-tool-sticker draw-tool-sticker--eraser" aria-hidden="true">
                    <img
                      className="draw-tool-sticker__asset draw-tool-sticker__asset--eraser"
                      src="/toolbar-eraser.svg"
                      alt=""
                    />
                  </span>
                </button>
              </div>

              <div className="draw-dock-divider" aria-hidden="true" />

              <div className="draw-palette draw-palette--dock">
                {palette.map((color, index) => (
                  <button
                    key={`${color}-${index}`}
                    className={`draw-palette-chip${
                      strokeColor === color ? " is-active" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    type="button"
                    onClick={() => setStrokeColor(color)}
                  />
                ))}
              </div>

              <button className="draw-dice-button" type="button" onClick={cyclePalette}>
                <span className="draw-tool-sticker draw-tool-sticker--dice" aria-hidden="true">
                  <img
                    className="draw-tool-sticker__asset draw-tool-sticker__asset--dice"
                    src="/toolbar-dice.svg"
                    alt=""
                  />
                </span>
              </button>

              <div className="draw-dock-divider" aria-hidden="true" />

              <div className="draw-size-picker" aria-label="Line size">
                {strokeSteps.map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={`draw-size-chip${strokeSize === size ? " is-active" : ""}`}
                    onClick={() => setStrokeSize(size)}
                    aria-label={`Line size ${size}`}
                    title={`Line size ${size}`}
                  >
                    <span
                      className="draw-size-dot"
                      style={{
                        width: size + 6,
                        height: size + 6
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div className="draw-dock-bottom">
              <button
                className={`draw-send-button${isLoading ? " is-loading" : ""}`}
                type="button"
                disabled={false}
                onClick={handlePrimaryAction}
                aria-keyshortcuts="Space"
              >
                <span className="draw-send-button__icon" aria-hidden="true">
                  <TwinkleClusterIcon className="draw-send-button__twinkle" />
                </span>
                <strong>{isLoading ? "Thinking..." : "Send to Gemini"}</strong>
              </button>
            </div>
          </div>

          {usage ? (
            <div className="draw-usage-float">
              <span>
                daily {usage.used}/{usage.limit}
              </span>
            </div>
          ) : null}
          {errorMessage ? <div className="draw-error-toast">{errorMessage}</div> : null}
          {usageBanner ? <div className="draw-inline-alert draw-inline-alert--floating">{usageBanner}</div> : null}
        </div>
      </section>
    </main>
  );
}
