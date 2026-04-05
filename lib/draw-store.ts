"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  type AiCursorPresence,
  type CanvasBackground,
  type CommentThread,
  type DrawTurnHistory,
  type DrawingSyncState,
  type HumanStroke,
  type InteractionStyle,
  type PersistedAsciiBlock,
  type PersistedShapeElement,
  type Point,
  type SessionUsage,
  type SpeechDraft,
  type ToolMode,
  type TurnState,
  createId,
  getPalette
} from "@/lib/draw-types";
import { createAiHistoryEntry, createHumanHistoryEntry } from "@/lib/draw/history";

type CommentComposer = {
  x: number;
  y: number;
  text: string;
} | null;

type BoardSnapshot = {
  humanStrokes: HumanStroke[];
  drawingElements: PersistedShapeElement[];
  asciiBlocks: PersistedAsciiBlock[];
  comments: CommentThread[];
};

type DrawStore = {
  humanStrokes: HumanStroke[];
  currentStroke: HumanStroke | null;
  drawingElements: PersistedShapeElement[];
  asciiBlocks: PersistedAsciiBlock[];
  comments: CommentThread[];
  undoStack: BoardSnapshot[];
  redoStack: BoardSnapshot[];
  lastTurnElements: string[];
  turnState: TurnState;
  turnHistory: DrawTurnHistory[];
  turnCount: number;
  tool: ToolMode;
  strokeSize: number;
  paletteIndex: number;
  strokeColor: string;
  aiTemperature: number;
  aiMaxOutputTokens: number;
  backgroundMode: CanvasBackground;
  showThinkingPanel: boolean;
  thinkingText: string;
  narration: string;
  previewSaw: string;
  previewDrawing: string;
  aiSummary: string | null;
  exportOpen: boolean;
  activeCommentId: string | null;
  commentComposer: CommentComposer;
  sessionUsage: SessionUsage | null;
  interactionStyle: InteractionStyle;
  aiCursor: AiCursorPresence;
  speechDraft: SpeechDraft | null;
  lastSyncedState: DrawingSyncState | null;
  aiSource: "gemini" | "fallback-provider-error" | "fallback-parse-error" | null;
  debugInfo: {
    hasFocusImage: boolean;
    turnMode: "turn" | "comment" | null;
  };
  setTool: (tool: ToolMode) => void;
  setStrokeSize: (size: number) => void;
  setPaletteIndex: (index: number) => void;
  setStrokeColor: (color: string) => void;
  setAiTemperature: (value: number) => void;
  setAiMaxOutputTokens: (value: number) => void;
  cyclePalette: () => void;
  setBackgroundMode: (mode: CanvasBackground) => void;
  setShowThinkingPanel: (open: boolean) => void;
  setThinkingText: (text: string) => void;
  setNarration: (text: string) => void;
  setPreviewSaw: (text: string) => void;
  setPreviewDrawing: (text: string) => void;
  setAiSummary: (text: string | null) => void;
  setExportOpen: (open: boolean) => void;
  setActiveCommentId: (id: string | null) => void;
  setSessionUsage: (usage: SessionUsage | null) => void;
  setInteractionStyle: (style: InteractionStyle) => void;
  setAiCursor: (cursor: Partial<AiCursorPresence>) => void;
  clearAiCursor: () => void;
  setSpeechDraft: (draft: SpeechDraft | null) => void;
  appendSpeechDraft: (chunk: string) => void;
  clearSpeechDraft: () => void;
  setAiSource: (source: "gemini" | "fallback-provider-error" | "fallback-parse-error" | null) => void;
  setDebugInfo: (info: { hasFocusImage: boolean; turnMode: "turn" | "comment" | null }) => void;
  beginStroke: (point: Point) => void;
  appendStrokePoint: (point: Point) => void;
  commitStroke: () => HumanStroke | null;
  cancelStroke: () => void;
  stampAscii: (point: Point, text?: string) => PersistedAsciiBlock;
  openCommentComposer: (x: number, y: number) => void;
  updateCommentComposer: (text: string) => void;
  closeCommentComposer: () => void;
  submitCommentComposer: () => CommentThread | null;
  appendCommentReply: (commentId: string, text: string) => void;
  dismissCommentThread: (threadId?: string) => void;
  beginModelRequest: () => void;
  beginModelStreaming: () => void;
  beginModelAnimating: () => void;
  completeModelTurn: (
    summary?: string | null,
    options?: { incrementTurnCount?: boolean }
  ) => void;
  failTurn: () => void;
  addHistoryEntry: (entry: DrawTurnHistory) => void;
  commitAiShape: (element: PersistedShapeElement) => void;
  commitAiBlock: (block: PersistedAsciiBlock) => void;
  markSyncedState: (state: DrawingSyncState) => void;
  clearBoard: () => void;
  undo: () => void;
  redo: () => void;
};

