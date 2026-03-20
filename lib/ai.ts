import { z } from "zod";
import { drawRequestSchema } from "@/lib/draw-types";

type DrawRequest = z.infer<typeof drawRequestSchema>;

const rawPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

const rawAssistantEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stroke"),
    color: z.string(),
    size: z.number().positive().max(24),
    opacity: z.number().min(0.05).max(1).optional(),
    label: z.string().max(80).optional(),
    timing: z
      .object({
        speed: z.number().min(0.2).max(3).optional(),
        pauseAfterMs: z.number().int().min(0).max(1200).optional()
      })
      .optional(),
    points: z.array(rawPointSchema).min(2).max(64)
  }),
  z.object({
    type: z.literal("comment_reply"),
    commentId: z.string(),
    text: z.string().max(280)
  })
]);

const assistantPlanSchema = z.object({
  thinking: z.string().max(240),
  say: z.string().max(240),
  summary: z.string().max(240),
  events: z.array(rawAssistantEventSchema).max(18)
});

const plannerPointSchema = z.tuple([z.number().finite(), z.number().finite()]);

const plannerActionSchema = z.object({
  tool: z.literal("brush"),
  color: z.string(),
  width: z.number().positive().max(24),
  opacity: z.number().min(0.05).max(1),
  points: z.array(plannerPointSchema).min(2).max(24),
  timing: z
    .object({
      speed: z.number().min(0.2).max(3).optional(),
      pauseAfterMs: z.number().int().min(0).max(1200).optional()
    })
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  intent: z.string().max(80).optional()
});

const plannerResponseSchema = z.object({
  scene: z.string().max(120).optional(),
  approach: z.string().max(160).optional(),
  why: z.string().max(200).optional(),
  actions: z.array(plannerActionSchema).max(14).default([])
});

export type RawAssistantPlan = z.infer<typeof assistantPlanSchema>;

type PlannerAction = z.infer<typeof plannerActionSchema>;
type JsonObject = Record<string, unknown>;

function getGeminiConfig() {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"
  };
}

