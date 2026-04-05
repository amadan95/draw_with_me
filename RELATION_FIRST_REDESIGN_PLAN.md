# Relation-First Redesign Plan for `darw_with_me`

## Why this redesign is needed

The current architecture asks the model to do too much in one shot:

1. infer scene semantics from a rough sketch
2. choose a useful addition
3. identify the correct host structure
4. infer correct local attachment geometry
5. emit final vector primitives directly

Even after improving parsing, snapshot quality, focus crops, active-region grounding, dynamic attachment candidates, and rejection logic, the app still produces visually stupid results. That strongly suggests the direct-geometry approach is the wrong abstraction boundary.

The core problem is not only model quality. It is **where the responsibility split happens**.

Right now the model is responsible for both:
- deciding **what** should be added
- deciding exactly **where/how** it should attach geometrically

That second responsibility is where failures become glaring.

---

## New principle

Move from:

- **geometry-first LLM output**

To:

- **relation-first LLM output**
- **local deterministic geometry realization**

The model should decide:
- intent
- host structure
- relation to host
- rough size/style
- optional commentary

Local code should decide:
- actual geometry coordinates
- exact placement
- attachment enforcement
- scale normalization
- overlap/intersection rules
- final renderable vector primitives

---

## High-level target architecture

### Current

Human sketch -> raster snapshot + context -> Gemini -> final shape primitives -> render

### Target

Human sketch -> raster snapshot + structured scene candidates -> Gemini -> relation plan -> local geometry engine -> final shape primitives -> render

---

## What “relation-first” means

The model should no longer emit final geometry for most object-part additions.

Instead it should emit something like:

```json
{
  "interactionStyle": "collaborative",
  "summary": "Added a chimney attached to the upper-right roof edge.",
  "events": [
    {
      "type": "relation_shape",
      "relation": {
        "hostCandidateId": "shape-17",
        "placementMode": "attach",
        "anchor": "top-right-edge",
        "primitive": "rect",
        "sizeRatio": 0.18,
        "aspectRatio": 0.55,
        "offset": { "x": 0.04, "y": -0.08 },
        "style": {
          "stroke": "#262523",
          "strokeWidth": 3,
          "fill": "transparent"
        },
        "semanticRole": "part"
      }
    }
  ]
}
```

This gives the model semantic flexibility, while moving exact geometry synthesis into local code.

---

## Dynamic, not object-hardcoded

This redesign should avoid rules like:
- if chimney then roof
- if window then wall
- if hat then head

Instead, the system should operate on **generic relation types**:

- attach to top edge
- attach to right edge
- center within bounds
- place inside upper half
- overlap corner region
- place adjacent outside boundary
- align to slope-ish local edge if available
- place small detail near local contour cluster

The model may still mention semantics in `summary` or internal reasoning, but the actual render system should care mostly about:
- host candidate
- relation type
- normalized size
- style hint
- primitive family

That preserves dynamism while avoiding freeform geometric chaos.

---

## Key new subsystem: Scene candidate extraction

Before calling the model, derive a scene candidate set from the current board.

Each candidate should describe a recent geometric structure inferred from strokes/elements.

Example:

```ts
type SceneCandidate = {
  id: string;
  source: 'humanStroke' | 'shapeElement' | 'asciiBlock' | 'cluster';
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  centroid: { x: number; y: number };
  density: number;
  strokeCount?: number;
  shapeCount?: number;
  edgeHints: {
    top: { x1: number; y1: number; x2: number; y2: number } | null;
    right: { x1: number; y1: number; x2: number; y2: number } | null;
    bottom: { x1: number; y1: number; x2: number; y2: number } | null;
    left: { x1: number; y1: number; x2: number; y2: number } | null;
  };
  orientationHints?: {
    dominantAngle?: number;
    hasRoofLikePeak?: boolean;
    hasClosedBody?: boolean;
  };
};
```

These candidates should be generated from recent geometry clustering, not semantic hardcoding.

---

## Key new subsystem: Relation plan protocol

Introduce a new event type in the streamed protocol.

```ts
type RelationShapeEvent = {
  type: 'relation_shape';
  relation: {
    hostCandidateId: string;
    placementMode:
      | 'attach'
      | 'inside'
      | 'overlap'
      | 'adjacent'
      | 'centered'
      | 'edge-aligned';
    anchor:
      | 'center'
      | 'top-edge'
      | 'bottom-edge'
      | 'left-edge'
      | 'right-edge'
      | 'top-left-corner'
      | 'top-right-corner'
      | 'bottom-left-corner'
      | 'bottom-right-corner'
      | 'upper-half'
      | 'lower-half';
    primitive: 'rect' | 'circle' | 'ellipse' | 'line' | 'curve' | 'polygon';
    sizeRatio: number;
    aspectRatio?: number;
    offset?: { x: number; y: number };
    rotationHint?: number;
    style?: {
      stroke?: string;
      strokeWidth?: number;
      fill?: string;
      opacity?: number;
    };
    semanticRole?: 'part' | 'detail' | 'attachment' | 'accent';
    label?: string;
  };
};
```

The client/server normalizer should convert this relation event into concrete vector geometry.

---

## Key new subsystem: Local geometry realizer

Build a deterministic geometry realization layer.

Input:
- `SceneCandidate`
- relation plan event

Output:
- final `DrawShape`

