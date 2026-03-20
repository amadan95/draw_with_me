# Draw With Me

`Draw With Me` is a standalone Next.js drawing app where a human sketches on a canvas and Gemini responds as a drawing collaborator.

The AI does not generate a bitmap image. It looks at the current canvas, plans structured brush actions, and streams those actions back to the frontend so they animate onto the page as live drawings.

## What It Does

- Full-screen whiteboard-style drawing surface
- Human drawing tools for brush, eraser, text/ascii, and comments
- AI turn system that watches the canvas and adds its own drawings
- Live stroke animation for AI output instead of instant stamping
- Minimal floating UI inspired by collaborative drawing tools
- Local draft persistence with Zustand
- Server-side Gemini integration with validation, repair, and fallback behavior

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Zustand
- Tailwind CSS 4
- `motion`
- Zod
- Clerk
- Upstash Redis

## AI Architecture

The current AI system treats Gemini as a planner, not a painter.

### Request flow

When the user sends a turn, the client sends:

- a compact JPEG snapshot of the canvas
- canvas width and height
- active palette
- recent human marks
- recent AI marks
- recent turn summaries
- optional comment context

### Planner response

Gemini is asked to return strict JSON only. The expected shape is:

```json
{
  "scene": "a simple house",
  "approach": "add a chimney and smoke to the house",
  "why": "this adds a common detail to a house and makes it look more lived-in and cozy",
  "actions": [
    {
      "tool": "brush",
      "color": "#262523",
      "width": 4,
      "opacity": 0.9,
      "points": [[600, 300], [595, 290], [590, 280]],
      "timing": {
        "speed": 1,
        "pauseAfterMs": 120
      }
    }
  ]
}
```

### Validation and fallback

Server-side code validates and sanitizes the planner output:

- clamps coordinates to canvas bounds
- forces colors onto the active palette
- clamps width and opacity
- rejects malformed actions
- repairs malformed JSON once
- salvages partial metadata and complete actions from truncated JSON when possible
- falls back to deterministic scene-aware drawings if Gemini fails or returns poor geometry

### Rendering

Validated planner actions are converted into internal AI stroke events and streamed to the client as NDJSON. The frontend animates those events point-by-point so the AI appears to draw live on the canvas.

## Project Structure

```text
app/
  api/draw/comment/route.ts
  api/draw/loading-messages/route.ts
  api/draw/turn/route.ts
  draw/page.tsx

components/draw/
  draw-app.tsx
  draw-canvas.tsx
  header.tsx
  text-cursor-icon.tsx
  auth-controls.tsx

lib/
  ai.ts
  auth.ts
  draw-server.ts
  draw-store.ts
  draw-types.ts
  draw-utils.ts
  loading-messages.ts
  quota.ts
```

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your env file

Copy `.env.example` to `.env.local` and fill in the values you need.

```bash
cp .env.example .env.local
```

Current env vars:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Local Development

Run the app:

```bash
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/draw`

### Auth behavior in local dev

If Clerk keys are not configured and the app is running in local development, the server uses a local dev auth bypass so AI turns can still work without sign-in.

In production, Clerk auth is expected.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
```

## Current Notes

- Gemini calls stay server-side.
- The AI is optimized for structured drawing actions, not image generation.
- The app prefers restrained collaboration, but the prompt currently encourages scene-aware additions when the drawing is sparse.
- Upstash Redis is optional in local use. If it is not configured, quota handling falls back in memory.

## Verification

Current project checks:

```bash
npm run typecheck
npm run build
```
