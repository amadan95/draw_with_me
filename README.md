# Draw With Me

`Draw With Me` is a standalone Next.js drawing app where a human sketches on a canvas and Gemini responds as a drawing collaborator.

The AI does not generate a bitmap image. It reads the scene semantically and the app renders the chosen additions locally as animated sketch strokes.

## What It Does

- Full-screen whiteboard-style drawing surface
- Human drawing tools for brush, eraser, text/ascii, and comments
- AI turn system that watches the canvas and adds its own drawings
- Live stroke animation for AI output instead of instant stamping
- Minimal floating UI inspired by collaborative drawing tools
- Local draft persistence with Zustand
- Server-side Gemini scene analysis with local sketch rendering

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

The current AI system treats Gemini as a scene analyst, not a painter.

### Request flow

When the user sends a turn, the client sends:

- a compact JPEG snapshot of the canvas
- canvas width and height
- active palette
- recent human marks
- recent AI marks
- recent turn summaries
- optional comment context

### Scene analysis response

Gemini is asked to return strict JSON only. The expected shape is:

```json
{
  "scene": "a simple house with two trees",
  "why": "the page reads as a sparse outdoor home scene",
  "subjects": [
    {
      "id": "subj_house_1",
      "family": "house",
      "label": "house",
      "bbox": {
        "x": 220,
        "y": 180,
        "width": 260,
        "height": 240
      }
    }
  ],
  "additions": [
    {
      "id": "add_1",
      "family": "chimney",
      "targetSubjectId": "subj_house_1",
      "relation": "attach_roof_right",
      "reason": "adds a lived-in roof detail",
      "priority": 1
    }
  ]
}
```

### Rendering

Server-side code validates and sanitizes the scene analysis, then the local sketch renderer turns the additions into internal stroke events:

- addition families are normalized to local sketch recipes
- placement is resolved against detected subjects and semantic relations
- rendered strokes are streamed to the client as NDJSON
- the frontend animates those events point-by-point so the AI appears to draw live on the canvas

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
