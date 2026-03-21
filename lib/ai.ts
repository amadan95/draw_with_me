import { z } from "zod";
import {
  createId,
  drawRequestSchema,
  objectBoundingBoxSchema,
  objectFamilySchema,
  placementRelationSchema,
  sceneAdditionSchema,
  sceneAnalysisSchema,
  sceneSubjectSchema,
  type ObjectBoundingBox,
  type ObjectFamily,
  type PlacementRelation,
  type SceneAddition,
  type SceneAnalysis,
  type SceneSubject
} from "@/lib/draw-types";

type DrawRequest = z.infer<typeof drawRequestSchema>;
type JsonObject = Record<string, unknown>;

const relationValues = placementRelationSchema.options;

class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GeminiRequestError";
    this.status = status;
  }
}

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

function includesAny(text: string | undefined, needles: string[]) {
  if (!text) {
    return false;
  }

  const haystack = text.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRoot(value: unknown): unknown {
  if (!isJsonObject(value)) {
    return value;
  }

  if ("analysis" in value) {
    return extractRoot(value.analysis);
  }

  if ("result" in value) {
    return extractRoot(value.result);
  }

  if ("response" in value) {
    return extractRoot(value.response);
  }

  if ("data" in value) {
    return extractRoot(value.data);
  }

  return value;
}

function extractJsonStringField(rawText: string, field: string) {
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

function normalizeFamily(
  value: unknown,
  fallbackText = "",
  mode: "subject" | "addition" = "addition"
): ObjectFamily | null {
  const raw = typeof value === "string" ? value : "";
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (normalized) {
    return objectFamilySchema.parse(normalized.slice(0, 80));
  }

  const fallback = fallbackText.trim().toLowerCase().replace(/\s+/g, " ");
  if (fallback) {
    return objectFamilySchema.parse(fallback.slice(0, 80));
  }

  if (mode === "addition") {
    return "detail";
  }

  return null;
}

function extractHumanBounds(input: DrawRequest) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const pushPoint = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const item of input.humanDelta) {
    if (item.kind === "humanStroke") {
      if (item.tool === "erase") {
        continue;
      }
      for (const [x, y] of item.points) {
        pushPoint(x, y);
      }
      continue;
    }

    if (item.kind === "asciiBlock") {
      pushPoint(item.x, item.y);
      continue;
    }

    pushPoint(item.x - item.width * 0.5, item.y - item.height * 0.5);
    pushPoint(item.x + item.width * 0.5, item.y + item.height * 0.5);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    const width = input.canvasWidth * 0.42;
    const height = input.canvasHeight * 0.34;
    return {
      minX: input.canvasWidth * 0.5 - width * 0.5,
      minY: input.canvasHeight * 0.5 - height * 0.55,
      maxX: input.canvasWidth * 0.5 + width * 0.5,
      maxY: input.canvasHeight * 0.5 + height * 0.45,
      width,
      height
    };
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

function normalizeBoundingBox(
  value: unknown,
  input: DrawRequest,
  fallback: ObjectBoundingBox
): ObjectBoundingBox {
  if (!isJsonObject(value)) {
    return objectBoundingBoxSchema.parse(fallback);
  }

  const width = clamp(clampFiniteNumber(value.width, fallback.width), 20, input.canvasWidth * 0.9);
  const height = clamp(clampFiniteNumber(value.height, fallback.height), 20, input.canvasHeight * 0.9);
  const x = clamp(clampFiniteNumber(value.x, fallback.x), 0, Math.max(0, input.canvasWidth - width));
  const y = clamp(clampFiniteNumber(value.y, fallback.y), 0, Math.max(0, input.canvasHeight - height));

  return objectBoundingBoxSchema.parse({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  });
}

function preferredTargetFamilies(family: ObjectFamily): ObjectFamily[] {
  if (includesAny(family, ["chimney", "flue", "stack"])) {
    return ["house"];
  }
  if (includesAny(family, ["path", "walkway", "trail", "road", "sidewalk"])) {
    return ["house"];
  }
  if (includesAny(family, ["smoke", "steam", "plume"])) {
    return ["chimney", "house"];
  }
  if (includesAny(family, ["grass", "bush", "flower", "fence", "hedge", "shrub"])) {
    return ["house", "tree", "hill"];
  }
  if (includesAny(family, ["tree"])) {
    return ["house", "hill"];
  }
  if (includesAny(family, ["mailbox", "porch", "lamp", "bench", "sign"])) {
      return ["house"];
  }

  return [];
}

function inferRelation(
  family: ObjectFamily,
  raw: unknown,
  target: SceneSubject | null
): PlacementRelation {
  if (typeof raw === "string" && relationValues.includes(raw as PlacementRelation)) {
    return raw as PlacementRelation;
  }

  if (includesAny(family, ["chimney", "antenna", "flag", "satellite"])) {
    return "attach_roof_right";
  }
  if (includesAny(family, ["smoke", "cloud", "bird", "kite"])) {
    return target ? "sky_above" : "sky_above_right";
  }
  if (includesAny(family, ["sun", "balloon"])) {
    return "sky_above_right";
  }
  if (includesAny(family, ["moon", "star"])) {
    return "sky_above_left";
  }
  if (includesAny(family, ["grass", "fence", "path", "water", "hill", "pond", "river"])) {
    return "ground_front";
  }
  if (includesAny(family, ["bush", "flower", "shrub", "hedge", "garden"])) {
    return target ? "ground_right" : "ground_front";
  }
  if (includesAny(family, ["tree", "house", "mailbox", "bench", "lamp", "sign"])) {
    return "beside_right";
  }

  return "around_subject";
}

function normalizeSubject(
  value: unknown,
  input: DrawRequest,
  index: number
): SceneSubject | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const family = normalizeFamily(
    value.family ?? value.label ?? value.type ?? value.name,
    `${value.label ?? ""}`,
    "subject"
  );
  if (!family) {
    return null;
  }

  const humanBounds = extractHumanBounds(input);
  const fallbackWidth = clamp(humanBounds.width * 0.36, 60, input.canvasWidth * 0.5);
  const fallbackHeight = clamp(humanBounds.height * 0.34, 60, input.canvasHeight * 0.5);
  const fallbackX = clamp(
    humanBounds.minX + humanBounds.width * 0.5 - fallbackWidth * 0.5,
    0,
    Math.max(0, input.canvasWidth - fallbackWidth)
  );
  const fallbackY = clamp(
    humanBounds.minY + humanBounds.height * 0.5 - fallbackHeight * 0.5,
    0,
    Math.max(0, input.canvasHeight - fallbackHeight)
  );

  return sceneSubjectSchema.parse({
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim().slice(0, 64)
        : createId(`subject-${index + 1}`),
    family,
    label:
      typeof value.label === "string" && value.label.trim()
        ? value.label.trim().slice(0, 80)
        : family,
    bbox: normalizeBoundingBox(value.bbox, input, {
      x: fallbackX,
      y: fallbackY,
      width: fallbackWidth,
      height: fallbackHeight
    })
  });
}

function normalizeAddition(
  value: unknown,
  subjects: SceneSubject[],
  index: number
): SceneAddition | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const family = normalizeFamily(
    value.family ?? value.label ?? value.type ?? value.name,
    `${value.reason ?? ""}`,
    "addition"
  );
  if (!family) {
    return null;
  }

  let targetSubject =
    typeof value.targetSubjectId === "string"
      ? subjects.find((subject) => subject.id === value.targetSubjectId) ?? null
      : null;

  if (!targetSubject) {
    const preferred = preferredTargetFamilies(family);
    for (const preferredFamily of preferred) {
      const match = subjects.find((subject) => subject.family === preferredFamily);
      if (match) {
        targetSubject = match;
        break;
      }
    }
  }

  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 160)
      : `adds ${family} to the scene`;

  return sceneAdditionSchema.parse({
    id:
      typeof value.id === "string" && value.id.trim()
        ? value.id.trim().slice(0, 64)
        : createId(`addition-${index + 1}`),
    family,
    targetSubjectId: targetSubject?.id,
    relation: inferRelation(family, value.relation, targetSubject),
    reason,
    priority: Math.round(clamp(clampFiniteNumber(value.priority, index + 1), 1, 9))
  });
}