function stripCodeFence(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function splitDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("Canvas snapshot must be a base64 image data URL.");
  }

  return {
    mimeType: match[1],
    data: match[2]
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampleEvery<T>(values: T[], maxCount: number) {
  if (values.length <= maxCount) {
    return values;
  }

  const sampled: T[] = [];
  const lastIndex = values.length - 1;
  for (let index = 0; index < maxCount; index += 1) {
    const sourceIndex = Math.round((index / Math.max(1, maxCount - 1)) * lastIndex);
    sampled.push(values[sourceIndex]);
  }

  return sampled;
}

function normalizePaletteColor(color: unknown, palette: string[]) {
  if (typeof color === "string" && palette.includes(color)) {
    return color;
  }

  if (typeof color === "string" && palette.length > 0) {
    return palette[hashString(color) % palette.length];
  }

  return palette[0] ?? "#262523";
}

function normalizePlannerPoint(value: unknown, input: DrawRequest) {
  if (Array.isArray(value) && value.length >= 2) {
    return [
      Math.round(clamp(clampFiniteNumber(value[0], input.canvasWidth * 0.5), 0, input.canvasWidth)),
      Math.round(clamp(clampFiniteNumber(value[1], input.canvasHeight * 0.5), 0, input.canvasHeight))
    ] as [number, number];
  }

  if (isJsonObject(value)) {
    return [
      Math.round(clamp(clampFiniteNumber(value.x, input.canvasWidth * 0.5), 0, input.canvasWidth)),
      Math.round(clamp(clampFiniteNumber(value.y, input.canvasHeight * 0.5), 0, input.canvasHeight))
    ] as [number, number];
  }

  return null;
}

function normalizePlannerAction(value: unknown, input: DrawRequest) {
  if (!isJsonObject(value)) {
    return null;
  }

  const toolValue = typeof value.tool === "string" ? value.tool : "brush";
  if (!["brush", "stroke", "pen", "pencil"].includes(toolValue)) {
    return null;
  }

  const rawPoints = Array.isArray(value.points)
    ? value.points
    : Array.isArray(value.path)
      ? value.path
      : [];

  const points = sampleEvery(
    rawPoints
      .map((point) => normalizePlannerPoint(point, input))
      .filter((point): point is [number, number] => point !== null),
    16
  );

  if (points.length < 2) {
    return null;
  }

  const action: PlannerAction = {
    tool: "brush",
    color: normalizePaletteColor(value.color, input.palette),
    width: clamp(clampFiniteNumber(value.width, 4), 1.5, 14),
    opacity: clamp(clampFiniteNumber(value.opacity, 0.92), 0.12, 1),
    points,
    timing: {
      speed: clamp(clampFiniteNumber(isJsonObject(value.timing) ? value.timing.speed : undefined, 1), 0.45, 2.2),
      pauseAfterMs: Math.round(
        clamp(
          clampFiniteNumber(isJsonObject(value.timing) ? value.timing.pauseAfterMs : undefined, 90),
          0,
          700
        )
      )
    },
    confidence:
      typeof value.confidence === "number" && Number.isFinite(value.confidence)
        ? clamp(value.confidence, 0, 1)
        : undefined,
    intent:
      typeof value.intent === "string" && value.intent
        ? value.intent.slice(0, 80)
        : undefined
  };

  return plannerActionSchema.parse(action);
}

function extractPlannerRoot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return { actions: value };
  }

  if (!isJsonObject(value)) {
    return value;
  }

  if (Array.isArray(value.actions)) {
    return value;
  }

  if (Array.isArray(value.strokes)) {
    return { actions: value.strokes };
  }

  if (Array.isArray(value.brushActions)) {
    return { actions: value.brushActions };
  }

  if ("plan" in value) {
    return extractPlannerRoot(value.plan);
  }

  if ("response" in value) {
    return extractPlannerRoot(value.response);
  }

  if ("result" in value) {
    return extractPlannerRoot(value.result);
  }

  if ("data" in value) {
    return extractPlannerRoot(value.data);
  }

  return value;
}

function sanitizePlannerResponse(value: unknown, input: DrawRequest) {
  const root = extractPlannerRoot(value);
  if (!isJsonObject(root)) {
    return { actions: [] };
  }

  const rawActions = Array.isArray(root.actions) ? root.actions : [];
  return {
    scene:
      typeof root.scene === "string" && root.scene.trim()
        ? root.scene.trim().slice(0, 120)
        : undefined,
    approach:
      typeof root.approach === "string" && root.approach.trim()
        ? root.approach.trim().slice(0, 160)
        : undefined,
    why:
      typeof root.why === "string" && root.why.trim()
        ? root.why.trim().slice(0, 200)
        : undefined,
    actions: rawActions
      .map((action) => normalizePlannerAction(action, input))
      .filter((action): action is PlannerAction => action !== null)
      .slice(0, 12)
  };
}

