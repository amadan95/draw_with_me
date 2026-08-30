import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight, Check, Download, FileImage, FileType2, KeyRound, Pencil,
  Redo2, RotateCcw, Settings as SettingsIcon, Sparkles, Trash2, Undo2, Volume2, VolumeX, X,
} from 'lucide-react'
import { DrawingCanvas, type DrawingCanvasHandle } from './DrawingCanvas'
import { finishOpenRouterConnect, getOpenRouterKey, requestAiStrokes, setOpenRouterKey, startOpenRouterConnect } from './openrouter'
import { studioSounds } from './sounds'
import { loadWorkspace, saveWorkspace } from './storage'
import { EraserArtwork, PencilArtwork } from './ToolArtwork'
import { COLORS, DEFAULT_MODEL, DEFAULT_SETTINGS, type Point, type Settings, type Stroke, type Tool } from './types'

const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))

type CompanionCursor = { x: number; y: number; color: string; angle: number }

function humanizeStroke(stroke: Stroke): Stroke {
  if (stroke.points.length < 2) return stroke

  const points: Point[] = []
  let phase = stroke.id.split('').reduce((total, character) => total + character.charCodeAt(0), 0) * 0.17

  for (let segmentIndex = 1; segmentIndex < stroke.points.length; segmentIndex += 1) {
    const start = stroke.points[segmentIndex - 1]
    const end = stroke.points[segmentIndex]
    const deltaX = end.x - start.x
    const deltaY = end.y - start.y
    const distance = Math.hypot(deltaX, deltaY)
    const steps = Math.max(3, Math.ceil(distance / 0.0075))
    const normalX = distance ? -deltaY / distance : 0
    const normalY = distance ? deltaX / distance : 0

    for (let step = segmentIndex === 1 ? 0 : 1; step <= steps; step += 1) {
      const progress = step / steps
      const eased = progress * progress * (3 - 2 * progress)
      const taper = Math.sin(progress * Math.PI)
      const wobble = Math.sin(phase + step * 0.82) * 0.0018 * taper
      points.push({
        x: Math.min(1, Math.max(0, start.x + deltaX * eased + normalX * wobble)),
        y: Math.min(1, Math.max(0, start.y + deltaY * eased + normalY * wobble)),
        pressure: 0.42 + Math.sin(phase + step * 0.31) * 0.08,
      })
    }
    phase += steps * 0.61
  }

  return { ...stroke, points }
}

function distanceToStroke(point: Point, stroke: Stroke) {
  return stroke.points.reduce((closest, candidate) => Math.min(closest, Math.hypot(point.x - candidate.x, point.y - candidate.y)), Number.POSITIVE_INFINITY)
}

