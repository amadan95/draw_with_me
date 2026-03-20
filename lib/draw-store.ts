"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type AsciiBlock,
  type CanvasBackground,
  type CommentPin,
  type DrawingElement,
  type HumanStroke,
  type Palette,
  type Point,
  type ToolMode,
  type TurnState,
  type TurnSummary,
  createId,
  getPalette
} from "@/lib/draw-types";

const PAPER_COLOR = "#faf9f7";

type CommentComposer = {
  x: number;
  y: number;
  text: string;
} | null;

type UsageState = {
  used: number;
  limit: number;
} | null;

type DrawStore = {
  elements: DrawingElement[];
  comments: CommentPin[];
  turnHistory: TurnSummary[];
  tool: ToolMode;
  strokeSize: number;
  paletteIndex: number;
  strokeColor: string;
  backgroundMode: CanvasBackground;
  turnState: TurnState;
  currentStroke: HumanStroke | null;
  currentAsciiGhost: { x: number; y: number } | null;
  showThinkingPanel: boolean;
  thinkingText: string;
  thinkingMessages: string[];
  narration: string;
  aiSummary: string | null;
  exportOpen: boolean;
  activeCommentId: string | null;
  commentComposer: CommentComposer;
  lastAiElementIndex: number;
  usage: UsageState;
  setTool: (tool: ToolMode) => void;
  setStrokeSize: (size: number) => void;
  setPaletteIndex: (index: number) => void;
  setStrokeColor: (color: string) => void;
  cyclePalette: () => void;
  setBackgroundMode: (mode: CanvasBackground) => void;
  setTurnState: (state: TurnState) => void;
  setThinkingText: (text: string) => void;
  clearThinkingMessages: () => void;
  setNarration: (text: string) => void;
  setAiSummary: (text: string | null) => void;
  setExportOpen: (open: boolean) => void;
  setShowThinkingPanel: (open: boolean) => void;
  setActiveCommentId: (id: string | null) => void;
  setUsage: (usage: UsageState) => void;
  beginStroke: (point: Point) => void;
  appendStrokePoint: (point: Point) => void;
  commitStroke: () => HumanStroke | null;
  cancelStroke: () => void;
  setAsciiGhost: (ghost: { x: number; y: number } | null) => void;
  stampAscii: (point: Point, text?: string) => AsciiBlock;
  openCommentComposer: (x: number, y: number) => void;
  updateCommentComposer: (text: string) => void;
  closeCommentComposer: () => void;
  submitCommentComposer: () => CommentPin | null;
  appendCommentReply: (commentId: string, text: string) => void;
  addAiElement: (element: DrawingElement) => void;
  addHistoryEntry: (entry: TurnSummary) => void;
  checkpointAiState: () => void;
  clearBoard: () => void;
};

const initialState = {
  elements: [] as DrawingElement[],
  comments: [] as CommentPin[],
  turnHistory: [] as TurnSummary[],
  tool: "draw" as ToolMode,
  strokeSize: 6,
  paletteIndex: 0,
  strokeColor: getPalette(0)[0],
  backgroundMode: "dots" as CanvasBackground,
  turnState: "idle" as TurnState,
  currentStroke: null as HumanStroke | null,
  currentAsciiGhost: null as { x: number; y: number } | null,
  showThinkingPanel: true,
  thinkingText: "",
  thinkingMessages: [] as string[],
  narration: "",
  aiSummary: null as string | null,
  exportOpen: false,
  activeCommentId: null as string | null,
  commentComposer: null as CommentComposer,
  lastAiElementIndex: 0,
  usage: null as UsageState
};

