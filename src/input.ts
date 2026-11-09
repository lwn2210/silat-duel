import type { Input } from './sim/match'

// Keyboard and touch, folded into the sim's Input. An online client would
// send exactly this per tick. Touch: a floating stick on the left half of the
// screen and four buttons on the right, each finger tracked on its own.

const KEYMAP: Record<string, keyof Pick<Input, 'punch' | 'kick' | 'special' | 'grab' | 'parry'>> = {
  KeyJ: 'punch',
  KeyK: 'kick',
  KeyL: 'grab',
  KeyU: 'special',
  KeyI: 'special',
  KeyO: 'parry',
}

const STICK_RADIUS = 46

/** Capture can fail for a pointer that is already gone; the press still counts. */
function capture(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id)
  } catch {
    // Not capturable; fine.
  }
}
const DEADZONE = 0.35

export class LocalInput {
  private keys = new Set<string>()
  /** Keys pressed since the last read: a tap shorter than one tick still counts once. */
  private tapped = new Set<string>()
  private buttons = { punch: false, kick: false, special: false, grab: false, parry: false }
  private stick = { x: 0 as -1 | 0 | 1, y: 0 as -1 | 0 | 1 }
  private stickPointer: number | null = null
  private stickOrigin = { x: 0, y: 0 }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
      this.keys.add(e.code)
      this.tapped.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.clear())

    for (const id of ['punch', 'kick', 'special', 'grab', 'parry'] as const)
      this.hold(`btn-${id}`, (on) => {
        this.buttons[id] = on
        if (on) this.tapped.add(id)
      })
    this.bindStick()
  }

  private hold(id: string, set: (on: boolean) => void): void {
    const el = document.getElementById(id)
    if (!el) return
    // Safari otherwise swallows quick repeated taps as double-tap zoom.
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      capture(el, e.pointerId)
      el.classList.add('held')
      set(true)
    })
    const up = () => {
      el.classList.remove('held')
      set(false)
    }
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
  }

  private bindStick(): void {
    const zone = document.getElementById('stick-zone')
    const base = document.getElementById('stick')
    const knob = document.getElementById('stick-knob')
    if (!zone || !base || !knob) return
    zone.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
    const place = (x: number, y: number) => {
      base.style.left = `${x}px`
      base.style.top = `${y}px`
    }
    const move = (e: PointerEvent) => {
      const dx = e.clientX - this.stickOrigin.x
      const dy = e.clientY - this.stickOrigin.y
      const len = Math.hypot(dx, dy)
      const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`
      const nx = dx / STICK_RADIUS
      const ny = dy / STICK_RADIUS
      // Eight directions: each axis counts once it passes the dead zone.
      this.stick.x = nx > DEADZONE ? 1 : nx < -DEADZONE ? -1 : 0
      this.stick.y = ny > DEADZONE + 0.1 ? -1 : ny < -(DEADZONE + 0.15) ? 1 : 0
    }
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return
      e.preventDefault()
      capture(zone, e.pointerId)
      this.stickPointer = e.pointerId
      const r = zone.getBoundingClientRect()
      this.stickOrigin = { x: e.clientX, y: e.clientY }
      place(e.clientX - r.left, e.clientY - r.top)
      base.classList.add('active')
      move(e)
    })
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickPointer) move(e)
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return
      this.stickPointer = null
      this.stick = { x: 0, y: 0 }
      knob.style.transform = ''
      base.classList.remove('active')
      base.style.left = ''
      base.style.top = ''
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
  }

  clear(): void {
    this.keys.clear()
    this.tapped.clear()
    this.buttons = { punch: false, kick: false, special: false, grab: false, parry: false }
    this.stick = { x: 0, y: 0 }
  }

  read(): Input {
    const k = new Set([...this.keys, ...this.tapped])
    const taps = new Set(this.tapped)
    this.tapped.clear()
    const left = k.has('ArrowLeft') || k.has('KeyA') || this.stick.x === -1
    const right = k.has('ArrowRight') || k.has('KeyD') || this.stick.x === 1
    const up = k.has('ArrowUp') || k.has('KeyW') || this.stick.y === 1
    const down = k.has('ArrowDown') || k.has('KeyS') || this.stick.y === -1
    const input: Input = {
      x: left === right ? 0 : left ? -1 : 1,
      y: up === down ? 0 : up ? 1 : -1,
      punch: this.buttons.punch || taps.has('punch'),
      kick: this.buttons.kick || taps.has('kick'),
      special: this.buttons.special || taps.has('special'),
      grab: this.buttons.grab || taps.has('grab'),
      parry: this.buttons.parry || taps.has('parry'),
    }
    for (const [code, b] of Object.entries(KEYMAP)) if (k.has(code)) input[b] = true
    return input
  }
}
