import type { SimEvent } from './sim/match'

// Every sound is synthesised with Web Audio, so there are no files to ship.
// It only listens to sim events and never feeds back into the sim. The
// context starts on the first tap or key press (iOS refuses to play before
// one). On iPhone the silent switch also mutes Web Audio.
//
// Ambience: a slow slendro-ish saron melody over kendang strokes, with a soft
// gong every 16 beats. Random notes are fine here: audio is not part of the sim.

const MUTE_KEY = 'silat-duel.mute'
/** Five slendro-like steps (≈240 cents apart) from D4. */
const SLENDRO = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => 293.66 * 2 ** ((k * 240) / 1200))
const BEAT = 60 / 66

export class Sfx {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private music: GainNode | null = null
  private noise: AudioBuffer | null = null
  private nextBeat = 0
  private beat = 0
  private note = 2
  /** 0 in the menu, 1 during a fight: the music is a bit busier when it matters. */
  intensity = 0
  muted = false

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      this.muted = false
    }
    const unlock = () => this.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchend', unlock)
  }

  private unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 0.85
      this.master.connect(ctx.destination)
      this.music = ctx.createGain()
      this.music.gain.value = 0.32
      this.music.connect(this.master)
      const length = ctx.sampleRate
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
      this.nextBeat = ctx.currentTime + 0.3
    }
    if (this.ctx.state !== 'running') void this.ctx.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {
      // Not remembered; fine.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05)
    return this.muted
  }

  /** Pause (app in the background) silences everything. */
  suspend(on: boolean): void {
    if (!this.ctx) return
    if (on) void this.ctx.suspend()
    else void this.ctx.resume()
  }

  private ready(): AudioContext | null {
    return this.ctx && this.ctx.state === 'running' && this.master ? this.ctx : null
  }

  private tone(type: OscillatorType, from: number, to: number, start: number, length: number, volume: number, out?: AudioNode): void {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, start)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + length)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
    osc.connect(gain).connect(out ?? this.master!)
    osc.start(start)
    osc.stop(start + length + 0.02)
  }

  private hiss(type: BiquadFilterType, freq: number, start: number, length: number, volume: number, sweepTo?: number, out?: AudioNode): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bq = ctx.createBiquadFilter()
    bq.type = type
    bq.frequency.setValueAtTime(freq, start)
    if (sweepTo) bq.frequency.exponentialRampToValueAtTime(sweepTo, start + length)
    bq.Q.value = type === 'bandpass' ? 1.2 : 0.7
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.02, length * 0.3))
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
    src.connect(bq).connect(gain).connect(out ?? this.master!)
    src.start(start, Math.random() * 0.5)
    src.stop(start + length + 0.02)
  }

  /** Metallophone: fundamental plus the bright inharmonic partials of a bronze bar. */
  private saron(freq: number, start: number, volume: number): void {
    this.tone('sine', freq, freq, start, 1.4, volume, this.music!)
    this.tone('sine', freq * 2.76, freq * 2.76, start, 0.35, volume * 0.35, this.music!)
    this.tone('triangle', freq * 4.1, freq * 4.1, start, 0.12, volume * 0.15, this.music!)
  }

  /** Gong: low, slow beating partials and a long tail. */
  private gong(start: number, volume: number, out?: AudioNode): void {
    const o = out ?? this.master!
    this.tone('sine', 82, 80, start, 4.5, volume, o)
    this.tone('sine', 84.5, 83, start, 4.0, volume * 0.6, o)
    this.tone('sine', 164, 162, start, 2.8, volume * 0.35, o)
    this.tone('sine', 226, 224, start, 1.6, volume * 0.18, o)
    this.hiss('lowpass', 400, start, 0.15, volume * 0.3, undefined, o)
  }

  private kendang(start: number, open: boolean): void {
    if (open) this.tone('sine', 190, 95, start, 0.28, 0.5, this.music!)
    else this.hiss('bandpass', 900, start, 0.06, 0.25, undefined, this.music!)
  }

  /** Schedules the ambience a little ahead; call every frame. */
  update(): void {
    const ctx = this.ready()
    if (!ctx) return
    const ahead = ctx.currentTime + 0.25
    while (this.nextBeat < ahead) {
      const t = this.nextBeat
      const b = this.beat % 16
      if (b === 0) this.gong(t, 0.22, this.music!)
      // Kendang: "dhung … tak tak dhung"-ish, busier during a fight.
      if (b % 4 === 0 || (b % 4 === 3 && this.intensity > 0)) this.kendang(t, true)
      if (b % 2 === 1) this.kendang(t, false)
      if (this.intensity > 0 && b % 4 === 2) this.kendang(t + BEAT / 2, false)
      // Saron walks the scale in small steps.
      if (b % 2 === 0 || Math.random() < 0.25) {
        this.note = Math.max(0, Math.min(SLENDRO.length - 1, this.note + Math.floor(Math.random() * 5) - 2))
        this.saron(SLENDRO[this.note]!, t, b % 8 === 0 ? 0.2 : 0.13)
      }
      this.beat++
      this.nextBeat += BEAT / (this.intensity > 0 ? 1.4 : 1)
    }
  }

  event(e: SimEvent, local: boolean): void {
    const ctx = this.ready()
    if (!ctx) return
    const t = ctx.currentTime
    // The menu demo stays quiet apart from soft impacts.
    const v = local ? 1 : 0.35
    switch (e.type) {
      case 'swing':
        this.hiss('bandpass', 500, t, 0.16, 0.22 * v, 2400)
        break
      case 'hit':
        // Body thump plus a slap; heavier hits go lower and longer.
        this.tone('sine', e.heavy ? 150 : 210, 45, t, e.heavy ? 0.32 : 0.18, 0.55 * v)
        this.hiss('lowpass', e.heavy ? 1600 : 2600, t, e.heavy ? 0.2 : 0.1, 0.5 * v)
        this.hiss('highpass', 3000, t, 0.04, 0.25 * v)
        if (e.counter) this.tone('square', 880, 660, t, 0.12, 0.08 * v)
        break
      case 'block':
        this.hiss('bandpass', 1800, t, 0.07, 0.35 * v)
        this.tone('triangle', 720, 520, t, 0.08, 0.12 * v)
        break
      case 'parry':
        // "Ting!": a bright bell over a sharp swish.
        this.tone('sine', 2350, 2300, t, 0.5, 0.22 * v)
        this.tone('sine', 3520, 3480, t, 0.3, 0.1 * v)
        this.tone('triangle', 1175, 1170, t, 0.25, 0.08 * v)
        this.hiss('highpass', 4000, t, 0.06, 0.3 * v)
        break
      case 'grab':
        this.hiss('bandpass', 700, t, 0.25, 0.2 * v, 300)
        break
      case 'throwBreak':
        this.hiss('bandpass', 1400, t, 0.1, 0.4 * v)
        this.tone('triangle', 520, 900, t, 0.15, 0.12 * v)
        break
      case 'slam':
      case 'floor':
        this.tone('sine', 110, 38, t, 0.4, 0.6 * v)
        this.hiss('lowpass', 600, t, 0.3, 0.45 * v)
        break
      case 'jump':
      case 'dash':
        this.hiss('bandpass', 300, t, 0.12, 0.12 * v, 900)
        break
      case 'land':
        this.hiss('lowpass', 500, t, 0.08, 0.15 * v)
        break
      case 'roundStart':
        if (local) {
          this.tone('sine', 523, 523, t, 0.9, 0.12)
          this.tone('sine', 784, 784, t + 0.2, 0.9, 0.1)
        }
        break
      case 'fight':
        if (local) {
          this.kendang(t, true)
          this.tone('sine', 1046, 1046, t, 0.6, 0.12)
        }
        break
      case 'ko':
        this.gong(t + 0.05, local ? 0.7 : 0.25)
        break
      case 'timeUp':
        if (local) this.gong(t, 0.45)
        break
      case 'matchOver':
        if (local && e.winner === 0) [0, 2, 4, 7].forEach((k, i) => this.saron(SLENDRO[k]!, t + 0.4 + i * 0.22, 0.4))
        break
      default:
        break
    }
  }
}