export const useDrawStore = create<DrawStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setTool: (tool) =>
        set({
          tool,
          currentAsciiGhost: null,
          commentComposer: tool === "comment" ? get().commentComposer : null
        }),
      setStrokeSize: (strokeSize) => set({ strokeSize }),
      setPaletteIndex: (paletteIndex) =>
        set({
          paletteIndex,
          strokeColor: getPalette(paletteIndex)[0]
        }),
      setStrokeColor: (strokeColor) => set({ strokeColor }),
      cyclePalette: () =>
        set((state) => {
          const nextIndex = (state.paletteIndex + 1) % 5;
          return {
            paletteIndex: nextIndex,
            strokeColor: getPalette(nextIndex)[0]
          };
        }),
      setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
      setTurnState: (turnState) => set({ turnState }),
      setThinkingText: (thinkingText) =>
        set((state) => ({
          thinkingText,
          thinkingMessages:
            thinkingText && state.thinkingMessages[state.thinkingMessages.length - 1] !== thinkingText
              ? [...state.thinkingMessages, thinkingText].slice(-12)
              : state.thinkingMessages
        })),
      clearThinkingMessages: () =>
        set({
          thinkingText: "",
          thinkingMessages: []
        }),
      setNarration: (narration) =>
        set({
          narration,
          aiSummary: narration || null
        }),
      setAiSummary: (aiSummary) =>
        set({
          aiSummary,
          narration: aiSummary ?? ""
        }),
      setExportOpen: (exportOpen) => set({ exportOpen }),
      setShowThinkingPanel: (showThinkingPanel) => set({ showThinkingPanel }),
      setActiveCommentId: (activeCommentId) => set({ activeCommentId }),
      setUsage: (usage) => set({ usage }),
      beginStroke: (point) => {
        const { tool, strokeSize, strokeColor } = get();
        if (tool !== "draw" && tool !== "erase") {
          return;
        }

        set({
          currentStroke: {
            id: createId("human-stroke"),
            createdAt: Date.now(),
            kind: "humanStroke",
            tool,
            color: tool === "erase" ? PAPER_COLOR : strokeColor,
            size: strokeSize,
            points: [point]
          },
          turnState: "humanDrawing"
        });
      },
      appendStrokePoint: (point) => {
        const current = get().currentStroke;
        if (!current) {
          return;
        }

        set({
          currentStroke: {
            ...current,
            points: [...current.points, point]
          }
        });
      },
      commitStroke: () => {
        const current = get().currentStroke;
        if (!current || current.points.length < 2) {
          set({ currentStroke: null, turnState: "idle" });
          return null;
        }

        set((state) => ({
          elements: [...state.elements, current],
          currentStroke: null,
          turnState: "idle"
        }));

        return current;
      },
      cancelStroke: () => set({ currentStroke: null, turnState: "idle" }),
      setAsciiGhost: (currentAsciiGhost) => set({ currentAsciiGhost }),
      stampAscii: (point, text = "::*") => {
        const { strokeColor } = get();
        const block: AsciiBlock = {
          id: createId("ascii"),
          createdAt: Date.now(),
          kind: "asciiBlock",
          x: point.x,
          y: point.y,
          color: strokeColor,
          text,
          fontSize: 18
        };

        set((state) => ({
          elements: [...state.elements, block],
          turnHistory: [
            ...state.turnHistory,
            {
              id: createId("turn"),
              role: "user",
              summary: "Stamped an ASCII cluster.",
              createdAt: Date.now()
            }
          ],
          turnState: "idle"
        }));

        return block;
      },
      openCommentComposer: (x, y) =>
        set({
          commentComposer: { x, y, text: "" },
          turnState: "commenting",
          activeCommentId: null
        }),
      updateCommentComposer: (text) =>
        set((state) => ({
          commentComposer: state.commentComposer
            ? { ...state.commentComposer, text }
            : null
        })),
      closeCommentComposer: () =>
        set({
          commentComposer: null,
          turnState: "idle"
        }),
      submitCommentComposer: () => {
        const composer = get().commentComposer;
        if (!composer || !composer.text.trim()) {
          set({ commentComposer: null, turnState: "idle" });
          return null;
        }

        const comment: CommentPin = {
          id: createId("comment"),
          x: composer.x,
          y: composer.y,
          author: "You",
          text: composer.text.trim(),
          status: "open",
          thread: [
            {
              id: createId("comment-message"),
              author: "user",
              text: composer.text.trim(),
              createdAt: Date.now()
            }
          ]
        };

        set((state) => ({
          comments: [...state.comments, comment],
          commentComposer: null,
          turnState: "idle",
          activeCommentId: comment.id,
          turnHistory: [
            ...state.turnHistory,
            {
              id: createId("turn"),
              role: "user",
              summary: "Pinned a comment on the canvas.",
              createdAt: Date.now()
            }
          ]
        }));

        return comment;
      },
      appendCommentReply: (commentId, text) =>
        set((state) => ({
          comments: state.comments.map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  thread: [
                    ...comment.thread,
                    {
                      id: createId("comment-message"),
                      author: "ai",
                      text,
                      createdAt: Date.now()
                    }
                  ]
                }
              : comment
          )
        })),
      addAiElement: (element) =>
        set((state) => ({
          elements: [...state.elements, element]
        })),
      addHistoryEntry: (entry) =>
        set((state) => ({
          turnHistory: [...state.turnHistory, entry]
        })),
      checkpointAiState: () =>
        set((state) => ({
          lastAiElementIndex: state.elements.length
        })),
      clearBoard: () =>
        set({
          elements: [],
          comments: [],
          turnHistory: [],
          currentStroke: null,
          currentAsciiGhost: null,
          commentComposer: null,
          activeCommentId: null,
          narration: "",
          aiSummary: null,
          thinkingText: "",
          thinkingMessages: [],
          turnState: "idle",
          lastAiElementIndex: 0
        })
    }),
    {
      name: "draw-with-me-draft",
      storage:
        typeof window === "undefined"
          ? undefined
          : createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        elements: state.elements,
        comments: state.comments,
        turnHistory: state.turnHistory,
        paletteIndex: state.paletteIndex,
        strokeColor: state.strokeColor,
        backgroundMode: state.backgroundMode,
        lastAiElementIndex: state.lastAiElementIndex
      })
    }
  )
);

export function selectPalette(paletteIndex: number): Palette {
  return getPalette(paletteIndex);
}
