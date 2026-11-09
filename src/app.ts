import * as THREE from 'three'
import { Sfx } from './audio'
import { Bot, type BotLevel } from './bot/bot'
import { Hud } from './hud'
import { LocalInput } from './input'
import { Effects } from './render/fx'
import { FighterView } from './render/fighterView'
import { World } from './render/world'
import { DT, SLOW_FACTOR } from './sim/constants'
import { createMatch, step, type Input, type MatchState, type SimEvent } from './sim/match'
import { FIGHTERS, MOVE_LIST, type FighterId } from './sim/moves'

// The sim runs here at a fixed 60 Hz (vs the PC, or the menu demo where two
// bots fight) and is drawn with interpolation between world frames, so the
// KO slow motion is smooth too. The local player is always fighter 0 (left).

interface Session {
  state: MatchState
  bots: [Bot | null, Bot | null]
  /** false = the menu's demo fight. */
  live: boolean
}

const LEVEL_NAMES: Record<BotLevel, string> = { mudah: 'PC Mudah', sedang: 'PC Sedang', jago: 'PC Jago' }
const PICK_KEY = 'silat-duel.pick'
const LEVEL_KEY = 'silat-duel.level'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    if (v && allowed.includes(v)) return v
  } catch {
    // No storage.
  }
  return fallback
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; fine.
  }
}