function sanitizeSceneAnalysis(value: unknown, input: DrawRequest): SceneAnalysis {
  const root = extractRoot(value);
  if (!isJsonObject(root)) {
    return sceneAnalysisSchema.parse({
      scene: "current sketch",
      why: "I could not read the scene reliably enough to choose a confident addition.",
      subjects: [],
      additions: []
    });
  }

  const rawSubjects = Array.isArray(root.subjects)
    ? root.subjects
    : Array.isArray(root.objects)
      ? root.objects
      : Array.isArray(root.sceneObjects)
        ? root.sceneObjects
        : [];

  const subjects = rawSubjects
    .map((item, index) => normalizeSubject(item, input, index))
    .filter((item): item is SceneSubject => item !== null)
    .slice(0, 12);

  const rawAdditions = Array.isArray(root.additions)
    ? root.additions
    : Array.isArray(root.proposals)
      ? root.proposals
      : Array.isArray(root.suggestions)
        ? root.suggestions
        : [];

  const additions = rawAdditions
    .map((item, index) => normalizeAddition(item, subjects, index))
    .filter((item): item is SceneAddition => item !== null)
    .slice(0, 5);

  return sceneAnalysisSchema.parse({
    scene:
      typeof root.scene === "string" && root.scene.trim()
        ? root.scene.trim().slice(0, 160)
        : "current sketch",
    why:
      typeof root.why === "string" && root.why.trim()
        ? root.why.trim().slice(0, 200)
        : "it has room for a small related addition",
    subjects,
    additions
  });
}