function extractJsonStringField(rawText: string, field: "scene" | "approach" | "why") {
  const match = rawText.match(
    new RegExp(`"${field}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`)
  );
  if (!match?.[1]) {
    return undefined;
  }

  try {
    const value = JSON.parse(match[1]);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function extractMetadataFromRawText(rawText: string) {
  return {
    scene: extractJsonStringField(rawText, "scene"),
    approach: extractJsonStringField(rawText, "approach"),
    why: extractJsonStringField(rawText, "why")
  };
}

function salvageActionsFromTruncatedRaw(rawText: string, input: DrawRequest) {
  const actionsKeyIndex = rawText.indexOf('"actions"');
  if (actionsKeyIndex < 0) {
    return [];
  }

  const arrayStart = rawText.indexOf("[", actionsKeyIndex);
  if (arrayStart < 0) {
    return [];
  }

  const salvaged: PlannerAction[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < rawText.length; index += 1) {
    const char = rawText[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        const objectText = rawText.slice(objectStart, index + 1);
        try {
          const parsed = JSON.parse(objectText);
          const normalized = normalizePlannerAction(parsed, input);
          if (normalized) {
            salvaged.push(normalized);
          }
        } catch {
          // Ignore partial or malformed action objects.
        }
        objectStart = -1;
      }
      continue;
    }

    if (char === "]" && depth === 0) {
      break;
    }
  }

  return salvaged.slice(0, 12);
}

function extractAnchor(input: DrawRequest) {
  for (let index = input.humanDelta.length - 1; index >= 0; index -= 1) {
    const item = input.humanDelta[index];
    if (item.kind === "humanStroke" && item.points.length > 0) {
      const [x, y] = item.points[item.points.length - 1];
      return { x, y };
    }

    if (item.kind === "shape") {
      return { x: item.x, y: item.y };
    }

    if (item.kind === "asciiBlock") {
      return { x: item.x, y: item.y };
    }
  }

  return {
    x: Math.round(input.canvasWidth * 0.5),
    y: Math.round(input.canvasHeight * 0.5)
  };
}

function extractHumanBounds(input: DrawRequest) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of input.humanDelta) {
    if (item.kind === "humanStroke") {
      for (const [x, y] of item.points) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      continue;
    }

    if (item.kind === "asciiBlock") {
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + 24);
      maxY = Math.max(maxY, item.y + item.fontSize);
      continue;
    }

    minX = Math.min(minX, item.x - item.width * 0.5);
    minY = Math.min(minY, item.y - item.height * 0.5);
    maxX = Math.max(maxX, item.x + item.width * 0.5);
    maxY = Math.max(maxY, item.y + item.height * 0.5);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function getActionEndpoints(action: PlannerAction) {
  const first = action.points[0];
  const last = action.points[action.points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy);

  return {
    first,
    last,
    dx,
    dy,
    length,
    nx: length > 0 ? dx / length : 0,
    ny: length > 0 ? dy / length : 0
  };
}

function isFragmentedPolylinePlan(actions: PlannerAction[]) {
  if (actions.length < 6) {
    return false;
  }

  const base = getActionEndpoints(actions[0]);
  if (base.length < 20) {
    return false;
  }

  let chainedCount = 0;
  let alignedCount = 0;
  let matchingStyleCount = 0;

  for (let index = 0; index < actions.length; index += 1) {
    const current = actions[index];
    const currentVector = getActionEndpoints(current);

    if (
      current.color === actions[0].color &&
      Math.abs(current.width - actions[0].width) <= 1.5
    ) {
      matchingStyleCount += 1;
    }

    const alignment = currentVector.nx * base.nx + currentVector.ny * base.ny;
    if (alignment > 0.985) {
      alignedCount += 1;
    }

    if (index > 0) {
      const previous = getActionEndpoints(actions[index - 1]);
      const chainDistance = Math.hypot(
        currentVector.first[0] - previous.last[0],
        currentVector.first[1] - previous.last[1]
      );
      if (chainDistance <= 24) {
        chainedCount += 1;
      }
    }
  }

  return (
    matchingStyleCount >= actions.length - 1 &&
    alignedCount >= actions.length - 1 &&
    chainedCount >= actions.length - 2
  );
}