const initialCursor: AiCursorPresence = {
  visible: false,
  phase: "idle",
  x: 0,
  y: 0
};

const initialState = {
  humanStrokes: [] as HumanStroke[],
  currentStroke: null as HumanStroke | null,
  drawingElements: [] as PersistedShapeElement[],
  asciiBlocks: [] as PersistedAsciiBlock[],
  comments: [] as CommentThread[],
  undoStack: [] as BoardSnapshot[],
  redoStack: [] as BoardSnapshot[],
  lastTurnElements: [] as string[],
  turnState: "idle" as TurnState,
  turnHistory: [] as DrawTurnHistory[],
  turnCount: 0,
  tool: "draw" as ToolMode,
  strokeSize: 6,
  paletteIndex: 0,
  strokeColor: getPalette(0)[0],
  aiTemperature: 0.34,
  aiMaxOutputTokens: 3072,
  backgroundMode: "dots" as CanvasBackground,
  showThinkingPanel: true,
  thinkingText: "",
  narration: "",
  previewSaw: "",
  previewDrawing: "",
  aiSummary: null as string | null,
  exportOpen: false,
  activeCommentId: null as string | null,
  commentComposer: null as CommentComposer,
  sessionUsage: null as SessionUsage | null,
  interactionStyle: "collaborative" as InteractionStyle,
  aiCursor: initialCursor,
  speechDraft: null as SpeechDraft | null,
  lastSyncedState: null as DrawingSyncState | null,
  aiSource: null as "gemini" | "fallback-provider-error" | "fallback-parse-error" | null,
  debugInfo: {
    hasFocusImage: false,
    turnMode: null as "turn" | "comment" | null
  }
};

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotBoard(state: Pick<
  DrawStore,
  "humanStrokes" | "drawingElements" | "asciiBlocks" | "comments"
>): BoardSnapshot {
  return cloneValue({
    humanStrokes: state.humanStrokes,
    drawingElements: state.drawingElements,
    asciiBlocks: state.asciiBlocks,
    comments: state.comments
  });
}

function applyBoardSnapshot(snapshot: BoardSnapshot) {
  return {
    humanStrokes: snapshot.humanStrokes,
    drawingElements: snapshot.drawingElements,
    asciiBlocks: snapshot.asciiBlocks,
    comments: snapshot.comments
  };
}

function pushUndo(state: DrawStore) {
  return [...state.undoStack.slice(-39), snapshotBoard(state)];
}

