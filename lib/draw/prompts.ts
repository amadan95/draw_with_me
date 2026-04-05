import {
  type CommentThread,
  type DrawTurnHistory,
  type DrawingSyncState,
  type HumanStroke,
  type PersistedAsciiBlock,
  type PersistedShapeElement
} from "@/lib/draw/elements";
import { type DrawTurnRequest } from "@/lib/draw/protocol";
import { inferCommentIntent, type CommentIntent, getTargetComment } from "@/lib/draw/comments";
import { shapeToPathData } from "@/lib/draw/shapes";
import { getActiveRegionBounds } from "@/lib/draw/rendering";
import {
  getAttachmentCandidates,
  type AttachmentCandidate
} from "@/lib/draw/scene-candidates";

function trimPoints(points: Array<{ x: number; y: number }>, maxPoints = 20) {
  if (points.length <= maxPoints) {
    return points.map((point) => [Math.round(point.x), Math.round(point.y)] as [number, number]);
  }

  const step = Math.max(1, Math.ceil(points.length / maxPoints));
  return points
    .filter((_, index) => index % step === 0)
    .slice(0, maxPoints)
    .map((point) => [Math.round(point.x), Math.round(point.y)] as [number, number]);
}

function serializeHumanStroke(stroke: HumanStroke) {
  return {
    id: stroke.id,
    tool: stroke.tool,
    color: stroke.color,
    size: stroke.size,
    points: trimPoints(stroke.points)
  };
}

function serializeShapeElement(element: PersistedShapeElement) {
  return {
    id: element.id,
    label: element.label,
    shapeKind: element.shape.kind,
    stroke: "stroke" in element.shape ? element.shape.stroke : undefined,
    fill: "fill" in element.shape ? element.shape.fill : undefined,
    strokeWidth:
      "strokeWidth" in element.shape ? element.shape.strokeWidth : undefined,
    pathPreview: shapeToPathData(element.shape).slice(0, 320)
  };
}

function serializeAsciiBlock(block: PersistedAsciiBlock) {
  return {
    id: block.id,
    x: Math.round(block.x),
    y: Math.round(block.y),
    color: block.color,
    fontSize: block.fontSize,
    text: block.text.slice(0, 240)
  };
}

function roundMaybe(value: number | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
}

function serializeEdgeHint(edge: AttachmentCandidate["edgeHints"]["top"]) {
  if (!edge) {
    return null;
  }

  return {
    x1: Math.round(edge.x1),
    y1: Math.round(edge.y1),
    x2: Math.round(edge.x2),
    y2: Math.round(edge.y2),
    angle: roundMaybe(edge.angle, 1),
    length: roundMaybe(edge.length, 1)
  };
}

function serializeAttachmentCandidate(candidate: AttachmentCandidate) {
  return {
    id: candidate.id,
    source: candidate.source,
    label: candidate.label,
    shapeKind: candidate.shapeKind,
    recentRank: candidate.recentRank,
    minX: Math.round(candidate.minX),
    minY: Math.round(candidate.minY),
    maxX: Math.round(candidate.maxX),
    maxY: Math.round(candidate.maxY),
    width: Math.round(candidate.width),
    height: Math.round(candidate.height),
    centroid: {
      x: Math.round(candidate.centroid.x),
      y: Math.round(candidate.centroid.y)
    },
    density: roundMaybe(candidate.density),
    pointCount: candidate.pointCount,
    orientationHints: {
      dominantAxis: candidate.orientationHints.dominantAxis,
      dominantAngle: roundMaybe(candidate.orientationHints.dominantAngle, 1),
      aspectRatio: roundMaybe(candidate.orientationHints.aspectRatio),
      hasRoofLikePeak: candidate.orientationHints.hasRoofLikePeak,
      hasClosedBody: candidate.orientationHints.hasClosedBody
    },
    edgeHints: {
      top: serializeEdgeHint(candidate.edgeHints.top),
      right: serializeEdgeHint(candidate.edgeHints.right),
      bottom: serializeEdgeHint(candidate.edgeHints.bottom),
      left: serializeEdgeHint(candidate.edgeHints.left)
    }
  };
}

function serializeHistory(history: DrawTurnHistory[]) {
  return history.slice(-10).map((entry) => ({
    who: entry.who,
    description: entry.description,
    commentSummary: entry.commentSummary,
    shapeCount: entry.shapes?.length ?? 0,
    blockCount: entry.blocks?.length ?? 0
  }));
}

