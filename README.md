# Draw With Me

A browser-based drawing board where a person and an AI companion take turns adding editable vector strokes to the same canvas.

## Why it costs the project owner nothing

This app is a static site with no server, database, project-owned API key, or paid infrastructure. It can be hosted on GitHub Pages. Drawing is always available without an account. When a visitor asks the AI to take a turn, they connect their own OpenRouter account or paste their own OpenRouter key for that browser tab.

The default model is `google/gemma-4-31b-it:free`, selected for its image understanding and native function calling. Free model availability and limits belong to OpenRouter and can change. The app never promises unlimited inference and never falls back to a project-funded key.

## Features

- Mouse, touch, and stylus drawing
- Pen, eraser, four-color palette, undo, redo, and clear
- Browser-local persistence with IndexedDB
- PNG and editable SVG export
- Visible AI pencil that traces resampled strokes point by point, with natural pauses, pressure variation, and slight human wobble
- Original illustrated pencil and eraser controls
- Optional synthesized paper, tool-selection, and turn-taking sounds
- OpenRouter OAuth PKCE connection or session-only pasted key
- Configurable OpenRouter model and AI stroke limit
- Static GitHub Pages deployment

## How the AI draws

The browser sends a snapshot of the current canvas to a vision-capable OpenRouter model. Specific models use a `draw_strokes` tool call; `openrouter/free` uses a more widely compatible JSON-only response so OpenRouter has a larger pool of free vision providers to choose from. The model returns normalized points, colors, and widths. The browser validates and clamps that response before rendering it as local vector strokes. The model does not replace the canvas with a generated image.

Because models differ, use a vision-capable model that supports tool calling. `google/gemma-4-31b-it:free` is the zero-cost default; a visitor can enter another compatible model ID in Settings.

## Local development

```bash
pnpm install
pnpm dev
```

No environment file is required. Production checks:

```bash
pnpm typecheck
pnpm build
```

## GitHub Pages

`pnpm build` writes the production site to the committed `docs/` folder. After merging, open the repository settings and set **Pages → Source** to **Deploy from a branch**, then choose **main** and **/docs**. This uses GitHub Pages directly and does not require a server or Actions workflow.

## Privacy and keys

- OAuth or pasted OpenRouter keys are kept in `sessionStorage`.
- Keys are not written to IndexedDB, URLs, exports, logs, analytics, or the repository.
- Canvas strokes and non-secret settings stay in the visitor's browser.
- Sound effects are generated locally with the Web Audio API; no audio files or external media requests are used.
- There is no project backend that can observe or store drawings.

## License

Add the license you want before publishing. MIT is a common choice for small public web projects.