export const useDrawStore = create<DrawStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setTool: (tool) => set({ tool }),
      setStrokeSize: (strokeSize) => set({ strokeSize }),
      setPaletteIndex: (paletteIndex) =>
        set({
          paletteIndex,
          strokeColor: getPalette(paletteIndex)[0]
        }),
      setStrokeColor: (strokeColor) => set({ strokeColor }),
      setAiTemperature: (aiTemperature) =>
        set({
          aiTemperature: Math.min(1, Math.max(0, aiTemperature))
        }),
      setAiMaxOutputTokens: (aiMaxOutputTokens) =>
        set({
          aiMaxOutputTokens: Math.round(
            Math.min(8192, Math.max(256, aiMaxOutputTokens))
          )
        }),
      cyclePalette: () =>
        set((state) => {
          const nextIndex = (state.paletteIndex + 1) % 5;
          return {
            paletteIndex: nextIndex,
            strokeColor: getPalette(nextIndex)[0]
          };
        }),
      setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
      setShowThinkingPanel: (showThinkingPanel) => set({ showThinkingPanel }),
      setThinkingText: (thinkingText) => set({ thinkingText }),
      setNarration: (narration) => set({ narration }),
      setPreviewSaw: (previewSaw) => set({ previewSaw }),
      setPreviewDrawing: (previewDrawing) => set({ previewDrawing }),
      setAiSummary: (aiSummary) => set({ aiSummary }),
      setExportOpen: (exportOpen) => set({ exportOpen }),
      setActiveCommentId: (activeCommentId) => set({ activeCommentId }),
      setSessionUsage: (sessionUsage) => set({ sessionUsage }),
      setInteractionStyle: (interactionStyle) => set({ interactionStyle }),
      setAiCursor: (cursor) =>
        set((state) => ({
          aiCursor: {
            ...state.aiCursor,
            ...cursor,
            visible: cursor.visible ?? true
          }
        })),
      clearAiCursor: () => set({ aiCursor: initialCursor }),
      setSpeechDraft: (speechDraft) => set({ speechDraft }),
      appendSpeechDraft: (chunk) =>
        set((state) => ({
          speechDraft: state.speechDraft
            ? {
                ...state.speechDraft,
                text: `${state.speechDraft.text}${chunk}`.trimStart()
              }
            : {
                text: chunk
              }
        })),
      clearSpeechDraft: () => set({ speechDraft: null }),
      setAiSource: (aiSource) => set({ aiSource }),
      setDebugInfo: (debugInfo) => set({ debugInfo }),
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
            color: tool === "erase" ? "#000000" : strokeColor,
            size: strokeSize,
            points: [point]
          },
          turnState: "humanDrawing"
        });
      },
      appendStrokePoint: (point) =>
        set((state) => ({
          currentStroke: state.currentStroke
            ? {
                ...state.currentStroke,
                points: [...state.currentStroke.points, point]
              }
            : null
        })),
      commitStroke: () => {
        const current = get().currentStroke;
        if (!current || current.points.length < 2) {
          set({
            currentStroke: null,
            turnState: "idle"
          });
          return null;
        }

        set((state) => ({
          humanStrokes: [...state.humanStrokes, current],
          currentStroke: null,
          undoStack: pushUndo(state),
          redoStack: [],
          turnHistory: [
            ...state.turnHistory,
            createHumanHistoryEntry(
              current.tool === "erase" ? "Erased part of the page." : "Drew a freehand stroke."
            )
          ],
          turnState: "idle"
        }));

        return current;
      },
      cancelStroke: () =>
        set({
          currentStroke: null,
          turnState: "idle"
        }),
      stampAscii: (point, text = "::*") => {
        const { strokeColor } = get();
        const block: PersistedAsciiBlock = {
          id: createId("ascii"),
          createdAt: Date.now(),
          kind: "asciiBlock",
          source: "human",
          x: point.x,
          y: point.y,
          color: strokeColor,
          text,
          fontSize: 18
        };

        set((state) => ({
          asciiBlocks: [...state.asciiBlocks, block],
          undoStack: pushUndo(state),
          redoStack: [],
          turnHistory: [
            ...state.turnHistory,
            createHumanHistoryEntry("Placed an ASCII block.")
          ],
          turnState: "idle"
        }));

        return block;
      },
      openCommentComposer: (x, y) =>
        set({
          commentComposer: { x, y, text: "" },
          activeCommentId: null,
          turnState: "commenting"
        }),
      updateCommentComposer: (text) =>
        set((state) => ({
          commentComposer: state.commentComposer
            ? {
                ...state.commentComposer,
                text
              }
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
          set({
            commentComposer: null,
            turnState: "idle"
          });
          return null;
        }

        const comment: CommentThread = {
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
          activeCommentId: comment.id,
          undoStack: pushUndo(state),
          redoStack: [],
          turnHistory: [
            ...state.turnHistory,
            createHumanHistoryEntry("Pinned a comment on the canvas.")
          ],
          turnState: "idle"
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
      dismissCommentThread: (threadId) =>
        set((state) => ({
          activeCommentId:
            !threadId || state.activeCommentId === threadId ? null : state.activeCommentId,
          comments: threadId
            ? state.comments.map((comment) =>
                comment.id === threadId
                  ? {
                      ...comment,
                      status: "resolved"
                    }
                  : comment
              )
            : state.comments
        })),
      beginModelRequest: () =>
        set({
          turnState: "awaitingModel",
          thinkingText: "",
          narration: "",
          previewSaw: "",
          previewDrawing: "",
          aiSummary: null,
          speechDraft: null,
          lastTurnElements: [],
          aiSource: null,
          debugInfo: {
            hasFocusImage: false,
            turnMode: null
          }
        }),
      beginModelStreaming: () =>
        set({
          turnState: "modelStreaming"
        }),
      beginModelAnimating: () =>
        set({
          turnState: "modelAnimating"
        }),
      completeModelTurn: (summary, options) =>
        set((state) => ({
          turnState: "idle",
          aiSummary: summary ?? state.aiSummary,
          turnCount:
            options?.incrementTurnCount === false
              ? state.turnCount
              : state.turnCount + 1
        })),
      failTurn: () =>
        set({
          turnState: "error"
        }),
      addHistoryEntry: (entry) =>
        set((state) => ({
          turnHistory: [...state.turnHistory, entry]
        })),
      commitAiShape: (element) =>
        set((state) => ({
          drawingElements: [...state.drawingElements, element],
          lastTurnElements: [...state.lastTurnElements, element.id]
        })),
      commitAiBlock: (block) =>
        set((state) => ({
          asciiBlocks: [...state.asciiBlocks, block],
          lastTurnElements: [...state.lastTurnElements, block.id]
        })),
      markSyncedState: (lastSyncedState) => set({ lastSyncedState }),
      clearBoard: () =>
        set({
          ...initialState,
          strokeColor: getPalette(get().paletteIndex)[0],
          paletteIndex: get().paletteIndex,
          aiTemperature: get().aiTemperature,
          aiMaxOutputTokens: get().aiMaxOutputTokens,
          backgroundMode: get().backgroundMode
        }),
      undo: () => {
        const state = get();
        const snapshot = state.undoStack[state.undoStack.length - 1];
        if (!snapshot) {
          return;
        }

        set({
          ...applyBoardSnapshot(snapshot),
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, snapshotBoard(state)],
          currentStroke: null,
          turnState: "idle"
        });
      },
      redo: () => {
        const state = get();
        const snapshot = state.redoStack[state.redoStack.length - 1];
        if (!snapshot) {
          return;
        }

        set({
          ...applyBoardSnapshot(snapshot),
          redoStack: state.redoStack.slice(0, -1),
          undoStack: [...state.undoStack, snapshotBoard(state)],
          currentStroke: null,
          turnState: "idle"
        });
      }
    }),
    {
      name: "draw-with-me-draft-v2",
      storage:
        typeof window === "undefined"
          ? undefined
          : createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        humanStrokes: state.humanStrokes,
        drawingElements: state.drawingElements,
        asciiBlocks: state.asciiBlocks,
        comments: state.comments,
        turnHistory: state.turnHistory,
        turnCount: state.turnCount,
        paletteIndex: state.paletteIndex,
        strokeColor: state.strokeColor,
        aiTemperature: state.aiTemperature,
        aiMaxOutputTokens: state.aiMaxOutputTokens,
        backgroundMode: state.backgroundMode,
        lastSyncedState: state.lastSyncedState
      })
    }
  )
);

export function getCurrentSyncState() {
  const state = useDrawStore.getState();
  return {
    humanStrokes: state.humanStrokes,
    drawingElements: state.drawingElements,
    asciiBlocks: state.asciiBlocks
  };
}

export function getLastTurnArtifacts() {
  const state = useDrawStore.getState();
  const shapeSet = new Set(state.lastTurnElements);

  return {
    shapes: state.drawingElements.filter((element) => shapeSet.has(element.id)),
    blocks: state.asciiBlocks.filter((block) => shapeSet.has(block.id))
  };
}

export function buildAiTurnHistoryEntry(summary?: string | null) {
  const { shapes, blocks } = getLastTurnArtifacts();
  return createAiHistoryEntry({
    description: summary ?? undefined,
    shapes,
    blocks,
    commentSummary: summary ?? undefined
  });
}
