---
name: Draw With Me
description: A warm, continuous drawing grid for human-and-AI sketch turns.
colors:
  studio-sage: "#84a59d"
  studio-sage-dark: "#526b5d"
  studio-sage-deep: "#354c40"
  companion-coral: "#e07a5f"
  pencil-mustard: "#f2b84b"
  companion-eggplant: "#3d405b"
  warm-paper: "#fffdf7"
  blush-rail: "#f3dfd5"
  graphite-ink: "#332d28"
typography:
  display:
    fontFamily: "Gaegu, cursive"
    fontSize: "clamp(2.2rem, 4vw, 3.55rem)"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Nunito, sans-serif"
    fontWeight: 400
  label:
    fontFamily: "Nunito, sans-serif"
    fontWeight: 700
rounded:
  paper: "5px"
  control: "12px"
  rail: "18px"
  round: "999px"
spacing:
  tight: "8px"
  control: "12px"
  group: "16px"
components:
  ai-turn:
    backgroundColor: "{colors.studio-sage-deep}"
    textColor: "{colors.warm-paper}"
    rounded: "{rounded.control}"
    height: "70px"
  connection-chip:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.studio-sage-deep}"
    rounded: "{rounded.round}"
    height: "44px"
  color-well:
    rounded: "{rounded.round}"
    size: "56px"
  text-input:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.graphite-ink}"
    rounded: "{rounded.control}"
    height: "48px"
---

# Design System: Draw With Me

## Overview

**Creative North Star: "The Friendly Drawing Table"**

The interface turns the viewport into one continuous drawing surface. A warm-paper grid, a floating blush tool rail, sage actions, and slightly irregular lettering create a quiet studio feeling without depicting a room or enclosing the canvas. The grid carries nearly all visual weight; controls feel like physical implements placed within reach.

The world is tactile but restrained. Texture is fine and low-contrast, depth has a visible downward offset, and ornament comes from useful objects rather than decorative scenery.

**Key Characteristics:**

- One uninterrupted grid fills the viewport.
- Warm, muted art-supply colors replace software chrome.
- Handwritten display type is reserved for moments of invitation.
- The AI turn feels like pressing a studio control and watching another hand draw.

## Colors

The palette combines muted sage structure with warm paper and a small set of recognizable pencil colors.

### Primary

- **Studio Sage:** A selected drawing color and structural accent; calm enough for a long sketching session.
- **Deep Studio Sage:** The AI-turn action and strongest control emphasis.

### Secondary

- **Companion Coral:** A warm drawing color that supplies friendly contrast.
- **Pencil Mustard:** The brightest drawing color and the restrained spark accent during an AI turn.
- **Companion Eggplant:** The darkest drawing color and a secondary action color.

### Neutral

- **Warm Paper:** The canvas and bright control surfaces.
- **Blush Rail:** The toolbar surface that separates tools from the continuous paper grid.
- **Graphite Ink:** Body copy and functional icon color.

**The Art-Supply Rule.** Every strong color must plausibly belong to a pencil, eraser, paper, wood, or painted board; generic app-blue is outside this world.

## Typography

**Display Font:** Gaegu (with cursive fallback)

**Body Font:** Nunito (with sans-serif fallback)

**Character:** Gaegu is loose, rounded, and visibly hand-lettered. Nunito carries labels and explanations with friendly clarity while remaining visually quiet.

### Hierarchy

- **Display** (700, responsive clamp, 0.9 line-height): the single grid title and settings-sheet title.
- **Body** (400, normal size): explanations, privacy copy, and status messages.
- **Label** (700): actions, fields, and compact connection state.

**The One Handwritten Voice Rule.** Use Gaegu for titles and invitation moments only; functional controls stay in Nunito.

## Layout

The product is a single full-viewport grid with no enclosing edge. A centered horizontal rail floats near the bottom while the grid continues behind it. At 900px and below, the rail becomes a two-row instrument tray; drawing tools and color wells remain on top, while utilities and the AI turn move below. The canvas never becomes a card inside a page, and the viewport never reveals a surrounding room.

Spacing follows three recurring steps: tight control gaps, internal control padding, and group separation. Touch targets remain at least 44px.

## Elevation & Depth

Depth is structural: the continuous grid stays flat while the rail, controls, status label, and dialog cast soft shadows with a downward offset. Fine radial texture remains within the paper surface. Shadows should describe layers, never form zero-offset glows.

### Shadow Vocabulary

- **Rail lift:** strongest ambient shadow because the rail sits in front of the grid.
- **Pressed control:** reduced vertical shadow and a 2px downward movement.

**The Real Layer Rule.** Add elevation only where one functional surface physically sits above another.

## Shapes

The grid has no outer silhouette or corner. The rail uses 18px corners and ordinary controls use 10–14px. Color wells and connection chips are fully round because they behave like physical swatches and compact status controls.

## Components

### Buttons

- **Primary:** Deep sage, warm text, 14px corners, and a visibly pressed active state.
- **Tool:** Transparent or lightly paper-tinted, at least 44px square, with Lucide icons in a consistent stroke weight.
- **Focus:** A 3px deep-sage outline with clear separation from the component edge.
- **Disabled:** Reduced opacity with the shape and label preserved.

### Chips

- **Connection chip:** A paper-colored, fully rounded status action. Connected state shifts to a pale sage rather than introducing a new success green.

### Cards / Containers

- **Grid:** Warm paper with quiet 32px sage lines and subtle fiber variation; it extends edge to edge behind every control.
- **Settings sheet:** Warm paper with 16px corners and a protected-focus backdrop.

### Inputs / Fields

- **Style:** Warm white fill, one-pixel warm-gray stroke, 10px corners, and 48px height.
- **Focus:** Shared 3px deep-sage outline.

### Navigation

The tool rail is the sole navigation surface. Groups are separated by fine tonal dividers; on narrow screens it reflows into two rows without horizontal scrolling.

### Color Wells

Round 56px swatches shrink responsively to 34–43px. The active well gains a warm-paper outline and a slightly stronger ambient shadow.

## Do's and Don'ts

### Do:

- **Do** keep the drawing paper as the largest and brightest surface.
- **Do** express actions through consistent line icons and plain-language labels.
- **Do** preserve downward, ambient depth and lightly varied paper/paint texture.
- **Do** let status copy sound like a quiet drawing partner.

### Don't:

- **Don't** add a closed paper boundary, frame, plants, lamps, shelves, wall art, flooring, or any surrounding room scene.
- **Don't** turn the experience into a dashboard, landing page, or professional editor shell.
- **Don't** use gradient text, emoji icons, generic app-blue, glass panels, or decorative badges.
- **Don't** let the AI action overpower the paper or obscure a drawing.