function buildHouseFallbackActions(input: DrawRequest) {
  const bounds = extractHumanBounds(input);
  const accent = input.palette[0] ?? "#262523";

  if (!bounds) {
    return null;
  }

  const chimneyLeft = Math.round(bounds.minX + bounds.width * 0.64);
  const chimneyRight = chimneyLeft + Math.round(clamp(bounds.width * 0.07, 18, 28));
  const chimneyBottom = Math.round(bounds.minY + bounds.height * 0.18);
  const chimneyTop = chimneyBottom - Math.round(clamp(bounds.height * 0.14, 22, 40));
  const smokeX = chimneyLeft + Math.round((chimneyRight - chimneyLeft) * 0.5);

  return [
    plannerActionSchema.parse({
      tool: "brush",
      color: accent,
      width: 4,
      opacity: 0.92,
      points: [
        [chimneyLeft, chimneyBottom],
        [chimneyLeft, chimneyTop],
        [chimneyRight, chimneyTop],
        [chimneyRight, chimneyBottom]
      ],
      timing: { speed: 1, pauseAfterMs: 70 },
      intent: "chimney"
    }),
    plannerActionSchema.parse({
      tool: "brush",
      color: accent,
      width: 3,
      opacity: 0.72,
      points: [
        [smokeX, chimneyTop - 6],
        [smokeX - 10, chimneyTop - 20],
        [smokeX + 8, chimneyTop - 34],
        [smokeX - 4, chimneyTop - 50]
      ],
      timing: { speed: 1.1, pauseAfterMs: 60 },
      intent: "smoke"
    }),
    plannerActionSchema.parse({
      tool: "brush",
      color: accent,
      width: 3,
      opacity: 0.58,
      points: [
        [smokeX + 6, chimneyTop - 16],
        [smokeX + 16, chimneyTop - 30],
        [smokeX + 2, chimneyTop - 46],
        [smokeX + 12, chimneyTop - 62]
      ],
      timing: { speed: 1.05, pauseAfterMs: 90 },
      intent: "smoke"
    })
  ];
}

function buildSceneAwareFallbackActions(
  input: DrawRequest,
  metadata?: {
    scene?: string;
    approach?: string;
    why?: string;
  }
) {
  if (
    includesAny(metadata?.scene, ["house", "building", "home"]) ||
    includesAny(metadata?.approach, ["chimney", "smoke", "roof", "house"])
  ) {
    return buildHouseFallbackActions(input);
  }

  return null;
}

function buildPlannerSystemPrompt(input: DrawRequest) {
  return [
    "You are collaborating on a live whiteboard drawing.",
    "Return only strict JSON.",
    'Return exactly this shape: {"scene":"short scene read","approach":"what you decided to add","why":"why these additions fit","actions":[{"tool":"brush","color":"#RRGGBB","width":4,"opacity":0.9,"points":[[120,80],[125,84]],"timing":{"speed":1,"pauseAfterMs":120}}]}.',
    "Do not return markdown. Do not explain yourself. Do not include prose outside JSON.",
    "First identify the main subject, scene, or visual motif already present in the drawing from the image and recent marks.",
    "Then draw actual relevant things that belong with that scene.",
    "Do not merely add decorative accent strokes, edge tracing, or abstract filler when the scene is recognizable.",
    "At least one addition should be a recognizable object, environmental element, or contextual detail whenever the scene is identifiable.",
    "Use multiple stroke actions to build each added thing when needed.",
    "Add more than a tiny accent when the canvas is sparse or has lots of open space.",
    "Usually return between 4 and 8 actions. If the drawing is sparse and there is lots of room, you may return up to 10 actions. If it is already dense, return between 2 and 5 actions.",
    "Each action must use tool=brush.",
    "Each action should contain between 2 and 12 points whenever possible, and never more than 24.",
    "Use sparse anchor points only. Do not output pixel-by-pixel or grid-step coordinate sequences.",
    "The renderer smooths between points, so long lines and curves should use only a few control points.",
    "Stay within canvas bounds.",
    "Do not dominate the canvas or redraw the whole scene.",
    "Prefer relevant additions that fit what you identified: environment, supporting objects, props, small characters, shadows, weather, foliage, or setting details.",
    "If you identify a house or building, prefer path, grass, clouds, sun, tree, shrubs, fence, smoke, mailbox, or roof details.",
    "If you identify a landscape, prefer clouds, birds, hills, water lines, sun, moon, stars, trees, or shoreline.",
    "If you identify a face or character, prefer hair, shoulders, hat, glasses, hands, props, pet, or small background details.",
    "If you identify an isolated object, prefer a shadow, ground line, table, container, companion object, or environment around it.",
    "If the drawing is abstract, continue the rhythm and structure with matching marks.",
    `Only use these palette colors exactly: ${input.palette.join(", ")}.`
  ].join(" ");
}

