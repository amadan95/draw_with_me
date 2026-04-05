"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthControls } from "@/components/draw/auth-controls";
import { DrawCanvas, type DrawCanvasHandle } from "@/components/draw/draw-canvas";
import { Header } from "@/components/draw/header";
import { TwinkleClusterIcon } from "@/components/draw/twinkle-cluster-icon";
import {
  animateBlockReveal,
  animateCursorGlide,
  animateCursorTrace,
  getCursorHoverPoint,
  getCursorStartPoint,
  sleep,
  type AnimatedVisual
} from "@/lib/draw/animation";
import { computeDrawingDiff, diffHasChanges } from "@/lib/draw/diff";
import { parseNdjsonStream, translateStreamEvent } from "@/lib/draw/parsing";
import { buildAiTurnHistoryEntry, getCurrentSyncState, useDrawStore } from "@/lib/draw-store";
import {
  type PersistedShapeElement,
  type Point,
  type DrawStreamEvent,
  getPalette
} from "@/lib/draw-types";

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const strokeSteps = [3, 6, 12] as const;

export function DrawApp() {
  const canvasRef = useRef<DrawCanvasHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const animationChainRef = useRef<Promise<void>>(Promise.resolve());
  const aiCursorRef = useRef<Point>({ x: 120, y: 120 });
  const [activeAnimation, setActiveAnimation] = useState<AnimatedVisual | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [usageBanner, setUsageBanner] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const auth = hasClerk ? useAuth() : null;
  const isSignedIn = auth?.isSignedIn ?? false;

  const {
    humanStrokes,
    currentStroke,
    drawingElements,
    asciiBlocks,
    comments,
    turnHistory,
    turnCount,
    tool,
    strokeSize,
    paletteIndex,
    strokeColor,
    aiTemperature,
    aiMaxOutputTokens,
    backgroundMode,
    turnState,
    thinkingText,
    narration,
    previewSaw,
    previewDrawing,
    aiSummary,
    activeCommentId,
    commentComposer,
    sessionUsage,
    aiCursor,
    speechDraft,
    lastSyncedState,
    aiSource,
    debugInfo,
    setTool,
    setStrokeSize,
    setPaletteIndex,
    setStrokeColor,
    setAiTemperature,
    setAiMaxOutputTokens,
    cyclePalette,
    setThinkingText,
    setNarration,
    setPreviewSaw,
    setPreviewDrawing,
    setAiSummary,
    setActiveCommentId,
    setSessionUsage,
    setInteractionStyle,
    setAiCursor,
    clearAiCursor,
    setSpeechDraft,
    appendSpeechDraft,
    clearSpeechDraft,
    setAiSource,
    setDebugInfo,
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
    dismissCommentThread,
    beginModelRequest,
    beginModelStreaming,
    beginModelAnimating,
    completeModelTurn,
    failTurn,
    addHistoryEntry,
    commitAiShape,
    commitAiBlock,
    markSyncedState,
    clearBoard
  } = useDrawStore();

  const palette = useMemo(() => getPalette(paletteIndex), [paletteIndex]);
  const isLoading =
    turnState === "awaitingModel" ||
    turnState === "modelStreaming" ||
    turnState === "modelAnimating";

  const syncState = useMemo(
    () => ({
      humanStrokes,
      drawingElements,
      asciiBlocks
    }),
    [asciiBlocks, drawingElements, humanStrokes]
  );

  const updateAiCursor = (point: Point, phase: typeof aiCursor.phase, color?: string) => {
    aiCursorRef.current = point;
    setAiCursor({
      visible: true,
      phase,
      x: point.x,
      y: point.y,
      color
    });
  };

  const animateShapeEvent = async (element: PersistedShapeElement) => {
    const color =
      "stroke" in element.shape
        ? element.shape.stroke ?? palette[0]
        : palette[0];

    beginModelAnimating();
    const startPoint = getCursorStartPoint(element);
    await animateCursorGlide({
      from: aiCursorRef.current,
      to: startPoint,
      onUpdate: (update) => updateAiCursor(update.point, update.phase, color)
    });
    await animateCursorTrace({
      element,
      onFrame: (visual, update) => {
        setActiveAnimation(visual);
        updateAiCursor(update.point, update.phase, color);
      }
    });
    setActiveAnimation(null);
    commitAiShape(element);
    updateAiCursor(getCursorHoverPoint(element), "settling", color);
    await sleep(80);
  };

  const animateBlockEvent = async (block: typeof asciiBlocks[number]) => {
    beginModelAnimating();
    await animateCursorGlide({
      from: aiCursorRef.current,
      to: { x: block.x, y: block.y },
      onUpdate: (update) => updateAiCursor(update.point, update.phase, block.color)
    });
    await animateBlockReveal({
      block,
      onFrame: (visual, update) => {
        setActiveAnimation(visual);
        updateAiCursor(update.point, update.phase, block.color);
      }
    });
    setActiveAnimation(null);
    commitAiBlock(block);
    updateAiCursor({ x: block.x, y: block.y }, "settling", block.color);
    await sleep(66);
  };

  const queueAnimation = (event: DrawStreamEvent) => {
    animationChainRef.current = animationChainRef.current.then(async () => {
      switch (event.type) {
        case "shape":
          await animateShapeEvent(event.shape);
          break;
        case "block":
          await animateBlockEvent(event.block);
          break;
        default:
          break;
      }
    });
  };

  const finalizeTurn = (summary: string, usage?: typeof sessionUsage) => {
    animationChainRef.current = animationChainRef.current.then(async () => {
      const currentUsage = useDrawStore.getState().sessionUsage;
      setAiSummary(summary);
      addHistoryEntry(buildAiTurnHistoryEntry(summary));
      markSyncedState(getCurrentSyncState());
      setSessionUsage({
        ...(currentUsage ?? {}),
        ...(usage ?? {})
      });
      completeModelTurn(summary);
      setActiveAnimation(null);
      await sleep(120);
      clearAiCursor();
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
        setSessionUsage(payload.usage);
        setUsageBanner(`Daily quota reached: ${payload.usage.used}/${payload.usage.limit}`);
      }

      throw new Error(payload?.error ?? `Request failed with ${response.status}`);
    }

    beginModelStreaming();
    await parseNdjsonStream(response.body, async (incomingEvent) => {
      const event = translateStreamEvent(
        incomingEvent,
        snapshotOrigin.x,
        snapshotOrigin.y
      );

      switch (event.type) {
        case "thinking":
          setThinkingText(event.text);
          break;
        case "narration":
          setNarration(event.text);
          break;
        case "preview_saw":
          setPreviewSaw(event.saw);
          break;
        case "preview_drawing":
          setPreviewDrawing(event.drawing);
          break;
        case "interaction_style":
          setInteractionStyle(event.style);
          break;
        case "set_palette":
          setPaletteIndex(event.index);
          break;
        case "say_start":
          setSpeechDraft({
            text: "",
            x: event.sayX,
            y: event.sayY,
            replyToId: event.replyToId
          });
          if (typeof event.sayX === "number" && typeof event.sayY === "number") {
            updateAiCursor(
              { x: event.sayX, y: event.sayY },
              "speaking",
              palette[1]
            );
          }
          break;
        case "say_chunk":
          appendSpeechDraft(event.text);
          break;
        case "say":
          setSpeechDraft({
            text: event.text,
            x: event.sayX,
            y: event.sayY,
            replyToId: event.replyToId
          });
          setNarration(event.text);
          if (event.replyToId) {
            appendCommentReply(event.replyToId, event.text);
            setActiveCommentId(event.replyToId);
          }
          break;
        case "dismiss":
          clearSpeechDraft();
          dismissCommentThread(event.threadId);
          break;
        case "shape":
        case "block":
          queueAnimation(event);
          break;
        case "source":
          setAiSource(event.value);
          break;
        case "usage":
          {
            const currentUsage = useDrawStore.getState().sessionUsage;
          setSessionUsage({
            ...(currentUsage ?? {}),
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens
          });
          }
          break;
        case "done":
          finalizeTurn(event.summary, event.usage);
          break;
        case "error":
          failTurn();
          setErrorMessage(event.message);
          clearAiCursor();
          setActiveAnimation(null);
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

    const metrics = canvasRef.current?.getCanvasMetrics();
    if (!canvasRef.current || !metrics) {
      setErrorMessage("Canvas export is not ready yet.");
      return;
    }

    beginModelRequest();
    clearSpeechDraft();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    updateAiCursor(
      {
        x: metrics.originX + metrics.width * 0.16,
        y: metrics.originY + metrics.height * 0.18
      },
      "watching",
      palette[1]
    );

    try {
      const [snapshot, focusImage] = await Promise.all([
        canvasRef.current.captureSnapshot({
          maxWidth: 1280,
          maxHeight: 896,
          mimeType: "image/jpeg",
          quality: 0.9
        }),
        canvasRef.current.captureFocusSnapshot({
          maxWidth: 1024,
          maxHeight: 1024,
          mimeType: "image/jpeg",
          quality: 0.92,
          padding: 96
        })
      ]);

      const shouldSendFullState =
        !lastSyncedState || turnCount === 0 || turnCount % 3 === 0;
      const diff = computeDrawingDiff(lastSyncedState, syncState);

      setDebugInfo({
        hasFocusImage: Boolean(focusImage),
        turnMode: targetCommentId ? "comment" : "turn"
      });

      const response = await fetch(
        targetCommentId ? "/api/draw/comment" : "/api/draw/turn",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            image: snapshot,
            focusImage,
            canvasWidth: metrics.width,
            canvasHeight: metrics.height,
            history: turnHistory.slice(-12),
            comments,
            elements: shouldSendFullState ? syncState : undefined,
            diff: !shouldSendFullState && diffHasChanges(diff) ? diff : undefined,
            turnCount,
            drawMode: targetCommentId ? "comment" : "turn",
            paletteColors: palette,
            paletteIndex,
            thinkingEnabled: true,
            targetCommentId,
            providerOptions: {
              temperature: aiTemperature,
              maxOutputTokens: aiMaxOutputTokens
            }
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
        completeModelTurn("Stopped the turn.", { incrementTurnCount: false });
        clearAiCursor();
        setActiveAnimation(null);
        return;
      }

      failTurn();
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to stream the turn."
      );
      clearAiCursor();
      setActiveAnimation(null);
    }
  };

  useEffect(() => {
    const isTextInput = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return tagName === "input" || tagName === "textarea" || target.isContentEditable;
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
  }, [isLoading, setStrokeSize, setTool, strokeSize]);

  const stopTurn = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    completeModelTurn("Stopped the turn.", { incrementTurnCount: false });
    clearAiCursor();
    clearSpeechDraft();
    setActiveAnimation(null);
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
            thinkingText={thinkingText}
            previewSaw={previewSaw}
            previewDrawing={previewDrawing}
            aiSummary={aiSummary}
            aiSource={aiSource}
            debugInfo={debugInfo}
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
            humanStrokes={humanStrokes}
            currentStroke={currentStroke}
            drawingElements={drawingElements}
            asciiBlocks={asciiBlocks}
            activeAnimation={activeAnimation}
            comments={comments}
            activeCommentId={activeCommentId}
            commentComposer={commentComposer}
            speechDraft={speechDraft}
            aiCursor={aiCursor}
            tool={tool}
            strokeColor={strokeColor}
            backgroundMode={backgroundMode}
            loading={isLoading}
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
            onAskAiAboutComment={(commentId) => void sendTurn(commentId)}
          />

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
                  min="256"
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
                <strong>{isLoading ? "Stop turn" : "Send collaborator turn"}</strong>
              </button>
            </div>
          </div>

          {sessionUsage ? (
            <div className="draw-usage-float">
              <span>
                {sessionUsage.used && sessionUsage.limit
                  ? `daily ${sessionUsage.used}/${sessionUsage.limit}`
                  : "session"}
              </span>
              {sessionUsage.inputTokens || sessionUsage.outputTokens ? (
                <strong>
                  {sessionUsage.inputTokens ?? 0}/{sessionUsage.outputTokens ?? 0} tok
                </strong>
              ) : null}
            </div>
          ) : null}
          {errorMessage ? <div className="draw-error-toast">{errorMessage}</div> : null}
          {usageBanner ? (
            <div className="draw-inline-alert draw-inline-alert--floating">{usageBanner}</div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
