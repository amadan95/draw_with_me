type SoundKind = 'pen' | 'eraser'

class StudioSounds {
  private context: AudioContext | null = null
  private enabled = true
  private lastTextureAt = 0

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled && this.context?.state === 'running') void this.context.suspend()
  }

  private audio() {
    if (!this.enabled) return null
    if (!this.context) this.context = new AudioContext()
    if (this.context.state === 'suspended') void this.context.resume()
    return this.context
  }

  private tone(frequency: number, duration = 0.07, volume = 0.025, delay = 0) {
    const context = this.audio()
    if (!context) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const startsAt = context.currentTime + delay
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, startsAt)
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.88, startsAt + duration)
    gain.gain.setValueAtTime(0.0001, startsAt)
    gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(startsAt)
    oscillator.stop(startsAt + duration + 0.02)
  }

  private texture(kind: SoundKind, duration: number) {
    const context = this.audio()
    if (!context) return
    const length = Math.max(1, Math.floor(context.sampleRate * duration))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let index = 0; index < length; index += 1) {
      const envelope = Math.sin((index / length) * Math.PI)
      samples[index] = (Math.random() * 2 - 1) * envelope
    }
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    filter.type = kind === 'pen' ? 'bandpass' : 'lowpass'
    filter.frequency.value = kind === 'pen' ? 1850 : 620
    filter.Q.value = kind === 'pen' ? 1.1 : 0.55
    gain.gain.value = kind === 'pen' ? 0.018 : 0.026
    source.buffer = buffer
    source.connect(filter).connect(gain).connect(context.destination)
    source.start()
  }

  selectTool(kind: SoundKind) {
    this.tone(kind === 'pen' ? 420 : 310, 0.065, 0.025)
  }

  selectColor(index: number) {
    this.tone(410 + index * 70, 0.075, 0.022)
  }

  drawStart(kind: SoundKind) {
    this.texture(kind, kind === 'pen' ? 0.045 : 0.075)
  }

  stroke(kind: SoundKind) {
    const now = performance.now()
    if (now - this.lastTextureAt < 72) return
    this.lastTextureAt = now
    this.texture(kind, kind === 'pen' ? 0.055 : 0.09)
  }

  undo(direction: 'undo' | 'redo') {
    this.tone(direction === 'undo' ? 360 : 430, 0.08, 0.02)
    this.tone(direction === 'undo' ? 280 : 520, 0.08, 0.018, 0.055)
  }

  handoff() {
    this.tone(330, 0.1, 0.026)
    this.tone(495, 0.13, 0.026, 0.08)
  }

  returnTurn(success: boolean) {
    this.tone(success ? 520 : 220, 0.11, 0.023)
    if (success) this.tone(660, 0.14, 0.02, 0.075)
  }
}

export const studioSounds = new StudioSounds()
