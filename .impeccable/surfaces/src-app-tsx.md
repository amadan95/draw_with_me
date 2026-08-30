---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/DrawingCanvas.tsx"]
---

# Continuous drawing grid surface brief

- Mode: Experience.
- Audience: casual visitors arriving at a public GitHub Pages app who want to draw immediately.
- Primary task: sketch with mouse, touch, or stylus, then explicitly invite an AI companion to add a restrained turn.
- Approved composition: `.impeccable/mocks/approved-board-and-toolbar.png`, subsequently overridden by the user's explicit request for one continuous grid instead of a closed canvas. Retain the palette and tool-rail character, not the board boundary.
- Memorable moment: the turn button depresses with a quiet two-note handoff and the AI's strokes appear point by point with paper texture before the illustrated pencil returns to the visitor.
- Visual world: continuous full-viewport warm-paper grid, floating blush tool rail, hand-lettered title, mustard/coral/eggplant/sage tools. No closed frame, room, scenery, outer background, floating card dashboard, or professional editor chrome.
- Component grammar: unbounded grid canvas; compact title/status; physical round tools; separated utility actions; prominent rectangular AI-turn button; one focused settings sheet.
- Inventory: drawing canvas, illustrated pencil, illustrated eraser, four colors, undo, redo, sound toggle, clear, export PNG, export SVG, OpenRouter connection/settings, AI-turn action, accessible status.
- Constraints: static hosting, visitor-owned OpenRouter credential, browser-only persistence, no project-funded inference.
