import { z } from 'zod'
import { COLORS, DEFAULT_MODEL, type Settings, type Stroke } from './types'

const KEY_NAME = 'draw-with-me-openrouter-key'
const VERIFIER_NAME = 'draw-with-me-pkce-verifier'

const strokeSchema = z.object({
  color: z.string(),
  width: z.number().min(1).max(16),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(160),
})

const responseSchema = z.object({
  thought: z.string().max(180).optional(),
  strokes: z.array(strokeSchema).min(1).max(12),
})

function bytesToBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function getOpenRouterKey() {
  return sessionStorage.getItem(KEY_NAME) ?? ''
}

export function setOpenRouterKey(key: string) {
  const trimmed = key.trim()
  if (trimmed) sessionStorage.setItem(KEY_NAME, trimmed)
  else sessionStorage.removeItem(KEY_NAME)
}

export async function startOpenRouterConnect() {
  const verifier = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = bytesToBase64Url(new Uint8Array(digest))
  sessionStorage.setItem(VERIFIER_NAME, verifier)
  const callback = `${location.origin}${location.pathname}`
  const params = new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: 'S256' })
  location.assign(`https://openrouter.ai/auth?${params}`)
}

export async function finishOpenRouterConnect(): Promise<boolean> {
  const code = new URLSearchParams(location.search).get('code')
  const verifier = sessionStorage.getItem(VERIFIER_NAME)
  if (!code || !verifier) return false
  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  if (!response.ok) throw new Error('OpenRouter could not finish connecting. Try again or paste a key.')
  const data = (await response.json()) as { key?: string }
  if (!data.key) throw new Error('OpenRouter did not return a key.')
  setOpenRouterKey(data.key)
  sessionStorage.removeItem(VERIFIER_NAME)
  history.replaceState({}, '', `${location.pathname}${location.hash}`)
  return true
}

function normalizeColor(color: string) {
  const candidate = color.toLowerCase()
  return COLORS.includes(candidate as (typeof COLORS)[number]) ? candidate : COLORS[3]
}

export async function requestAiStrokes(key: string, snapshot: string, settings: Settings): Promise<{ strokes: Stroke[]; thought: string }> {
  const selectedModel = settings.model || DEFAULT_MODEL
  const compatibilityMode = selectedModel === 'openrouter/free'
  const schemaInstruction = `Return only one JSON object with this exact shape: {"thought":"short friendly description","strokes":[{"color":"one of ${COLORS.join(', ')}","width":4,"points":[{"x":0.1,"y":0.1},{"x":0.2,"y":0.2}]}]}. Include 1 to ${settings.maxStrokes} strokes. Each stroke needs 2 to 100 points. Every x and y must be a number from 0 to 1. Do not wrap the JSON in markdown.`
  const tool = {
    type: 'function',
    function: {
      name: 'draw_strokes',
      description: 'Add a small, relevant drawing response to the existing canvas using normalized vector strokes.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['thought', 'strokes'],
        properties: {
          thought: { type: 'string', description: 'A short friendly description of the addition.' },
          strokes: {
            type: 'array', maxItems: settings.maxStrokes,
            items: {
              type: 'object', additionalProperties: false, required: ['color', 'width', 'points'],
              properties: {
                color: { type: 'string', enum: [...COLORS] },
                width: { type: 'number', minimum: 1, maximum: 12 },
                points: { type: 'array', minItems: 2, maxItems: 100, items: { type: 'object', required: ['x', 'y'], properties: { x: { type: 'number', minimum: 0, maximum: 1 }, y: { type: 'number', minimum: 0, maximum: 1 } } } },
              },
            },
          },
        },
      },
    },
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': location.origin,
      'X-Title': 'Draw With Me',
    },
    body: JSON.stringify({
      model: selectedModel,
      temperature: settings.creativity,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Study this drawing and take one modest turn. Add, complement, or playfully respond to what is already there. Do not redraw, erase, frame, caption, or cover the person's work. Use no more than ${settings.maxStrokes} simple strokes. Coordinates must be normalized from 0 to 1. ${compatibilityMode ? schemaInstruction : ''}` },
          { type: 'image_url', image_url: { url: snapshot } },
        ],
      }],
      ...(compatibilityMode ? {} : {
        tools: [tool],
        tool_choice: { type: 'function', function: { name: 'draw_strokes' } },
      }),
    }),
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: { message?: string } } | null
    if (response.status === 401) throw new Error('OpenRouter rejected this key. Reconnect it in Settings and try again.')
    if (response.status === 402) throw new Error('This model requires credits. Choose an OpenRouter model whose ID ends in :free.')
    if (response.status === 429) throw new Error('The free model is busy or its daily limit was reached. Wait a moment and try again.')
    if (detail?.error?.message === 'Provider returned error') throw new Error('The free provider rejected this turn. Try again to let OpenRouter choose another compatible provider.')
    throw new Error(detail?.error?.message || `The AI turn failed with OpenRouter status ${response.status}. Your drawing is safe.`)
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { arguments?: string } }> } }> }
  const message = data.choices?.[0]?.message
  const raw = message?.tool_calls?.[0]?.function?.arguments ?? message?.content
  if (!raw) throw new Error('The model replied without drawing instructions. Try another free model.')
  const jsonText = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const objectStart = jsonText.indexOf('{')
  const objectEnd = jsonText.lastIndexOf('}')
  if (objectStart < 0 || objectEnd <= objectStart) throw new Error('The free model replied without usable drawing instructions. Try the AI turn again.')
  let parsed: z.infer<typeof responseSchema>
  try {
    parsed = responseSchema.parse(JSON.parse(jsonText.slice(objectStart, objectEnd + 1)))
  } catch {
    throw new Error('The free model returned malformed drawing instructions. Try again to use another provider.')
  }
  const strokes = parsed.strokes.slice(0, settings.maxStrokes).map((stroke, index): Stroke => ({
    id: `ai-${Date.now()}-${index}`,
    author: 'ai',
    color: normalizeColor(stroke.color),
    width: Math.min(12, Math.max(1, stroke.width)),
    points: stroke.points.map((point) => ({ x: Math.min(1, Math.max(0, point.x)), y: Math.min(1, Math.max(0, point.y)) })),
  }))
  return { strokes, thought: parsed.thought ?? 'I added a little something.' }
}
