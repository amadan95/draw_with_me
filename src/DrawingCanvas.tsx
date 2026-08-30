import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { studioSounds } from './sounds'
import type { Point, Stroke, Tool } from './types'

export type DrawingCanvasHandle = {
  snapshot: () => string
  exportPng: () => void
  exportSvg: () => void
}

type Props = {
  strokes: Stroke[]
  tool: Tool
  color: string
  disabled?: boolean
  onCommit: (stroke: Stroke) => void
  onErase: (point: Point) => void
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number, height: number) {
  if (stroke.points.length < 2) return
  context.strokeStyle = stroke.color
  context.lineCap = 'round'
  context.lineJoin = 'round'

  for (let index = 1; index < stroke.points.length; index += 1) {
    const point = stroke.points[index]
    const previous = stroke.points[index - 1]
    const pressure = ((previous.pressure ?? .5) + (point.pressure ?? .5)) / 2
    context.beginPath()
    context.lineWidth = stroke.width * (.8 + pressure * .4)
    context.moveTo(previous.x * width, previous.y * height)
    context.lineTo(point.x * width, point.y * height)
    context.stroke()
  }
}

function download(href: string, filename: string, revoke = false) {
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export const DrawingCanvas = forwardRef<DrawingCanvasHandle, Props>(function DrawingCanvas(
  { strokes, tool, color, disabled = false, onCommit, onErase },
  forwardedRef,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef(strokes)
  const drawingRef = useRef<Stroke | null>(null)
  const [draft, setDraft] = useState<Stroke | null>(null)

  strokesRef.current = strokes

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const ratio = Math.min(devicePixelRatio || 1, 2)
    const pixelWidth = Math.max(1, Math.round(rect.width * ratio))
    const pixelHeight = Math.max(1, Math.round(rect.height * ratio))
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    const context = canvas.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, rect.width, rect.height)
    for (const stroke of strokesRef.current) drawStroke(context, stroke, rect.width, rect.height)
    if (draft) drawStroke(context, draft, rect.width, rect.height)
  }, [draft])

  useEffect(() => render(), [render, strokes])
  useEffect(() => {
    const observer = new ResizeObserver(render)
    if (canvasRef.current) observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [render])

  const makeSnapshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return ''
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const context = copy.getContext('2d')
    if (!context) return canvas.toDataURL('image/png')
    context.fillStyle = '#fffdf7'
    context.fillRect(0, 0, copy.width, copy.height)
    context.drawImage(canvas, 0, 0)
    return copy.toDataURL('image/png')
  }, [])

  useImperativeHandle(forwardedRef, () => ({
    snapshot: makeSnapshot,
    exportPng: () => download(makeSnapshot(), 'draw-with-me.png'),
    exportSvg: () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { width, height } = canvas.getBoundingClientRect()
      const paths = strokesRef.current.map((stroke) => {
        const points = stroke.points.map((point) => `${(point.x * width).toFixed(1)},${(point.y * height).toFixed(1)}`).join(' ')
        return `<polyline points="${points}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`
      }).join('')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#fffdf7"/>${paths}</svg>`
      download(URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), 'draw-with-me.svg', true)
    },
  }), [makeSnapshot])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      pressure: event.pressure || 0.5,
    }
  }

  const begin = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    studioSounds.drawStart(tool)
    const point = pointFromEvent(event)
    if (tool === 'eraser') {
      onErase(point)
      return
    }
    const next: Stroke = { id: `human-${Date.now()}`, author: 'human', color, width: 4, points: [point] }
    drawingRef.current = next
    setDraft(next)
  }

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    studioSounds.stroke(tool)
    const point = pointFromEvent(event)
    if (tool === 'eraser') {
      onErase(point)
      return
    }
    const current = drawingRef.current
    if (!current) return
    const last = current.points[current.points.length - 1]
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.0025) return
    const next = { ...current, points: [...current.points, point] }
    drawingRef.current = next
    setDraft(next)
  }

  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const current = drawingRef.current
    if (current && current.points.length > 1) onCommit(current)
    drawingRef.current = null
    setDraft(null)
  }

  return (
    <canvas
      ref={canvasRef}
      className={`drawing-canvas tool-${tool}`}
      aria-label="Drawing canvas. Use a pointer, touch, or stylus to draw."
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={finish}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
})