export default function App() {
  const canvasRef = useRef<DrawingCanvasHandle>(null)
  const settingsDialogRef = useRef<HTMLDialogElement>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [past, setPast] = useState<Stroke[][]>([])
  const [future, setFuture] = useState<Stroke[][]>([])
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(COLORS[3])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [key, setKeyState] = useState('')
  const [draftKey, setDraftKey] = useState('')
  const [status, setStatus] = useState('Your turn — make a mark')
  const [thinking, setThinking] = useState(false)
  const [companionCursor, setCompanionCursor] = useState<CompanionCursor | null>(null)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    loadWorkspace().then((saved) => {
      if (saved?.strokes) setStrokes(saved.strokes)
      if (saved?.settings) {
        const savedModel = saved.settings.model === 'openrouter/free' ? DEFAULT_MODEL : saved.settings.model
        setSettings({ ...DEFAULT_SETTINGS, ...saved.settings, model: savedModel })
      }
    }).catch(() => setStatus('Drawing is ready, but local saving is unavailable.'))
      .finally(() => setHydrated(true))

    setKeyState(getOpenRouterKey())
    finishOpenRouterConnect().then((connected) => {
      if (connected) {
        setKeyState(getOpenRouterKey())
        setStatus('OpenRouter connected — your pencil is ready')
      }
    }).catch((error: Error) => setStatus(error.message))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => saveWorkspace(strokes, settings).catch(() => undefined), 250)
    return () => window.clearTimeout(timer)
  }, [hydrated, settings, strokes])

  useEffect(() => studioSounds.setEnabled(settings.soundEnabled), [settings.soundEnabled])

  const replaceStrokes = useCallback((next: Stroke[]) => {
    setPast((history) => [...history.slice(-49), strokes])
    setFuture([])
    setStrokes(next)
  }, [strokes])

  const addStroke = (stroke: Stroke) => replaceStrokes([...strokes, stroke])

  const eraseAt = (point: Point) => {
    const index = strokes.findLastIndex((stroke) => distanceToStroke(point, stroke) < 0.026)
    if (index < 0) return
    replaceStrokes(strokes.filter((_, strokeIndex) => strokeIndex !== index))
  }

  const undo = () => {
    const previous = past[past.length - 1]
    if (!previous || thinking) return
    setFuture((items) => [strokes, ...items].slice(0, 50))
    setStrokes(previous)
    setPast((items) => items.slice(0, -1))
    setStatus('Undid the last mark')
    studioSounds.undo('undo')
  }

  const redo = () => {
    const next = future[0]
    if (!next || thinking) return
    setPast((items) => [...items, strokes].slice(-50))
    setStrokes(next)
    setFuture((items) => items.slice(1))
    setStatus('Brought that mark back')
    studioSounds.undo('redo')
  }

  const clear = () => {
    if (!strokes.length || !window.confirm('Clear every mark from this drawing?')) return
    replaceStrokes([])
    setStatus('Fresh paper — your turn')
  }

  const openSettings = () => {
    setDraftKey(key)
    settingsDialogRef.current?.showModal()
  }

  const saveKey = () => {
    setOpenRouterKey(draftKey)
    setKeyState(draftKey.trim())
    settingsDialogRef.current?.close()
    setStatus(draftKey.trim() ? 'OpenRouter key connected for this tab' : 'OpenRouter disconnected')
  }

  const takeAiTurn = async () => {
    if (thinking) return
    if (!key) {
      openSettings()
      setStatus('Connect OpenRouter before inviting the AI')
      return
    }
    if (!strokes.length) {
      setStatus('Make the first mark, then invite the AI')
      return
    }
    const snapshot = canvasRef.current?.snapshot()
    if (!snapshot) return
    setThinking(true)
    setStatus('Your companion is looking…')
    studioSounds.handoff()
    try {
      const result = await requestAiStrokes(key, snapshot, settings)
      setPast((history) => [...history.slice(-49), strokes])
      setFuture([])
      let animated = [...strokes]
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
      for (const rawStroke of result.strokes) {
        const incoming = humanizeStroke(rawStroke)
        if (reduceMotion) {
          animated = [...animated, incoming]
          setStrokes(animated)
          continue
        }
        const partial: Stroke = { ...incoming, points: incoming.points.slice(0, 1) }
        animated = [...animated, partial]
        setStrokes(animated)
        setStatus('Your companion is drawing…')
        setCompanionCursor({ ...incoming.points[0], color: incoming.color, angle: 25 })
        await sleep(220)
        for (let index = 2; index <= incoming.points.length; index += 1) {
          const currentPoint = incoming.points[index - 1]
          const previousPoint = incoming.points[Math.max(0, index - 2)]
          const direction = Math.atan2(currentPoint.y - previousPoint.y, currentPoint.x - previousPoint.x) * (180 / Math.PI)
          animated = [...animated.slice(0, -1), { ...incoming, points: incoming.points.slice(0, index) }]
          setStrokes(animated)
          setCompanionCursor({ ...currentPoint, color: incoming.color, angle: 25 + Math.max(-9, Math.min(9, direction * 0.08)) })
          studioSounds.stroke('pen')
          await sleep(24 + (index % 9 === 0 ? 20 : 0))
        }
        animated = [...animated.slice(0, -1), incoming]
        setStrokes(animated)
        await sleep(180)
      }
      setCompanionCursor(null)
      setStatus(`${result.thought} Your turn.`)
      studioSounds.returnTurn(true)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The AI turn failed. Your drawing is safe.')
      studioSounds.returnTurn(false)
    } finally {
      setCompanionCursor(null)
      setThinking(false)
    }
  }

  return (
    <main className="studio-board">
      <section className="grid-surface" aria-label="Shared drawing grid">
        <div className="board-heading">
          <h1>Draw With Me</h1>
          <button className={`connection-chip ${key ? 'connected' : ''}`} onClick={openSettings} aria-label="Open AI connection settings">
            {key ? <Check size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
            <span>{key ? 'AI ready' : 'Connect AI'}</span>
          </button>
        </div>
        <div className="drawing-grid">
          <DrawingCanvas ref={canvasRef} strokes={strokes} tool={tool} color={color} disabled={thinking} onCommit={addStroke} onErase={eraseAt} />
          {companionCursor && (
            <div
              className="companion-pencil"
              style={{
                left: `${companionCursor.x * 100}%`,
                top: `${companionCursor.y * 100}%`,
                '--cursor-angle': `${companionCursor.angle}deg`,
              } as React.CSSProperties}
              aria-hidden="true"
            >
              <PencilArtwork color={companionCursor.color} />
              <span className="cursor-contact" />
            </div>
          )}
          {!strokes.length && (
            <div className="empty-hint" aria-hidden="true">
              <Pencil size={28} />
              <span>Make the first mark</span>
            </div>
          )}
          <p className="turn-status" role="status" aria-live="polite">{status}</p>
        </div>
      </section>

      <nav className="tool-rail" aria-label="Drawing tools">
        <div className="tool-group drawing-tools">
          <button className={`tool-button illustrated-pencil ${tool === 'pen' ? 'active' : ''}`} onClick={() => { setTool('pen'); studioSounds.selectTool('pen') }} aria-label="Pencil" aria-pressed={tool === 'pen'}>
            <PencilArtwork color={color} />
          </button>
          <button className={`tool-button illustrated-eraser ${tool === 'eraser' ? 'active' : ''}`} onClick={() => { setTool('eraser'); studioSounds.selectTool('eraser') }} aria-label="Eraser" aria-pressed={tool === 'eraser'}>
            <EraserArtwork />
          </button>
        </div>

        <div className="divider" />
        <div className="tool-group colors" aria-label="Pencil colors">
          {COLORS.map((swatch) => (
            <button
              key={swatch}
              className={`color-well ${color === swatch ? 'active' : ''}`}
              style={{ '--swatch': swatch } as React.CSSProperties}
              onClick={() => { setColor(swatch); setTool('pen'); studioSounds.selectColor(COLORS.indexOf(swatch)) }}
              aria-label={`Use ${swatch} pencil`}
              aria-pressed={color === swatch}
            />
          ))}
        </div>

        <div className="divider utilities-divider" />
        <div className="tool-group utilities">
          <button className="small-tool" onClick={undo} disabled={!past.length || thinking} aria-label="Undo"><Undo2 aria-hidden="true" /></button>
          <button className="small-tool" onClick={redo} disabled={!future.length || thinking} aria-label="Redo"><Redo2 aria-hidden="true" /></button>
          <button
            className="small-tool"
            onClick={() => setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }))}
            aria-label={settings.soundEnabled ? 'Mute sound effects' : 'Turn on sound effects'}
            aria-pressed={settings.soundEnabled}
          >
            {settings.soundEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          </button>
          <details className="export-menu">
            <summary className="small-tool" aria-label="Export drawing"><Download aria-hidden="true" /></summary>
            <div className="export-sheet">
              <button onClick={() => canvasRef.current?.exportPng()}><FileImage size={18} /> PNG</button>
              <button onClick={() => canvasRef.current?.exportSvg()}><FileType2 size={18} /> SVG</button>
              <button className="danger" onClick={clear}><Trash2 size={18} /> Clear</button>
            </div>
          </details>
          <button className="small-tool" onClick={openSettings} aria-label="Settings"><SettingsIcon aria-hidden="true" /></button>
        </div>

        <button className="ai-turn" onClick={takeAiTurn} disabled={thinking}>
          {thinking ? <Sparkles className="thinking-spark" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          <span>{thinking ? 'Drawing…' : 'AI turn'}</span>
        </button>
      </nav>

      <dialog ref={settingsDialogRef} className="settings-sheet" onClick={(event) => { if (event.target === settingsDialogRef.current) settingsDialogRef.current?.close() }}>
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); saveKey() }}>
          <div className="settings-heading">
            <div>
              <h2>Invite your companion</h2>
              <p>OpenRouter usage belongs to you. The project owner never receives or stores your key.</p>
            </div>
            <button className="close-button" type="button" onClick={() => settingsDialogRef.current?.close()} aria-label="Close settings"><X /></button>
          </div>

          <button className="connect-button" type="button" onClick={() => void startOpenRouterConnect()}>
            <KeyRound size={20} /> Connect with OpenRouter
          </button>
          <div className="or-divider"><span>or paste a key for this tab</span></div>
          <label>
            OpenRouter API key
            <input type="password" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="sk-or-v1-…" autoComplete="off" />
          </label>
          <p className="privacy-note">The key is kept in session storage and disappears when the tab session ends. It is never added to the URL, drawing, or repository.</p>

          <div className="settings-grid">
            <label>
              Model
              <input value={settings.model} onChange={(event) => setSettings((current) => ({ ...current, model: event.target.value }))} placeholder={DEFAULT_MODEL} />
            </label>
            <label>
              Max AI strokes
              <input type="number" min="2" max="12" value={settings.maxStrokes} onChange={(event) => setSettings((current) => ({ ...current, maxStrokes: Math.min(12, Math.max(2, Number(event.target.value))) }))} />
            </label>
          </div>
          <div className="settings-actions">
            {key && <button className="disconnect" type="button" onClick={() => { setDraftKey(''); setOpenRouterKey(''); setKeyState('') }}><RotateCcw size={17} /> Disconnect</button>}
            <button className="save-settings" type="submit">Save settings</button>
          </div>
        </form>
      </dialog>
    </main>
  )
}
