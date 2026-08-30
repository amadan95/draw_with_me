export type Point = { x: number; y: number; pressure?: number }

export type Stroke = {
  id: string
  author: 'human' | 'ai'
  color: string
  width: number
  points: Point[]
}

export type Tool = 'pen' | 'eraser'

export type Settings = {
  model: string
  creativity: number
  maxStrokes: number
  soundEnabled: boolean
}

export const COLORS = ['#84a59d', '#e07a5f', '#f2b84b', '#3d405b'] as const

export const DEFAULT_MODEL = 'google/gemma-4-31b-it:free'

export const DEFAULT_SETTINGS: Settings = {
  model: DEFAULT_MODEL,
  creativity: 0.7,
  maxStrokes: 8,
  soundEnabled: true,
}