function serializeComments(comments: CommentThread[], targetCommentId?: string) {
  return comments.slice(-12).map((comment) => ({
    id: comment.id,
    x: Math.round(comment.x),
    y: Math.round(comment.y),
    status: comment.status,
    isTarget: comment.id === targetCommentId,
    thread: comment.thread.slice(-4).map((message) => ({
      author: message.author,
      text: message.text
    }))
  }));
}

function serializeFullState(elements: DrawingSyncState | undefined) {
  if (!elements) {
    return null;
  }

  return {
    humanStrokes: elements.humanStrokes.slice(-18).map(serializeHumanStroke),
    drawingElements: elements.drawingElements
      .slice(-18)
      .map(serializeShapeElement),
    asciiBlocks: elements.asciiBlocks.slice(-12).map(serializeAsciiBlock)
  };
}

export function getRequestedCommentIntent(input: DrawTurnRequest): CommentIntent {
  if (input.drawMode !== "comment") {
    return "draw";
  }

  return inferCommentIntent(getTargetComment(input.comments, input.targetCommentId));
}

export function buildDrawSystemPrompt(input: DrawTurnRequest) {
  const commentIntent = getRequestedCommentIntent(input);

  return [
    "You are a live collaborative drawing partner inside a shared sketch app.",
    "Study the full raster canvas snapshot first. If a focus image is provided, use it as a zoomed-in local view of the active region. Then use structured state and diff as supporting context.",
    "Preserve the human composition. Prefer small, coherent, context-aware additions.",
    "Return strict JSON only. No markdown. No prose outside JSON.",
    "The JSON shape is:",
    '{"interactionStyle":"collaborative","thinking":"short status","previewSaw":"what you noticed","previewDrawing":"what you plan to add","narration":"short live narration","summary":"turn summary","setPaletteIndex":1,"events":[{"type":"relation_shape","relation":{"hostCandidateId":"candidate-1","placementMode":"attach","anchor":"top-edge","primitive":"rect","sizeRatio":0.18,"aspectRatio":0.6,"style":{"stroke":"#0069d3","strokeWidth":4}}},{"type":"shape","shape":{"kind":"polygon","points":[[120,180],[150,140],[190,182]],"stroke":"#0069d3","strokeWidth":4}},{"type":"block","block":{"x":220,"y":120,"text":"nice","fontSize":18,"color":"#262523"}},{"type":"say","text":"...","sayX":120,"sayY":80},{"type":"dismiss","threadId":"comment-1"}]}',
    "Allowed event types inside events are relation_shape, shape, block, say, set_palette, and dismiss.",
    "Allowed shape kinds are path, line, curve, circle, ellipse, rect, polygon, and erase.",
    "Default to relation_shape when the addition belongs to an existing mark, host object, edge, side, corner, or interior region.",
    "Use raw shape only when the addition is genuinely free-floating, abstract, or not meaningfully attached to a host candidate.",
    "For relation_shape events, provide a relation object with hostCandidateId, placementMode, anchor, primitive, sizeRatio, and optional aspectRatio, offset, rotationHint, style, semanticRole, or label.",
    'Valid anchors are exactly: "center", "top-edge", "bottom-edge", "left-edge", "right-edge", "top-left-corner", "top-right-corner", "bottom-left-corner", "bottom-right-corner", "upper-half", and "lower-half". Do not invent aliases like "interior". Use "center" for interior placement.',
    'If you include offset, offset.x and offset.y must be small normalized values between -1 and 1, not pixel coordinates.',
    "For shape events, shape must be a raw geometry primitive only. Do not include client persistence fields like id, createdAt, kind:shapeElement, source, or nested shape wrappers.",
    "For block events, block must contain x, y, text, fontSize, color, and optional width or label. Do not include id, createdAt, kind, or source.",
    "Prefer compact geometric primitives like line, curve, polygon, circle, rect, and ellipse over giant raw path strings.",
    "Use absolute canvas coordinates in the current canvas coordinate space.",
    "Prefer placing new geometry inside or very near the provided activeRegion unless there is a strong reason not to.",
    "If you are adding a part of an existing object, choose a hostCandidateId and make the relation explicit instead of inventing final coordinates directly.",
    "If you are adding a part of an existing object, the new geometry must visibly attach to, sit inside, overlap, or sit immediately adjacent to the host structure rather than floating nearby.",
    "Use the provided attachmentCandidates as inferred host-structure hints from recent geometry. They include bounds, centroid, edgeHints, and orientationHints. Prefer one of those candidate ids whenever you are drawing a part-like addition.",
    "Use edgeHints and orientationHints when choosing anchors. For example, roof-like peaks or sloped top edges usually imply top-edge or top-corner attachment, not a detached free-floating addition.",
    "If no host candidate looks convincing, prefer a short say event or one tiny free-floating detail instead of forcing a detached addition.",
    "Do not place semantic parts in empty space just because they are near the correct object category.",
    "Scale new geometry relative to the activeRegion. Avoid additions that are dramatically larger than the activeRegion.",
    "Clamp geometry to the visible canvas and keep outputs between 1 and 8 visual actions.",
    "Do not redraw the whole scene. Do not erase human work unless explicitly asked.",
    "Use the supplied palette colors when choosing strokes and fills.",
    commentIntent === "reply"
      ? "This is a comment reply turn. Reply in text first. You may skip drawing entirely unless the comment explicitly asks for a visual addition."
      : "This turn may include drawing. If a comment is targeted, anchor any local addition near that comment when it helps. Prefer modifying or attaching to the nearest existing structure instead of inventing detached decoration.",
    "Keep text short, playful, and collaborative when appropriate, but do not narrate every obvious action.",
    "If you are unsure, emit a short say event and zero or one tiny visual action rather than a large guess."
  ].join(" ");
}

