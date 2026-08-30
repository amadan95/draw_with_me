# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, and Vite, deployed as a static site to GitHub Pages. The application has no backend, database, server-owned AI key, or paid infrastructure. AI access is delegated to each visitor through OpenRouter, with a specific free vision model as the default.

## Users

The primary users are curious, casual visitors who want a playful, low-pressure creative exchange with an AI. They arrive from a public GitHub project or shared link and should be able to begin drawing without learning a professional editor.

## Product Purpose

Draw With Me is a shared sketch surface where a person and an AI companion take turns adding to the same drawing. Success means the AI visibly responds to what the person made, contributes a restrained and relevant addition, and returns control without replacing or damaging the existing work.

## Positioning

The conversation is embodied in editable drawing strokes rather than chat messages or generated bitmap images. Models propose structured drawing actions; the browser validates, resamples, subtly humanizes, animates with a visible pencil, stores, and exports them locally.

## Operating Context

Visitors draw with a mouse, touch, or stylus, then explicitly invite the AI to take a turn. Sessions remain in the browser and can be exported as PNG or SVG. OpenRouter authentication or a visitor-supplied OpenRouter key is required before the first AI turn, but not before drawing.

## Capabilities and Constraints

- Public, open-source, low-traffic application hosted on GitHub Pages.
- No developer-funded inference, guest credits, server runtime, account database, or local-model requirement.
- `google/gemma-4-31b-it:free` is the default model; visitors can select another compatible OpenRouter model.
- Specific free-model requests may fail over to a short, named list of compatible free vision models; the application does not use the random free-model router.
- AI models must accept image input and return tool calls or reliably structured JSON to participate directly.
- The canvas, history, settings, and credentials remain client-side. API keys must never enter the URL, repository, exports, logs, or analytics.
- Original, optional sound cues reinforce drawing, erasing, selection, undo/redo, and AI turn-taking without loading third-party media.
- AI marks arrive as a legible performance: a visible pencil follows each path with restrained wobble, pressure variation, and short pauses instead of stamping the finished result onto the grid.
- Human and AI marks remain distinguishable in state, individually undoable, and editable by the renderer.
- The application must preserve work across refreshes and handle offline, cancelled, malformed, unavailable, and rate-limited AI turns safely.

## Brand Commitments

The working name is **Draw With Me**. The interface should feel quiet, tactile, curious, and companionable. The selected visual direction is a continuous warm-paper drawing grid with a physical tool rail floating above it. The grid and toolbar are the whole world: no closed paper boundary, room, plants, lamp, shelves, wall art, floor, or surrounding scene. The provided Lele Zhang drawing experience is a binding interaction reference, but this project must use an original visual identity and original assets.

## Evidence on Hand

The previous implementation in this repository demonstrates a full-screen canvas, local semantic stroke rendering, scene-aware AI additions, and point-by-point AI animation. No testimonials, production usage claims, or original brand assets have been provided and none should be fabricated.

## Product Principles

- The canvas is the conversation.
- The AI adds; it does not overwrite.
- Drawing begins before configuration.
- Tool feedback should feel like handling art supplies, not operating generic software.
- Every remote action has a safe local failure state.
- The project owner can never receive an AI usage bill from a visitor.

## Accessibility & Inclusion

All non-drawing controls must be keyboard operable, visibly focused, labelled for assistive technology, and usable at 200% zoom. Touch targets should be at least 44 by 44 CSS pixels. Motion should respect reduced-motion preferences, and status changes should be announced without interrupting drawing.
