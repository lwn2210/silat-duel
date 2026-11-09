import { DOWN_MAX, DOWN_MIN, PARRY_WINDOW, THROW_ESCAPE } from '../sim/constants'
import { canAct, gap, IDLE, moveOf, type Input, type MatchState } from '../sim/match'
import { FIGHTERS, MOVES } from '../sim/moves'
import { createRng, type Rng } from '../sim/rng'

// The computer opponent. It only produces Inputs, exactly like a player, so
// the sim cannot tell it apart from a person and it never cheats. Its levels
// differ in how late it notices an attack (reaction, in frames) and how often
// it picks the right answer.

export type BotLevel = 'mudah' | 'sedang' | 'jago'

interface Profile {
  /** Frames into the opponent's move before the bot notices it. */
  reaction: number
  /** Chance of guarding a noticed attack. */
  block: number
  /** Chance of crouching for a low it is guarding against. */
  lowRead: number
  /** Chance of breaking a throw. */
  escape: number
  /** Chance of punishing an unsafe move with a jab string. */
  punish: number
  /** Ticks between offensive decisions. */
  think: number
  /** Chance of attacking rather than waiting at close range. */
  aggression: number
  /** Chance of cancelling a move that hit into the jurus. */
  cancel: number
  /** Chance of chasing a launched opponent with a juggle. */
  juggle: number
  /** Chance of answering a noticed high/mid strike with a Tepis instead of a guard. */
  parry: number
}

const PROFILES: Record<BotLevel, Profile> = {
  mudah: { reaction: 24, block: 0.22, lowRead: 0.2, escape: 0.12, punish: 0.1, think: 24, aggression: 0.45, cancel: 0, juggle: 0.1, parry: 0 },
  sedang: { reaction: 15, block: 0.5, lowRead: 0.45, escape: 0.4, punish: 0.45, think: 13, aggression: 0.6, cancel: 0.25, juggle: 0.45, parry: 0.08 },
  jago: { reaction: 9, block: 0.82, lowRead: 0.75, escape: 0.75, punish: 0.85, think: 7, aggression: 0.7, cancel: 0.65, juggle: 0.9, parry: 0.35 },
}

type Step = { input: Input; ticks: number }
type Guard = 'none' | 'stand' | 'crouch' | 'duck' | 'parry'

export class Bot {
  private readonly profile: Profile
  private readonly rng: Rng
  private plan: Step[] = []
  private nextThink = 0
  private hold: Input = IDLE
  private guardKey = ''
  private guard: Guard = 'none'
  private punishKey = ''
  private comboKey = ''
  private parried = ''
  private escapeAt = -1
  private wakeAt = -1

  constructor(
    readonly me: 0 | 1,
    level: BotLevel,
    seed: number,
  ) {
    this.profile = PROFILES[level]
    this.rng = createRng(seed)
  }

  think(s: MatchState): Input {
    const f = s.fighters[this.me]
    const o = s.fighters[this.me === 0 ? 1 : 0]
    const p = this.profile
    if (s.phase !== 'fight') {
      this.plan = []
      this.hold = IDLE
      this.nextThink = 0
      return IDLE
    }
    const fwd = f.facing
    const back = -f.facing as -1 | 1

    // Grabbed: maybe mash out once it notices.
    if (f.act === 'thrown') {
      if (this.escapeAt < 0) this.escapeAt = this.rng() < p.escape ? Math.min(p.reaction, THROW_ESCAPE - 3) : 999
      return f.actTick >= this.escapeAt ? { ...IDLE, punch: s.tick % 2 === 0 } : IDLE
    }
    this.escapeAt = -1

    // On the floor: get up at a random moment.
    if (f.act === 'down') {
      if (this.wakeAt < 0) this.wakeAt = DOWN_MIN + Math.floor(this.rng() * (DOWN_MAX - DOWN_MIN))
      return f.actTick >= this.wakeAt ? { ...IDLE, punch: s.tick % 2 === 0 } : IDLE
    }
    this.wakeAt = -1

    // Defence: notice the opponent's move `reaction` frames in, then guard (or not).
    const om = moveOf(o)
    const moveKey = om ? `${s.frame - o.actTick}:${om.id}` : ''
    if (om && !o.moveHit && o.actTick < om.startup + om.active && gap(o, f) <= om.reach + om.advance + 0.4) {
      if (o.actTick >= p.reaction) {
        if (this.guardKey !== moveKey) {
          this.guardKey = moveKey
          this.guard = this.chooseGuard(om.height)
        }
        if (this.guard === 'parry') {
          // Time the Tepis so its window covers the strike's first active frame.
          if (canAct(f) && this.parried !== moveKey && o.actTick >= om.startup - PARRY_WINDOW + 2) {
            this.parried = moveKey
            this.plan = []
            return { ...IDLE, parry: true }
          }
          if (canAct(f) || f.act === 'parry') return IDLE
        } else if (this.guard !== 'none' && (canAct(f) || f.act === 'blockstun')) {
          this.plan = []
          return this.guardInput(this.guard, back)
        }
      }
    }
    if (f.act === 'blockstun') return { ...IDLE, x: back, y: f.crouched ? -1 : 0 }

    // Punish a blocked or whiffed move that leaves the opponent open.
    if (canAct(f) && om && o.actTick >= om.startup + om.active && om.total - o.actTick >= 11 && moveKey !== this.punishKey) {
      this.punishKey = moveKey
      if (gap(f, o) <= MOVES.jab.reach + 0.05 && this.rng() < p.punish) this.plan = this.jabString(true)
    }

    // Combos: on a confirmed hit, cancel into the jurus; chase a launched opponent.
    const mine = moveOf(f)
    if (mine?.cancel && f.moveHit && (o.act === 'hitstun' || o.act === 'air')) {
      const key = `c${s.frame - f.actTick}`
      if (key !== this.comboKey) {
        this.comboKey = key
        if (this.rng() < p.cancel) this.plan = [...this.press({ special: true }, 4)]
      }
    }
    // A parried opponent reels: punish with a string (and maybe a cancel).
    if (o.act === 'stagger' && canAct(f) && this.plan.length === 0) {
      const key = `s${s.frame - o.actTick}`
      if (key !== this.comboKey) {
        this.comboKey = key
        if (this.rng() < Math.max(p.punish, 0.3)) this.plan = this.jabString(true)
      }
    }
    if (o.act === 'air' && canAct(f) && this.plan.length === 0 && gap(f, o) < 1.3) {
      const key = `j${s.frame - o.actTick}`
      if (key !== this.comboKey) {
        this.comboKey = key
        if (this.rng() < p.juggle) this.plan = this.rng() < 0.5 ? this.jabString(true) : [...this.press({ punch: true }, 7), ...this.press({ punch: true }, 6)]
      }
    }

    if (this.plan.length > 0) return this.next()
    if (!canAct(f)) return f.act === 'jump' && this.rng() < 0.05 ? { ...IDLE, kick: true } : IDLE
    if (s.tick < this.nextThink) return this.hold
    this.nextThink = s.tick + p.think + Math.floor(this.rng() * p.think)
    this.decide(s, fwd, back)
    return this.plan.length > 0 ? this.next() : this.hold
  }