Responsibilities:
- anchor to host bounds/edge
- compute exact placement
- compute exact size from `sizeRatio`
- preserve inside/attach/overlap constraints
- clamp to canvas and active region
- generate final SVG primitives

### Example deterministic rules

#### Attach
- place the new primitive so one boundary intersects or touches the chosen host edge
- ensure at least N% of the new shape overlaps/touches the host boundary zone

#### Inside
- place fully within host bounds
- shrink if needed

#### Adjacent
- place outside the host, but within a max offset band

#### Overlap
- require bounded overlap area with host candidate

#### Edge-aligned
- align primitive orientation to host edge or dominant local angle

These are generic geometric rules, not object-specific ones.

---

## Key new subsystem: Candidate ranking / host selection

The model should be given candidate IDs and rough metadata.

The prompt should tell it:
- choose the best host candidate for the requested addition
- if uncertain, prefer reply-only or a minimal detail
- do not invent detached geometry if no host candidate is convincing

If the model chooses a host candidate that is wildly implausible, local validation should be allowed to reject it.

---

## Prompt redesign

### Current prompt problem
The current prompt still pushes the model toward final coordinate geometry.

### New prompt goal
Ask for relation plans, not direct final geometry, for most attached/detail additions.

The prompt should say:
- You are given inferred host candidates.
- For additions that belong to an existing structure, choose a host candidate and relation.
- Prefer `relation_shape` over freeform `shape` when the addition is part-like or attached.
- Use raw `shape` only for genuinely free-floating additions or abstract details.
- If uncertain, use text-only reply or minimal detail.

This preserves model flexibility but reduces geometric hallucination.

---

## Validation redesign

### Current validation problem
Current validation only says:
- is shape plausible?
- is it near enough?
- is it too big?

That is too late and too weak.

### New validation
For relation plans, validate:
- host candidate exists
- placement mode is supported
- size ratio is within allowed range
- anchor is valid for placement mode
- local geometry realization succeeds
- realized shape satisfies relation constraints

Then render.

If realization fails:
- reject that event
- optionally fallback to text-only explanation

---

## Suggested rollout plan

### Phase 1 — Add relation protocol without deleting existing shape protocol
- introduce `relation_shape` event type
- keep direct `shape` events for backwards compatibility
- allow model to emit either
- start preferring `relation_shape` in prompt

### Phase 2 — Add scene candidate extraction
- extract candidate bounds from recent strokes/elements
- include candidate metadata in prompt payload
- surface candidate IDs in dev mode if useful

### Phase 3 — Add geometry realizer
- implement deterministic conversion from relation plan -> concrete shape
- support generic relation modes first

### Phase 4 — Prefer relation plans for attached additions
- update prompt language
- use relation plans for part/detail additions
- reserve direct freeform geometry for rare cases

### Phase 5 — Tighten rejection of direct freeform geometry
- if relation plan would be more appropriate, discourage raw shape output
- optionally reject detached freeform additions in comment-driven part-edit turns

---

## File/module changes to make

### New files

```text
lib/draw/scene-candidates.ts
lib/draw/relations.ts
lib/draw/geometry-realizer.ts
lib/draw/relation-validation.ts
```

### Existing files to refactor

- `lib/draw/protocol.ts`
  - add `relation_shape` event schema

- `lib/draw/prompts.ts`
  - send scene candidates
  - ask for relation-first output

- `lib/ai/gemini-draw.ts`
  - parse/normalize relation events
  - realize them into concrete shapes before emitting/rendering

- `lib/draw/rendering.ts`
  - add candidate extraction helpers if not separated cleanly

- `components/draw/draw-app.tsx`
  - no major architectural change required if relation events are normalized server-side before streaming to client

---

## Generic relation vocabulary to support first

Start with a small, useful set:

- `attach + top-edge`
- `attach + right-edge`
- `attach + left-edge`
- `inside + center`
- `inside + upper-half`
- `inside + lower-half`
- `overlap + top-right-corner`
- `adjacent + right-edge`
- `adjacent + left-edge`
- `centered + center`

That should be enough to cover many “part of existing structure” cases without object hardcoding.

---

## Why this is better

This redesign improves the abstraction boundary:

### Model remains good at:
- picking what to add
- deciding whether it belongs to something
- choosing rough relation and size
- producing commentary and collaborative behavior

### Local code becomes responsible for:
- exact geometry
- attachment correctness
- overlap constraints
- scale normalization
- preventing absurd placements

That is a much better split for this kind of app.

---

## What success would look like

A successful redesign should produce behavior like:

- if the user has drawn a house body and roof, a requested chimney attaches to a nearby host candidate edge rather than floating off to the side
- if the user wants a window, it lands inside the likely body bounds instead of outside the structure
- if the model is uncertain, it gives a small reply or minimal detail instead of hallucinating detached geometry
- geometry quality becomes more deterministic even if model semantics remain imperfect

---

## What not to do

- Do not revert to hardcoded object templates as the primary solution.
- Do not ask the model for full final geometry when a host-part relation is sufficient.
- Do not rely only on prompt wording to solve attachment.
- Do not add dozens of special-case semantic mappings.

---

## Recommendation

Implement this relation-first redesign before spending more time polishing the current direct-geometry approach.

That current path has already shown diminishing returns.

This redesign is the first path that is both:
- dynamic enough to satisfy the product goal
- structured enough to stop embarrassingly bad attachment errors