function buildFallbackSceneAnalysis(reason?: string): SceneAnalysis {
  return sceneAnalysisSchema.parse({
    scene: "current sketch",
    why: reason ?? "I could not read the scene reliably enough to choose a confident addition.",
    subjects: [],
    additions: []
  });
}

function buildAnalysisSystemPrompt(input: DrawRequest) {
  return [
    "You analyze a live collaborative whiteboard drawing.",
    "Return only strict JSON.",
    'Return exactly this shape: {"scene":"house with trees","why":"why the scene reads this way","subjects":[{"id":"subj_house_1","family":"house","label":"house","bbox":{"x":220,"y":180,"width":260,"height":240}}],"additions":[{"id":"add_1","family":"chimney","targetSubjectId":"subj_house_1","relation":"attach_roof_right","reason":"adds a lived-in roof detail","priority":1}]}.',
    "Do not return markdown, explanations, or stroke geometry.",
    "family is a short object label like chimney, mailbox, porch light, hedge, cat, pond, fence, cloud, or flag.",
    `relation must be one of: ${relationValues.join(", ")}.`,
    "subjects are things already present in the user's drawing.",
    "additions are 1 to 5 new objects or scene elements that fit naturally in the picture.",
    "Use more additions when the page is sparse or when several small related details belong together.",
    "Use targetSubjectId when the addition belongs to a specific subject.",
    "Choose a relation that describes placement semantically, not numerically.",
    input.mode === "comment"
      ? "If there is a target comment, prioritize an addition near the commented subject."
      : "Address the whole page naturally and choose what genuinely fits best in the picture."
  ].join(" ");
}

function buildAnalysisUserPayload(input: DrawRequest) {
  const targetComment =
    input.mode === "comment" && input.targetCommentId
      ? input.comments.find((comment) => comment.id === input.targetCommentId) ?? null
      : null;

  return JSON.stringify(
    {
      mode: input.mode,
      canvas: {
        width: input.canvasWidth,
        height: input.canvasHeight
      },
      supportedRelations: relationValues,
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

async function callGeminiJson(options: {
  gemini: NonNullable<ReturnType<typeof getGeminiConfig>>;
  systemText: string;
  userText: string;
  imageDataUrl?: string;
  temperature?: number;
  maxOutputTokens?: number;
}) {
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: options.userText }];

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
          parts: [{ text: options.systemText }]
        },
        generationConfig: {
          temperature: options.temperature ?? 0.18,
          responseMimeType: "application/json",
          maxOutputTokens: options.maxOutputTokens ?? 1536
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
    throw new GeminiRequestError(
      response.status,
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
    throw new Error("Gemini returned an empty response.");
  }

  return rawText;
}

function parseSceneAnalysis(rawText: string, input: DrawRequest): SceneAnalysis {
  const parsed = JSON.parse(stripCodeFence(rawText));
  return sanitizeSceneAnalysis(parsed, input);
}

export async function analyzeScene(input: DrawRequest): Promise<SceneAnalysis> {
  const gemini = getGeminiConfig();
  if (!gemini) {
    console.info("[draw-ai] Gemini not configured; skipping scene analysis");
    return buildFallbackSceneAnalysis("Gemini is not configured.");
  }

  let rawAnalysis = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      rawAnalysis = await callGeminiJson({
        gemini,
        systemText: buildAnalysisSystemPrompt(input),
        userText: buildAnalysisUserPayload(input),
        imageDataUrl: input.snapshotBase64,
        temperature: 0.16,
        maxOutputTokens: 2048
      });
      break;
    } catch (error) {
      const isTransient =
        error instanceof GeminiRequestError &&
        [429, 500, 503].includes(error.status);

      if (isTransient && attempt === 0) {
        console.warn("[draw-ai] transient scene analysis error; retrying once", {
          status: error.status
        });
        await sleep(450);
        continue;
      }

      console.error(
        "[draw-ai] scene analysis request failed",
        error instanceof Error ? error.message : error
      );
      return buildFallbackSceneAnalysis("The model was unavailable, so no addition was rendered.");
    }
  }

  if (!rawAnalysis) {
    return buildFallbackSceneAnalysis("The model was unavailable, so no addition was rendered.");
  }

  console.info("[draw-ai] raw scene analysis response", rawAnalysis.slice(0, 1600));

  try {
    const analysis = parseSceneAnalysis(rawAnalysis, input);
    console.info("[draw-ai] scene analysis accepted", {
      scene: analysis.scene,
      subjectCount: analysis.subjects.length,
      additionCount: analysis.additions.length
    });
    return analysis;
  } catch (error) {
    console.warn(
      "[draw-ai] scene analysis validation failed",
      error instanceof Error ? error.message : error
    );

    return sceneAnalysisSchema.parse({
      scene: extractJsonStringField(rawAnalysis, "scene") ?? "current sketch",
      why:
        extractJsonStringField(rawAnalysis, "why") ??
        "I could not parse a reliable scene plan, so no addition was rendered.",
      subjects: [],
      additions: []
    });
  }
}