  private chooseGuard(height: string): Guard {
    const p = this.profile
    if (height === 'throw') return this.rng() < p.block * 0.5 ? 'duck' : 'none'
    if (this.rng() >= p.block) return 'none'
    if (height !== 'low' && this.rng() < p.parry) return 'parry'
    if (height === 'low') return this.rng() < p.lowRead ? 'crouch' : 'stand'
    if (height === 'high' && this.rng() < 0.25) return 'duck'
    return 'stand'
  }

  private guardInput(g: Guard, back: -1 | 1): Input {
    if (g === 'duck') return { ...IDLE, y: -1 }
    return { ...IDLE, x: back, y: g === 'crouch' ? -1 : 0 }
  }

  private next(): Input {
    const step = this.plan[0]!
    step.ticks--
    if (step.ticks <= 0) this.plan.shift()
    return step.input
  }

  private press(b: Partial<Input>, wait: number): Step[] {
    return [
      { input: { ...IDLE, ...b }, ticks: 1 },
      { input: IDLE, ticks: wait },
    ]
  }

  private jabString(finish: boolean): Step[] {
    return [...this.press({ punch: true }, 7), ...this.press({ punch: true }, 7), ...(finish ? this.press({ kick: true }, 6) : [])]
  }

  private decide(s: MatchState, fwd: -1 | 1, back: -1 | 1): void {
    const f = s.fighters[this.me]
    const o = s.fighters[this.me === 0 ? 1 : 0]
    const p = this.profile
    const g = gap(f, o)
    const r = this.rng()
    const special = MOVES[FIGHTERS[f.id].special]
    this.hold = IDLE

    if (g > 1.7) {
      // Far: close in, sometimes with a dash.
      if (r < 0.3) this.plan = [...this.press({ x: fwd }, 2), { input: { ...IDLE, x: fwd }, ticks: 18 }]
      else this.hold = { ...IDLE, x: fwd }
      return
    }
    if (g > special.reach + special.advance * 0.6 && g > 1.05) {
      // Middle distance: walk in, wait, or lunge with the jurus.
      if (r < 0.14 * p.aggression + 0.04) this.plan = this.press({ special: true }, 10)
      else if (r < 0.65) this.hold = { ...IDLE, x: fwd }
      else if (r < 0.9) this.hold = { ...IDLE, x: back }
      else this.plan = [...this.press({ x: back }, 2), ...this.press({ x: back }, 14)]
      return
    }
    if (g > 1.05) {
      if (r < 0.25 * p.aggression) this.plan = this.press({ special: true }, 10)
      else if (r < 0.4) this.plan = [...this.press({ kick: true }, 10)]
      else this.hold = { ...IDLE, x: fwd }
      return
    }

    // Close range.
    if (r > p.aggression) {
      const low = this.rng() < 0.3
      this.hold = { ...IDLE, x: back, y: low ? -1 : 0 }
      return
    }
    const turtling = o.act === 'walkB' || o.act === 'blockstun'
    const pick = this.rng()
    if (pick < 0.22) this.plan = this.jabString(this.rng() < 0.65)
    else if (pick < 0.3) this.plan = [...this.press({ punch: true }, 7), ...this.press({ kick: true }, 12), { input: { ...IDLE, y: -1 }, ticks: 2 }, { input: { ...IDLE, y: -1, kick: true }, ticks: 1 }, { input: IDLE, ticks: 10 }]
    else if (pick < 0.38) this.plan = this.press({ punch: true }, 10)
    else if (pick < 0.46) this.plan = [...this.press({ kick: true }, 10), ...this.press({ kick: true }, 12)]
    else if (pick < 0.54) this.plan = this.press({ kick: true }, 12)
    else if (pick < 0.64) this.plan = this.press({ y: -1, punch: true }, 12)
    else if (pick < 0.72) this.plan = this.press({ y: -1, kick: true }, 14)
    else if (pick < (turtling ? 0.95 : 0.84)) this.plan = this.press({ grab: true }, 14)
    else if (pick < 0.92) this.plan = this.press({ special: true }, 12)
    else this.plan = [...this.press({ x: back }, 2), ...this.press({ x: back }, 14)]
  }
}
