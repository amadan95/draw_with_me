"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  Download,
  Loader2,
  Settings2,
  Smile,
  Trash2
} from "lucide-react";
import { type TurnState } from "@/lib/draw-types";

const fallbackMessages = [
  "Mixing the colors...",
  "Sharpening pencils...",
  "Looking at your drawing...",
  "Finding the right angle...",
  "Thinking about composition...",
  "Adding a touch of magic...",
  "Almost there..."
] as const;

type HeaderProps = {
  turnState: TurnState;
  clearCanvas: () => void;
  thinkingText: string;
  previewSaw: string;
  previewDrawing: string;
  aiSummary: string | null;
  aiSource?: "gemini" | "fallback-provider-error" | "fallback-parse-error" | null;
  debugInfo?: { hasFocusImage: boolean; turnMode: "turn" | "comment" | null };
  setAiSummary: (value: string | null) => void;
  onToggleSettings?: () => void;
  settingsOpen?: boolean;
  onBack?: () => void;
};

export function Header({
  turnState,
  clearCanvas,
  thinkingText,
  previewSaw,
  previewDrawing,
  aiSummary,
  aiSource,
  debugInfo,
  setAiSummary,
  onToggleSettings,
  settingsOpen = false,
  onBack
}: HeaderProps) {
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const [isMessageExpanded, setIsMessageExpanded] = useState(false);
  const messageShellRef = useRef<HTMLDivElement | null>(null);
  const messageRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (turnState === "awaitingModel") {
      setAiSummary(null);
    }
  }, [setAiSummary, turnState]);

  useEffect(() => {
    const isLoading =
      turnState === "awaitingModel" || turnState === "modelStreaming";

    if (!isLoading) {
      setFallbackIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setFallbackIndex((current) => (current + 1) % fallbackMessages.length);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [turnState]);

  const message = useMemo(() => {
    if (
      turnState === "idle" ||
      turnState === "humanDrawing" ||
      turnState === "commenting"
    ) {
      return aiSummary ?? "Ready when you are :)";
    }

    return thinkingText || previewDrawing || previewSaw || fallbackMessages[fallbackIndex];
  }, [aiSummary, fallbackIndex, previewDrawing, previewSaw, thinkingText, turnState]);

  const isLoading =
    turnState === "awaitingModel" ||
    turnState === "modelStreaming" ||
    turnState === "modelAnimating";

  useEffect(() => {
    setIsMessageExpanded(false);

    let timeoutId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      const shell = messageShellRef.current;
      const text = messageRef.current;
      if (!shell || !text) {
        return;
      }

      const isOverflowing = text.scrollWidth > shell.clientWidth + 4;
      if (!isOverflowing) {
        return;
      }

      setIsMessageExpanded(true);
      timeoutId = window.setTimeout(() => {
        setIsMessageExpanded(false);
      }, 3600);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [message]);

  const handleDownload = () => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "draw-with-ai.png";
    link.click();
  };

  return (
    <motion.header
      className="draw-app-header"
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
    >
      <div className="draw-app-header__inner">
        <div className="draw-app-header__left">
          <button
            className="draw-app-header__button"
            type="button"
            onClick={onBack}
            title="Back"
            aria-label="Back"
          >
            <ChevronLeft className="draw-app-header__icon" strokeWidth={2.2} />
          </button>
        </div>

        <div className="draw-app-header__center">
          <div
            className={`draw-app-header__pill${isMessageExpanded ? " is-expanded" : ""}`}
            title={message}
          >
            <div className="draw-app-header__status-icon">
              {isLoading ? (
                <Loader2
                  className="draw-app-header__status-spinner"
                  strokeWidth={2.2}
                />
              ) : (
                <Smile className="draw-app-header__status-idle" strokeWidth={2.2} />
              )}
            </div>

            <div
              ref={messageShellRef}
              className="draw-app-header__message-shell"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  ref={messageRef}
                  key={message}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="draw-app-header__message"
                >
                  {message}
                </motion.span>
              </AnimatePresence>
            </div>
            {aiSource ? (
              <span className="draw-app-header__source-tag">
                {aiSource === "gemini"
                  ? "gemini"
                  : aiSource === "fallback-parse-error"
                    ? "fallback: parse"
                    : "fallback: provider"}
              </span>
            ) : null}
            {debugInfo ? (
              <span className="draw-app-header__source-tag draw-app-header__source-tag--muted">
                {debugInfo.turnMode ?? "-"} · {debugInfo.hasFocusImage ? "focus" : "no-focus"}
              </span>
            ) : null}
          </div>
        </div>

        <div className="draw-app-header__right">
          <button
            className="draw-app-header__button"
            type="button"
            onClick={clearCanvas}
            title="Clear canvas"
            aria-label="Clear canvas"
          >
            <Trash2 className="draw-app-header__icon" strokeWidth={2.1} />
          </button>
          <button
            className="draw-app-header__button"
            type="button"
            onClick={handleDownload}
            title="Download"
            aria-label="Download"
          >
            <Download className="draw-app-header__icon" strokeWidth={2.1} />
          </button>
          {onToggleSettings ? (
            <button
              className={`draw-app-header__button${settingsOpen ? " is-active" : ""}`}
              type="button"
              onClick={onToggleSettings}
              title="Settings"
              aria-label="Settings"
            >
              <Settings2 className="draw-app-header__icon" strokeWidth={2.1} />
            </button>
          ) : null}
        </div>
      </div>
    </motion.header>
  );
}