function buildPlannerUserPayload(input: DrawRequest) {
  const targetComment =
    input.mode === "comment" && input.targetCommentId
      ? input.comments.find((comment) => comment.id === input.targetCommentId) ?? null
      : null;

  return JSON.stringify(
    {
      mode: input.mode,
      collaborationMode: null,
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      palette: input.palette,
      recentHumanMarks: input.humanDelta,
      recentAiMarks: input.aiDelta,
      recentTurnHistory: input.turnHistory.slice(-4).map((entry) => ({
        role: entry.role,
        summary: entry.summary
      })),
      targetComment:
        targetComment
          ? {
              id: targetComment.id,
              x: targetComment.x,
              y: targetComment.y,
              text: targetComment.text
            }
          : null
    },
    null,
    2
  );
}

function buildRepairSystemPrompt() {
  return [
    "You repair malformed JSON for a live drawing stroke planner.",
    "Return only strict JSON.",
    'The required shape is {"scene":"short scene read","approach":"what you decided to add","why":"why these additions fit","actions":[{"tool":"brush","color":"#RRGGBB","width":4,"opacity":0.9,"points":[[120,80],[125,84]],"timing":{"speed":1,"pauseAfterMs":120}}]}.',
    "Do not add explanations. Do not use markdown.",
    "If the source cannot be repaired, return {\"actions\":[]}."
  ].join(" ");
}

function buildRepairUserPayload(rawResponse: string, input: DrawRequest) {
  return JSON.stringify(
    {
      instructions: "Repair this into strict drawing planner JSON.",
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      palette: input.palette,
      originalResponse: rawResponse
    },
    null,
    2
  );
}