export class App {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.3, 600)
  private readonly world: World
  private views: [FighterView, FighterView]
  private readonly fx: Effects
  private readonly hud = new Hud()
  private readonly input = new LocalInput()
  private readonly sfx = new Sfx()

  private session: Session
  private pick: FighterId = load(PICK_KEY, ['jaka', 'sari', 'gatot'] as const, 'jaka')
  private level: BotLevel = load(LEVEL_KEY, ['mudah', 'sedang', 'jago'] as const, 'sedang')
  private paused = false

  private accumulator = 0
  private last = performance.now()
  private clock = 0
  /** Positions at the previous world frame, and how many ticks ago the world last moved. */
  private prev: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]
  private sinceFrame = 0
  private cam = { x: 0, dist: 6, y: 1.3, shake: 0, punch: 0 }
  /** Damage of the combo each fighter is currently landing, for the HUD. */
  private comboDamage = [0, 0]
  private flash = 0

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.world = new World(this.scene)
    this.fx = new Effects(this.scene)
    this.session = this.demo()
    this.views = this.makeViews(this.session.state)
    this.capture(this.session.state)

    if (new URLSearchParams(location.search).has('touch')) document.body.classList.add('touch-on')
    this.bindUi()
    window.addEventListener('resize', () => this.resize())
    this.resize()
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.session.live) this.setPaused(true)
    })
    this.renderer.setAnimationLoop(() => this.frame())
  }

  // ---- UI -----------------------------------------------------------------------------

  private bindUi(): void {
    // Move list in the menu and on the pause screen.
    const rows = MOVE_LIST.map((m) => `<tr><td><kbd>${m.input}</kbd></td><td><b>${m.name}</b><span>${m.note}</span></td></tr>`).join('')
    document.querySelectorAll('[data-movelist]').forEach((t) => (t.innerHTML = rows))
    const picks = $('picks')
    const showPick = () => picks.querySelectorAll<HTMLElement>('.pick').forEach((b) => b.classList.toggle('on', b.dataset.fighter === this.pick))
    showPick()
    picks.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.pick')
      if (!btn) return
      this.pick = btn.dataset.fighter as FighterId
      save(PICK_KEY, this.pick)
      showPick()
    })
    const levels = $('levels')
    const showLevel = () => levels.querySelectorAll<HTMLElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.level === this.level))
    showLevel()
    levels.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('button')
      if (!btn) return
      this.level = btn.dataset.level as BotLevel
      save(LEVEL_KEY, this.level)
      showLevel()
    })
    $('play').addEventListener('click', () => this.startDuel())
    $('again').addEventListener('click', () => this.startDuel())
    $('to-menu').addEventListener('click', () => this.toMenu())
    $('resume').addEventListener('click', () => this.setPaused(false))
    $('quit').addEventListener('click', () => this.toMenu())
    $('pause').addEventListener('click', () => this.setPaused(!this.paused))

    const mute = $('mute')
    const showMute = () => (mute.textContent = this.sfx.muted ? '🔇' : '🔊')
    showMute()
    mute.addEventListener('click', () => {
      this.sfx.toggleMute()
      showMute()
    })
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      if (e.code === 'KeyM') {
        this.sfx.toggleMute()
        showMute()
      } else if ((e.code === 'KeyP' || e.code === 'Escape') && this.session.live && this.session.state.phase !== 'matchOver') {
        this.setPaused(!this.paused)
      } else if (e.code === 'Enter' && !$('menu').hidden) this.startDuel()
    })
  }

  private showOnly(id: 'menu' | 'paused' | 'result' | null): void {
    for (const overlay of ['menu', 'paused', 'result'] as const) $(overlay).hidden = overlay !== id
  }

  private setPaused(on: boolean): void {
    if (!this.session.live) return
    this.paused = on
    this.input.clear()
    this.showOnly(on ? 'paused' : null)
    this.sfx.suspend(on)
    this.last = performance.now()
  }

  private startDuel(): void {
    const seed = (Math.random() * 2 ** 32) >>> 0
    const foe: FighterId = this.pick === 'jaka' ? 'sari' : this.pick === 'sari' ? 'gatot' : 'jaka'
    const state = createMatch(seed, [this.pick, foe])
    this.useSession({ state, bots: [null, new Bot(1, this.level, seed ^ 0x9e3779b9)], live: true })
    this.input.clear()
    this.paused = false
    this.showOnly(null)
    $('pause').hidden = false
    this.hud.show(state, ['Kamu', LEVEL_NAMES[this.level]])
    this.sfx.intensity = 1
  }

  private toMenu(): void {
    this.paused = false
    this.sfx.suspend(false)
    this.useSession(this.demo())
    this.showOnly('menu')
    $('pause').hidden = true
    this.hud.hide()
    this.sfx.intensity = 0
  }

  // ---- Sessions -----------------------------------------------------------------------

  private demo(): Session {
    const seed = (Math.random() * 2 ** 32) >>> 0
    const pairs: [FighterId, FighterId][] = [
      ['jaka', 'sari'],
      ['sari', 'gatot'],
      ['gatot', 'jaka'],
    ]
    const roster: [FighterId, FighterId] = pairs[seed % pairs.length]!
    return { state: createMatch(seed, roster), bots: [new Bot(0, 'jago', seed + 1), new Bot(1, 'jago', seed + 2)], live: false }
  }

  private makeViews(s: MatchState): [FighterView, FighterView] {
    return [new FighterView(this.scene, 0, s.roster[0]), new FighterView(this.scene, 1, s.roster[1])]
  }

  private useSession(session: Session): void {
    this.session = session
    const s = session.state
    if (this.views[0].id !== s.roster[0] || this.views[1].id !== s.roster[1]) {
      for (const v of this.views) this.scene.remove(v.root)
      this.views = this.makeViews(s)
    }
    this.views.forEach((v) => v.reset())
    this.capture(s)
    this.accumulator = 0
  }

  private capture(s: MatchState): void {
    s.fighters.forEach((f, i) => Object.assign(this.prev[i]!, { x: f.x, y: f.y }))
    this.sinceFrame = 0
  }

  private resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ---- Loop -----------------------------------------------------------------------------

  private frame(): void {
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.clock += dt
    const session = this.session
    const s = session.state

    if (!this.paused) {
      this.accumulator += dt
      while (this.accumulator >= DT && session === this.session) {
        this.tick(session)
        this.accumulator -= DT
      }
    }
    if (session !== this.session) return

    const perFrame = s.slow > 0 ? SLOW_FACTOR : 1
    const sub = this.paused ? 1 : Math.min(1, (this.sinceFrame + this.accumulator / DT) / perFrame)
    this.draw(s, sub, dt)
    this.sfx.update()
    if (session.live) this.hud.update(s, now)
  }

  private tick(session: Session): void {
    const s = session.state
    const before = s.frame
    const round = s.round
    const pre = s.fighters.map((f) => ({ x: f.x, y: f.y }))
    const inputs = session.bots.map((bot) => (bot ? bot.think(s) : this.input.read())) as [Input, Input]
    const events = step(s, inputs)
    if (s.round !== round) {
      this.views.forEach((v) => v.reset())
      this.capture(s)
    } else if (s.frame !== before) {
      pre.forEach((p, i) => Object.assign(this.prev[i]!, p))
      this.sinceFrame = 0
    } else this.sinceFrame++
    for (const e of events) {
      this.onEvent(e, session)
      this.sfx.event(e, session.live)
    }
    if (!session.live && s.phase === 'matchOver' && s.phaseTick > 120) this.useSession(this.demo())
  }

  private onEvent(e: SimEvent, session: Session): void {
    const s = session.state
    switch (e.type) {
      case 'hit': {
        const defender = e.attacker === 0 ? 1 : 0
        this.fx.hit(e.x, e.y, e.attacker === 0 ? 1 : -1, e.heavy, e.counter)
        if (e.move === 'tapak' || e.move === 'rajawali') {
          this.fx.jurus(e.x, e.y, e.attacker === 0 ? 1 : -1, e.move)
          this.cam.shake = Math.max(this.cam.shake, 0.18)
        }
        this.views[defender].impulse(e.heavy ? 'heavy' : 'hit')
        this.cam.shake = Math.max(this.cam.shake, e.heavy ? 0.1 : 0.035)
        if (e.heavy) this.cam.punch = 1
        this.comboDamage[e.attacker] = e.combo > 1 ? this.comboDamage[e.attacker]! + e.damage : e.damage
        break
      }
      case 'block':
        this.fx.block(e.x, e.y, e.defender === 0 ? -1 : 1)
        this.views[e.defender].impulse('block')
        this.cam.shake = Math.max(this.cam.shake, 0.02)
        break
      case 'dash':
        this.fx.dust(s.fighters[e.player].x, false)
        break
      case 'parry': {
        const attacker = e.defender === 0 ? 1 : 0
        this.fx.parry(e.x, e.y, e.defender === 0 ? 1 : -1)
        this.views[attacker].impulse('parried')
        this.cam.punch = 1
        this.cam.shake = Math.max(this.cam.shake, 0.05)
        this.flash = Math.max(this.flash, 0.35)
        break
      }
      case 'throwBreak':
        this.fx.burst(e.x, 1.2)
        break
      case 'slam':
        this.cam.shake = 0.14
        break
      case 'floor':
        this.fx.dust(e.x)
        break
      case 'land':
        this.fx.dust(s.fighters[e.player].x, false)
        break
      case 'ko':
        this.flash = 1
        this.cam.shake = 0.18
        break
      default:
        break
    }
    if (!session.live) return
    const name = (i: 0 | 1) => FIGHTERS[s.roster[i]].name
    switch (e.type) {
      case 'roundStart': {
        const final = s.scores[0] === s.scores[1] && s.scores[0] > 0
        this.hud.say(final ? 'Ronde Penentuan' : `Ronde ${e.round}`, `${name(0)} vs ${name(1)}`, 2.0)
        break
      }
      case 'fight':
        this.hud.say('Mulai!', '', 0.8)
        break
      case 'hit':
        this.hud.combo(e.attacker, e.combo, this.comboDamage[e.attacker]!)
        if (e.counter) this.hud.pop('Counter!')
        else if (e.move === 'kick3' && e.combo >= 3) this.hud.pop('Melambung!', 0.8)
        if (e.move === 'tapak' || e.move === 'rajawali') this.hud.pop(`${e.combo > 1 ? 'Cancel! ' : ''}${e.move === 'tapak' ? 'Tapak Harimau!' : 'Tendangan Rajawali!'}`, 1.1)
        break
      case 'grab':
        this.hud.pop(e.attacker === 0 ? 'Bantingan!' : 'Dibanting! Pencet Pukul!', 1.0)
        break
      case 'throwBreak':
        this.hud.pop('Lepas!')
        break
      case 'parry':
        this.hud.pop(e.defender === 0 ? 'Tepis! Balas!' : 'Ditepis!', 1.0)
        break
      case 'ko':
        this.hud.say('KO!', '', 2.2, true)
        break
      case 'timeUp':
        this.hud.say('Waktu Habis!', '', 1.6)
        break
      case 'roundOver': {
        const r = e.result
        const delay = r.reason === 'ko' || r.reason === 'double' ? 1800 : 1500
        const main = r.winner === -1 ? 'Seri!' : r.winner === 0 ? 'Kamu Menang!' : `${name(r.winner)} Menang`
        const sub = r.perfect ? 'Sempurna, tanpa luka!' : r.winner === -1 ? 'Nggak ada yang dapat poin.' : `Skor ${s.scores[0]} – ${s.scores[1]}`
        setTimeout(() => {
          if (this.session === session) this.hud.say(main, sub, 2.2)
        }, delay)
        break
      }
      case 'matchOver': {
        const won = e.winner === 0
        $('result-title').textContent = e.winner === -1 ? 'Seri!' : won ? 'Kamu menang!' : 'Kalah…'
        $('result-score').textContent = `${s.scores[0]} – ${s.scores[1]}`
        $('result-sub').textContent =
          e.winner === -1
            ? 'Sama kuat. Besok tanding lagi.'
            : won
              ? `${name(0)} juara padepokan sore ini.`
              : `${name(1)} masih terlalu kuat. Latihan lagi, coba tangkis dan banting.`
        $('pause').hidden = true
        this.showOnly('result')
        break
      }
      default:
        break
    }
  }

  private draw(s: MatchState, sub: number, dt: number): void {
    const xs: number[] = []
    s.fighters.forEach((f, i) => {
      const p = this.prev[i]!
      const x = p.x + (f.x - p.x) * sub
      const y = Math.max(0, p.y + (f.y - p.y) * sub)
      xs.push(x)
      this.views[i]!.update(f, s, x, y, Math.max(0, f.actTick - 1 + sub), this.clock, dt)
    })
    this.fx.update(dt)

    // Side-on camera framing both fighters; zooms out as they separate.
    const mid = (xs[0]! + xs[1]!) / 2
    const sep = Math.abs(xs[1]! - xs[0]!)
    const vfov = THREE.MathUtils.degToRad(this.camera.fov)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect)
    const needW = sep + 3.3
    let dist = Math.max(needW / 2 / Math.tan(hfov / 2), 3.1 / 2 / Math.tan(vfov / 2))
    let target = mid
    let y = 1.25
    // KO: drift in on the loser while time crawls.
    const ko = s.phase === 'roundOver' && s.lastResult && s.lastResult.winner !== -1 && s.slow > 0
    if (ko) {
      const loser = s.lastResult!.winner === 0 ? 1 : 0
      target = xs[loser]! * 0.6 + mid * 0.4
      dist *= 0.72
      y = 1.0
    }
    dist = Math.min(11, Math.max(3.6, Number.isFinite(dist) ? dist : 6))
    const k = 1 - Math.exp(-dt * (ko ? 2.5 : 4))
    this.cam.x += (target - this.cam.x) * k
    this.cam.dist += (dist - this.cam.dist) * k
    this.cam.y += (y - this.cam.y) * k
    this.cam.shake *= Math.exp(-dt * 9)
    // Heavy hits punch the camera in a touch.
    this.cam.punch *= Math.exp(-dt * 7)
    const sx = (Math.random() - 0.5) * this.cam.shake
    const sy = (Math.random() - 0.5) * this.cam.shake
    this.camera.position.set(this.cam.x + sx, this.cam.y + 0.25 + sy, this.cam.dist * (1 - 0.05 * this.cam.punch))
    this.camera.lookAt(this.cam.x + sx * 0.5, this.cam.y - 0.1, 0)

    this.flash *= Math.exp(-dt * 5)
    $('flash').style.opacity = String(this.flash * 0.7)
    this.world.update(this.clock, dt, this.cam.x)
    this.renderer.render(this.scene, this.camera)
  }
}
