import { type CommentThread } from "@/lib/draw/elements";

const drawIntentWords = [
  "draw",
  "add",
  "sketch",
  "put",
  "place",
  "make",
  "turn this into",
  "around here",
  "on the canvas",
  "show me"
];

export type CommentIntent = "reply" | "draw";

export function getTargetComment(comments: CommentThread[], targetCommentId?: string) {
  if (!targetCommentId) {
    return null;
  }

  return comments.find((comment) => comment.id === targetCommentId) ?? null;
}

export function inferCommentIntent(comment: CommentThread | null): CommentIntent {
  if (!comment) {
    return "reply";
  }

  const latestUserMessage = [...comment.thread]
    .reverse()
    .find((message) => message.author === "user");
  const text = (latestUserMessage?.text ?? comment.text).toLowerCase();

  return drawIntentWords.some((word) => text.includes(word)) ? "draw" : "reply";
}