export function buildDrawUserPayload(input: DrawTurnRequest) {
  const targetComment = getTargetComment(input.comments, input.targetCommentId);
  const fallbackBounds = {
    minX: 0,
    minY: 0,
    maxX: input.canvasWidth,
    maxY: input.canvasHeight,
    width: input.canvasWidth,
    height: input.canvasHeight
  };
  const activeRegion = getActiveRegionBounds({
    syncState: input.elements,
    targetComment,
    fallbackBounds,
    padding: 120
  });

  const attachmentCandidates = getAttachmentCandidates({
    syncState: input.elements,
    targetComment,
    limit: 8
  });

  return JSON.stringify(
    {
      request: {
        drawMode: input.drawMode,
        commentIntent: getRequestedCommentIntent(input),
        turnCount: input.turnCount,
        canvas: {
          width: input.canvasWidth,
          height: input.canvasHeight
        },
        images: {
          fullBoard: true,
          focusRegion: Boolean(input.focusImage)
        },
        palette: {
          index: input.paletteIndex,
          colors: input.paletteColors
        },
        activeRegion: {
          minX: Math.round(activeRegion.minX),
          minY: Math.round(activeRegion.minY),
          maxX: Math.round(activeRegion.maxX),
          maxY: Math.round(activeRegion.maxY),
          width: Math.round(activeRegion.width),
          height: Math.round(activeRegion.height)
        },
        targetComment: targetComment
          ? {
              id: targetComment.id,
              x: Math.round(targetComment.x),
              y: Math.round(targetComment.y),
              status: targetComment.status,
              thread: targetComment.thread.slice(-4).map((message) => ({
                author: message.author,
                text: message.text
              }))
            }
          : null,
        attachmentCandidates: attachmentCandidates.map(serializeAttachmentCandidate)
      },
      history: serializeHistory(input.history),
      comments: serializeComments(input.comments, input.targetCommentId),
      structuredState: serializeFullState(input.elements),
      diff: input.diff
        ? {
            humanStrokes: {
              created: input.diff.humanStrokes.created.slice(-10).map(serializeHumanStroke),
              modified: input.diff.humanStrokes.modified.slice(-6).map(serializeHumanStroke),
              deleted: input.diff.humanStrokes.deleted.slice(-10)
            },
            drawingElements: {
              created: input.diff.drawingElements.created.slice(-10).map(serializeShapeElement),
              modified: input.diff.drawingElements.modified.slice(-6).map(serializeShapeElement),
              deleted: input.diff.drawingElements.deleted.slice(-10)
            },
            asciiBlocks: {
              created: input.diff.asciiBlocks.created.slice(-10).map(serializeAsciiBlock),
              modified: input.diff.asciiBlocks.modified.slice(-6).map(serializeAsciiBlock),
              deleted: input.diff.asciiBlocks.deleted.slice(-10)
            }
          }
        : null
    },
    null,
    2
  );
}