async function callGeminiJson(options: {
  gemini: NonNullable<ReturnType<typeof getGeminiConfig>>;
  systemText: string;
  userText: string;
  imageDataUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}) {
  const parts: Array<
    | {
        text: string;
      }
    | {
        inlineData: {
          mimeType: string;
          data: string;
        };
      }
  > = [
    {
      text: options.userText
    }
  ];

  if (options.imageDataUrl) {
    const image = splitDataUrl(options.imageDataUrl);
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data
      }
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${options.gemini.model}:generateContent?key=${options.gemini.apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: options.systemText
            }
          ]
        },
        generationConfig: {
          temperature: options.temperature ?? 0.28,
          responseMimeType: "application/json",
          maxOutputTokens: options.maxOutputTokens ?? 2048
        },
        contents: [
          {
            role: "user",
            parts
          }
        ]
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed with ${response.status}${errorText ? `: ${errorText}` : "."}`
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  const rawText =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!rawText) {
    throw new Error("Gemini returned an empty planner response.");
  }

  return rawText;
}

function parsePlannerResponse(rawText: string, input: DrawRequest) {
  const cleaned = stripCodeFence(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const sanitized = sanitizePlannerResponse(parsed, input);
    const response = plannerResponseSchema.parse(sanitized);

    if (response.actions.length === 0) {
      throw new Error("Planner returned no valid actions.");
    }

    return response;
  } catch (error) {
    const metadata = extractMetadataFromRawText(cleaned);
    const salvagedActions = salvageActionsFromTruncatedRaw(cleaned, input);
    if (salvagedActions.length > 0) {
      return plannerResponseSchema.parse({
        ...metadata,
        actions: salvagedActions
      });
    }

    throw error;
  }
}

function summarizePlannerActions(
  count: number,
  input: DrawRequest,
  scene?: string,
  approach?: string,
  why?: string
) {
  if (scene && approach && why) {
    return `AI read the drawing as ${scene} and added ${approach} because ${why}.`;
  }

  if (scene && approach) {
    return `AI read the drawing as ${scene} and added ${approach}.`;
  }

  const scenePrefix = scene ? `AI read the drawing as ${scene} and ` : "AI ";
  if (input.mode === "comment") {
    return count === 1
      ? `${scenePrefix}replied with 1 collaborative drawing.`
      : `${scenePrefix}replied with ${count} collaborative drawings.`;
  }

  return count === 1
    ? `${scenePrefix}added 1 collaborative drawing.`
    : `${scenePrefix}added ${count} collaborative drawings.`;
}

function buildPlannerNarration(
  count: number,
  input: DrawRequest,
  scene?: string,
  approach?: string,
  why?: string
) {
  const sceneLead = scene ? `I read this as ${scene}` : "I found the drawing's direction";
  const approachTail = approach ? ` and added ${approach}.` : ".";
  const reasonTail = why ? ` I chose that because ${why}.` : "";
  if (input.mode === "comment") {
    return count <= 1
      ? `${sceneLead} and echoed your note with a small drawing.${reasonTail}`
      : `${sceneLead} and echoed your note with a few small drawings.${reasonTail}`;
  }

  return count <= 1
    ? `${sceneLead} and added one small collaborative drawing${approach ? `, ${approach}.` : "."}${reasonTail}`
    : `${sceneLead}${approachTail}${reasonTail}`;
}

function buildCommentReply(count: number) {
  return count <= 1
    ? "I added a small drawing near your note."
    : `I added ${count} small drawings near your note.`;
}

function actionsToPlan(
  actions: PlannerAction[],
  input: DrawRequest,
  metadata?: {
    scene?: string;
    approach?: string;
    why?: string;
  }
): RawAssistantPlan {
  const strokeEvents = actions.map((action) => ({
    type: "stroke" as const,
    color: action.color,
    size: action.width,
    opacity: action.opacity,
    label: action.intent,
    timing: action.timing,
    points: action.points.map(([x, y]) => ({ x, y }))
  }));

  const commentEvents =
    input.mode === "comment" && input.targetCommentId
      ? [
          {
            type: "comment_reply" as const,
            commentId: input.targetCommentId,
            text: buildCommentReply(actions.length)
          }
        ]
      : [];

  return assistantPlanSchema.parse({
    thinking:
      metadata?.scene && metadata?.approach && metadata?.why
        ? `I read this as ${metadata.scene}. I added ${metadata.approach} because ${metadata.why}.`
        : metadata?.scene && metadata?.approach
          ? `I read this as ${metadata.scene} and decided to add ${metadata.approach}.`
          : metadata?.scene
            ? `I read this as ${metadata.scene} and planned a few matching drawings.`
            : "Planning a few collaborative drawings.",
    say: buildPlannerNarration(
      actions.length,
      input,
      metadata?.scene,
      metadata?.approach,
      metadata?.why
    ),
    summary: summarizePlannerActions(
      actions.length,
      input,
      metadata?.scene,
      metadata?.approach,
      metadata?.why
    ),
    events: [...commentEvents, ...strokeEvents]
  });
}

export function buildFallbackAssistantPlan(
  input: DrawRequest,
  metadata?: {
    scene?: string;
    approach?: string;
    why?: string;
  }
): RawAssistantPlan {
  const anchor = extractAnchor(input);
  const accent = input.palette[1] ?? input.palette[0];
  const support = input.palette[2] ?? accent;
  const sceneAwareActions = buildSceneAwareFallbackActions(input, metadata);

  if (sceneAwareActions) {
    console.info("[draw-ai] using scene-aware fallback drawings");
    return actionsToPlan(sceneAwareActions, input, metadata);
  }

  const actions: PlannerAction[] = [
    plannerActionSchema.parse({
      tool: "brush",
      color: accent,
      width: 5,
      opacity: 0.92,
      points: [
        [anchor.x - 36, anchor.y - 24],
        [anchor.x - 10, anchor.y - 36],
        [anchor.x + 22, anchor.y - 28],
        [anchor.x + 46, anchor.y - 12]
      ],
      timing: {
        speed: 1.05,
        pauseAfterMs: 80
      },
      intent: "accent"
    }),
    plannerActionSchema.parse({
      tool: "brush",
      color: support,
      width: 4,
      opacity: 0.82,
      points: [
        [anchor.x - 44, anchor.y + 28],
        [anchor.x - 16, anchor.y + 34],
        [anchor.x + 18, anchor.y + 36],
        [anchor.x + 52, anchor.y + 30]
      ],
      timing: {
        speed: 0.9,
        pauseAfterMs: 120
      },
      intent: "support"
    }),
    plannerActionSchema.parse({
      tool: "brush",
      color: input.palette[3] ?? support,
      width: 3,
      opacity: 0.72,
      points: [
        [anchor.x - 18, anchor.y - 54],
        [anchor.x - 6, anchor.y - 60],
        [anchor.x + 8, anchor.y - 56],
        [anchor.x + 22, anchor.y - 48]
      ],
      timing: {
        speed: 1.2,
        pauseAfterMs: 60
      },
      intent: "detail"
    })
  ];

  console.info("[draw-ai] using deterministic fallback strokes");
  return actionsToPlan(actions, input, metadata);
}

export async function generateAssistantPlan(
  input: DrawRequest
): Promise<RawAssistantPlan> {
  const gemini = getGeminiConfig();

  if (!gemini) {
    console.info("[draw-ai] Gemini not configured; using fallback strokes");
    return buildFallbackAssistantPlan(input);
  }

  try {
    const rawPlannerResponse = await callGeminiJson({
      gemini,
      systemText: buildPlannerSystemPrompt(input),
      userText: buildPlannerUserPayload(input),
      imageDataUrl: input.snapshotBase64,
      temperature: 0.22,
      maxOutputTokens: 4096
    });

    console.info("[draw-ai] raw planner response", rawPlannerResponse.slice(0, 1200));
    const rawPlannerMetadata = extractMetadataFromRawText(rawPlannerResponse);

    try {
      const planner = parsePlannerResponse(rawPlannerResponse, input);
      if (isFragmentedPolylinePlan(planner.actions)) {
        console.warn("[draw-ai] planner rejected as fragmented polyline");
        return buildFallbackAssistantPlan(input, {
          scene: planner.scene,
          approach: planner.approach,
          why: planner.why
        });
      }
      console.info("[draw-ai] planner accepted", {
        actionCount: planner.actions.length
      });
      return actionsToPlan(planner.actions, input, {
        scene: planner.scene,
        approach: planner.approach,
        why: planner.why
      });
    } catch (validationError) {
      console.warn(
        "[draw-ai] planner validation failed",
        validationError instanceof Error ? validationError.message : validationError
      );
    }

    console.info("[draw-ai] attempting planner repair");
    const repairedPlannerResponse = await callGeminiJson({
      gemini,
      systemText: buildRepairSystemPrompt(),
      userText: buildRepairUserPayload(rawPlannerResponse, input),
      temperature: 0,
      maxOutputTokens: 2048
    });

    console.info("[draw-ai] raw repair response", repairedPlannerResponse.slice(0, 1200));
    const rawRepairMetadata = extractMetadataFromRawText(repairedPlannerResponse);

    try {
      const repairedPlanner = parsePlannerResponse(repairedPlannerResponse, input);
      if (isFragmentedPolylinePlan(repairedPlanner.actions)) {
        console.warn("[draw-ai] repaired planner rejected as fragmented polyline");
        return buildFallbackAssistantPlan(input, {
          scene: repairedPlanner.scene,
          approach: repairedPlanner.approach,
          why: repairedPlanner.why
        });
      }
      console.info("[draw-ai] repaired planner accepted", {
        actionCount: repairedPlanner.actions.length
      });
      return actionsToPlan(repairedPlanner.actions, input, {
        scene: repairedPlanner.scene,
        approach: repairedPlanner.approach,
        why: repairedPlanner.why
      });
    } catch (repairError) {
      console.warn(
        "[draw-ai] planner repair failed",
        repairError instanceof Error ? repairError.message : repairError
      );
      return buildFallbackAssistantPlan(input, {
        scene: rawRepairMetadata.scene ?? rawPlannerMetadata.scene,
        approach: rawRepairMetadata.approach ?? rawPlannerMetadata.approach,
        why: rawRepairMetadata.why ?? rawPlannerMetadata.why
      });
    }
  } catch (error) {
    console.error(
      "[draw-ai] Gemini planner request failed",
      error instanceof Error ? error.message : error
    );
    return buildFallbackAssistantPlan(input);
  }
}
