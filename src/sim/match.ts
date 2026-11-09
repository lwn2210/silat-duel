import {
  AIR_LAND_DOWN,
  AIR_Y,
  BACKDASH_FRAMES,
  BACKDASH_V,
  BLOCKSTOP,
  BODY_HALF,
  BREAK_FRAMES,
  BREAK_PUSH,
  BUFFER_FRAMES,
  CANCEL_BUFFER,
  CANCEL_WINDOW,
  COUNTER_DAMAGE,
  COUNTER_STUN,
  DASH_FRAMES,
  DASH_V,
  DOUBLE_TAP,
  DOWN_MAX,
  DOWN_MIN,
  DOWN_PUSH,
  DOWN_V,
  FRICTION,
  GRAVITY,
  HITSTOP,
  HITSTOP_HEAVY,
  INTRO_TICKS,
  JUGGLE_DECAY,
  JUGGLE_POP,
  JUMP_DRIFT,
  JUMP_SQUAT,
  JUMP_V,
  KO_SLOW_TICKS,
  LAND_FRAMES,
  MAX_HP,
  MAX_ROUNDS,
  MOTION_WINDOW,
  PARRY_RECOVER,
  PARRY_STOP,
  PARRY_TOTAL,
  PARRY_WINDOW,
  PUSH_DIST,
  RELAUNCH_DECAY,
  RISE_FRAMES,
  ROUND_OVER_TICKS,
  ROUND_TICKS,
  ROUNDS_TO_WIN,
  SLOW_FACTOR,
  STAGGER_FRAMES,
  STAGE_HALF,
  START_X,
  THROW_END,
  THROW_ESCAPE,
  THROW_SLAM,
} from './constants'
import { CANCEL_STARTUP, comboScale, FIGHTERS, isActive, MOVES, type ChainKey, type FighterId, type Height, type MoveData, type MoveId } from './moves'

// The whole duel as plain data and one step function. No DOM, no clocks, no
// Math.random: the same seed and inputs always give the same match, and the
// state serialises as JSON, so it can run in a browser, a test or a server
// room unchanged.
//
// Two clocks: `tick` always advances (60 per second); `frame` is world time,
// which stands still during hit-stop and crawls during the KO slow motion.
// Frame data counts world frames.

export interface Input {
  /** World direction: −1 left, +1 right. Forward/back depends on which way you face. */
  x: -1 | 0 | 1
  /** −1 down (crouch), +1 up (hop). */
  y: -1 | 0 | 1
  punch: boolean
  kick: boolean
  special: boolean
  grab: boolean
  /** Tepis: deflect a strike that lands within the next few frames. */
  parry: boolean
}

export const IDLE: Input = { x: 0, y: 0, punch: false, kick: false, special: false, grab: false, parry: false }

/** What was newly pressed, relative to facing. */
interface Presses {
  punch: boolean
  kick: boolean
  special: boolean
  grab: boolean
  parry: boolean
  fwd: boolean
  back: boolean
  up: boolean
}

const NO_PRESS: Presses = { punch: false, kick: false, special: false, grab: false, parry: false, fwd: false, back: false, up: false }

export type Act =
  | 'idle'
  | 'walkF'
  | 'walkB'
  | 'crouch'
  | 'jumpSquat'
  | 'jump'
  | 'land'
  | 'dashF'
  | 'dashB'
  | 'attack'
  | 'hitstun'
  | 'blockstun'
  | 'throwing'
  | 'thrown'
  | 'throwBreak'
  | 'parry'
  | 'deflect'
  | 'stagger'
  | 'air'
  | 'down'
  | 'rise'
  | 'ko'
  | 'win'

export interface Fighter {
  id: FighterId
  x: number
  /** Feet height above the floor. */
  y: number
  vx: number
  vy: number
  facing: 1 | -1
  hp: number
  act: Act
  /** Frames spent in the current act (1 on its first frame). */
  actTick: number
  /** Length of hitstun / blockstun / break. */
  actLen: number
  move: MoveId | null
  /** The current move already connected or was blocked. */
  moveHit: boolean
  /** Chained follow-up waiting for its frame. */
  buffer: MoveId | null
  /** Stance during stun: crouching hit or crouch guard. */
  crouched: boolean
  /** Hits taken in the current combo. */
  combo: number
  /** Hits taken while juggled in the air (each pops less). */
  juggle: number
  /** A button pressed while busy, played on the first free frame if recent enough. */
  queue: { punch: boolean; kick: boolean; special: boolean; grab: boolean; parry: boolean; at: number } | null
  /** Frame the Jurus was pressed during an attack, for cancelling once it connects. */
  cancelAt: number
  /** Which hit reaction to show (0–2). */
  hitVariant: number
  /** Height of the last hit taken, for the reaction pose. */
  hitHeight: Height
  jumpDir: -1 | 0 | 1
  /** Input on the previous tick, for detecting presses. */
  held: Input
  /** Presses made while the world was frozen, delivered on the next world frame. */
  pending: Presses
  lastFwdTap: number
  lastBackTap: number
  lastDown: number
}

export type Phase = 'intro' | 'fight' | 'roundOver' | 'matchOver'
export type EndReason = 'ko' | 'time' | 'double'

export interface RoundResult {
  /** 0 or 1, or −1 for a draw. */
  winner: -1 | 0 | 1
  reason: EndReason
  /** Perfect: the winner took no damage. */
  perfect: boolean
}

export interface MatchState {
  seed: number
  rng: number
  tick: number
  frame: number
  phase: Phase
  phaseTick: number
  round: number
  scores: [number, number]
  /** Ticks left on the round clock. */
  timer: number
  roster: [FighterId, FighterId]
  fighters: [Fighter, Fighter]
  hitstop: number
  slow: number
  lastResult: RoundResult | null
  /** Set when the match is over; −1 = draw. */
  winner: -1 | 0 | 1 | null
}

export type SimEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'fight' }
  | { type: 'swing'; player: 0 | 1; move: MoveId }
  | { type: 'hit'; attacker: 0 | 1; move: MoveId; x: number; y: number; damage: number; combo: number; counter: boolean; heavy: boolean }
  | { type: 'block'; defender: 0 | 1; move: MoveId; x: number; y: number; heavy: boolean }
  | { type: 'grab'; attacker: 0 | 1 }
  | { type: 'throwBreak'; x: number }
  | { type: 'parry'; defender: 0 | 1; move: MoveId; x: number; y: number }
  | { type: 'slam'; attacker: 0 | 1; x: number; damage: number }
  | { type: 'floor'; player: 0 | 1; x: number }
  | { type: 'jump'; player: 0 | 1 }
  | { type: 'land'; player: 0 | 1 }
  | { type: 'dash'; player: 0 | 1 }
  | { type: 'ko'; loser: -1 | 0 | 1 }
  | { type: 'timeUp' }
  | { type: 'roundOver'; result: RoundResult }
  | { type: 'matchOver'; winner: -1 | 0 | 1 }

// ---- Setup ---------------------------------------------------------------------------

function newFighter(id: FighterId, side: 0 | 1): Fighter {
  return {
    id,
    x: side === 0 ? -START_X : START_X,
    y: 0,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: MAX_HP,
    act: 'idle',
    actTick: 0,
    actLen: 0,
    move: null,
    moveHit: false,
    buffer: null,
    crouched: false,
    combo: 0,
    juggle: 0,
    queue: null,
    cancelAt: -99,
    hitVariant: 0,
    hitHeight: 'mid',
    jumpDir: 0,
    held: { ...IDLE },
    pending: { ...NO_PRESS },
    lastFwdTap: -99,
    lastBackTap: -99,
    lastDown: -99,
  }
}

export function createMatch(seed: number, roster: [FighterId, FighterId] = ['jaka', 'sari']): MatchState {
  return {
    seed: seed >>> 0,
    rng: seed >>> 0,
    tick: 0,
    frame: 0,
    phase: 'intro',
    phaseTick: 0,
    round: 1,
    scores: [0, 0],
    timer: ROUND_TICKS,
    roster: [...roster],
    fighters: [newFighter(roster[0], 0), newFighter(roster[1], 1)],
    hitstop: 0,
    slow: 0,
    lastResult: null,
    winner: null,
  }
}

/** mulberry32, with its state kept in the match so it survives JSON. */
function random(s: MatchState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0
  let t = s.rng
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// ---- Queries (also used by the bot and the renderer) ------------------------------------

export function moveOf(f: Fighter): MoveData | null {
  return f.act === 'attack' && f.move ? MOVES[f.move] : null
}

export type Stance = 'stand' | 'crouch' | 'air' | 'juggle' | 'out'

export function stanceOf(f: Fighter): Stance {
  if (f.act === 'down' || f.act === 'rise' || f.act === 'ko' || f.act === 'thrown' || f.act === 'throwing') return 'out'
  if (f.act === 'air') return 'juggle'
  if (f.y > AIR_Y) return 'air'
  const m = moveOf(f)
  if (f.act === 'crouch' || m?.crouching) return 'crouch'
  if ((f.act === 'hitstun' || f.act === 'blockstun') && f.crouched) return 'crouch'
  return 'stand'
}

/** Can start a new action this frame. */
export function canAct(f: Fighter): boolean {
  return f.act === 'idle' || f.act === 'walkF' || f.act === 'walkB' || f.act === 'crouch'
}

/** Forward distance from `a` to the front of `b`'s body. */
export function gap(a: Fighter, b: Fighter): number {
  return (b.x - a.x) * a.facing - BODY_HALF
}

// ---- Step ------------------------------------------------------------------------------

export function step(s: MatchState, inputs: [Input, Input]): SimEvent[] {
  const events: SimEvent[] = []
  s.tick++
  s.phaseTick++

  const live = s.phase === 'fight'
  const used: [Input, Input] = live ? inputs : [IDLE, IDLE]
  const presses = s.fighters.map((f, i) => readPresses(f, used[i]!)) as [Presses, Presses]

  let advance = true
  if (s.hitstop > 0) {
    s.hitstop--
    advance = false
  } else if (s.slow > 0) {
    s.slow--
    advance = s.slow % SLOW_FACTOR === 0
  }

  if (advance) {
    s.frame++
    const merged = s.fighters.map((f, i) => {
      const p = mergePresses(f.pending, presses[i]!)
      f.pending = { ...NO_PRESS }
      return p
    })
    for (const i of [0, 1] as const) updateFighter(s, i, used[i], merged[i]!, events)
    if (s.phase === 'fight') resolveContact(s, used, events)
    separate(s)
    if (s.phase === 'fight') checkKo(s, events)
  } else {
    s.fighters.forEach((f, i) => (f.pending = mergePresses(f.pending, presses[i]!)))
  }

  runPhase(s, events)
  return events
}

function readPresses(f: Fighter, input: Input): Presses {
  const prev = f.held
  const fwd = input.x === f.facing
  const back = input.x === -f.facing
  const p: Presses = {
    punch: input.punch && !prev.punch,
    kick: input.kick && !prev.kick,
    special: input.special && !prev.special,
    parry: input.parry && !prev.parry,
    grab: input.grab && !prev.grab,
    fwd: fwd && prev.x !== f.facing,
    back: back && prev.x !== -f.facing,
    up: input.y === 1 && prev.y !== 1,
  }
  f.held = { ...input }
  return p
}

function mergePresses(a: Presses, b: Presses): Presses {
  return {
    punch: a.punch || b.punch,
    kick: a.kick || b.kick,
    special: a.special || b.special,
    parry: a.parry || b.parry,
    grab: a.grab || b.grab,
    fwd: a.fwd || b.fwd,
    back: a.back || b.back,
    up: a.up || b.up,
  }
}

// ---- Match flow ------------------------------------------------------------------------

function runPhase(s: MatchState, events: SimEvent[]): void {
  switch (s.phase) {
    case 'intro':
      if (s.phaseTick === 1) events.push({ type: 'roundStart', round: s.round })
      if (s.phaseTick >= INTRO_TICKS) {
        s.phase = 'fight'
        s.phaseTick = 0
        events.push({ type: 'fight' })
      }
      break
    case 'fight':
      s.timer--
      if (s.timer <= 0) {
        s.timer = 0
        events.push({ type: 'timeUp' })
        const [a, b] = s.fighters
        const winner = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1
        endRound(s, { winner, reason: 'time', perfect: winner !== -1 && s.fighters[winner].hp === MAX_HP }, events)
      }
      break
    case 'roundOver': {
      // Once the dust settles, the winner strikes a pose.
      const w = s.lastResult?.winner ?? -1
      if (w !== -1 && s.slow === 0) {
        const f = s.fighters[w]
        if (canAct(f) && s.phaseTick > 40) setAct(f, 'win')
      }
      if (s.phaseTick >= ROUND_OVER_TICKS) nextRound(s, events)
      break
    }
    case 'matchOver':
      break
  }
}

function endRound(s: MatchState, result: RoundResult, events: SimEvent[]): void {
  s.phase = 'roundOver'
  s.phaseTick = 0
  s.lastResult = result
  if (result.winner !== -1) s.scores[result.winner]++
  events.push({ type: 'roundOver', result })
}

function nextRound(s: MatchState, events: SimEvent[]): void {
  const [a, b] = s.scores
  const decided = a >= ROUNDS_TO_WIN || b >= ROUNDS_TO_WIN || s.round >= MAX_ROUNDS
  if (decided) {
    s.phase = 'matchOver'
    s.phaseTick = 0
    s.winner = a === b ? -1 : a > b ? 0 : 1
    events.push({ type: 'matchOver', winner: s.winner })
    return
  }
  s.round++
  s.phase = 'intro'
  s.phaseTick = 0
  s.timer = ROUND_TICKS
  s.hitstop = 0
  s.slow = 0
  s.fighters = [newFighter(s.roster[0], 0), newFighter(s.roster[1], 1)]
}

function checkKo(s: MatchState, events: SimEvent[]): void {
  const [a, b] = s.fighters
  if (a.hp > 0 && b.hp > 0) return
  const winner = a.hp <= 0 && b.hp <= 0 ? -1 : a.hp <= 0 ? 1 : 0
  events.push({ type: 'ko', loser: winner === -1 ? -1 : winner === 0 ? 1 : 0 })
  s.slow = KO_SLOW_TICKS
  s.hitstop = 0
  endRound(s, { winner, reason: winner === -1 ? 'double' : 'ko', perfect: winner !== -1 && s.fighters[winner].hp === MAX_HP }, events)
}

// ---- One fighter, one world frame --------------------------------------------------------

function setAct(f: Fighter, act: Act, len = 0): void {
  f.act = act
  f.actTick = 0
  f.actLen = len
  if (act !== 'attack') {
    f.move = null
    f.buffer = null
  }
}

function startMove(f: Fighter, id: MoveId): void {
  setAct(f, 'attack')
  f.move = id
  f.moveHit = false
  f.buffer = null
  f.cancelAt = -99
}

/** Cancel into a jurus: it skips its wind-up (and covers that part of its lunge at once). */
function cancelInto(f: Fighter, id: MoveId): void {
  const m = MOVES[id]
  const skip = Math.max(0, m.startup - CANCEL_STARTUP)
  startMove(f, id)
  f.actTick = skip
  f.x += (f.facing * m.advance * skip) / m.startup
  f.queue = null
}

/** Acts during which a press is held for the first free frame. */
const QUEUEABLE: ReadonlySet<Act> = new Set<Act>(['attack', 'land', 'hitstun', 'blockstun', 'dashF', 'dashB', 'throwBreak', 'rise', 'deflect'])

function updateFighter(s: MatchState, i: 0 | 1, input: Input, p: Presses, events: SimEvent[]): void {
  const f = s.fighters[i]
  const o = s.fighters[i === 0 ? 1 : 0]
  const stats = FIGHTERS[f.id]
  if (canAct(f)) f.facing = o.x >= f.x ? 1 : -1
  const fwd = input.x === f.facing
  const back = input.x === -f.facing
  const down = input.y === -1
  const up = input.y === 1
  const any = p.punch || p.kick || p.special || p.grab || p.fwd || p.back || p.up

  // Double taps and the ↓ → motion are remembered whatever the fighter is doing.
  let dash: 'F' | 'B' | null = null
  if (p.fwd) {
    if (s.frame - f.lastFwdTap <= DOUBLE_TAP) {
      dash = 'F'
      f.lastFwdTap = -99
    } else f.lastFwdTap = s.frame
  }
  if (p.back) {
    if (s.frame - f.lastBackTap <= DOUBLE_TAP) {
      dash = 'B'
      f.lastBackTap = -99
    } else f.lastBackTap = s.frame
  }
  const motion = s.frame - f.lastDown <= MOTION_WINDOW && !down && fwd
  if (down) f.lastDown = s.frame

  // ---- Decide ----
  if (canAct(f)) {
    // Presses buffered during the last frames of a recovery come out now.
    const q = f.queue && s.frame - f.queue.at <= BUFFER_FRAMES ? f.queue : null
    f.queue = null
    const punch = p.punch || !!q?.punch
    const kick = p.kick || !!q?.kick
    const grab = p.grab || !!q?.grab || (punch && kick)
    if (grab) startMove(f, 'throw')
    else if (p.parry || q?.parry) setAct(f, 'parry')
    else if (p.special || q?.special || (punch && motion)) startMove(f, stats.special)
    else if (down && punch) startMove(f, 'lowPunch')
    else if (down && kick) startMove(f, 'sweep')
    else if (punch) startMove(f, 'jab')
    else if (kick) startMove(f, 'kick')
    else if (dash === 'F') {
      setAct(f, 'dashF')
      events.push({ type: 'dash', player: i })
    } else if (dash === 'B') {
      setAct(f, 'dashB')
      events.push({ type: 'dash', player: i })
    } else if (up) setAct(f, 'jumpSquat')
    else {
      const next: Act = down ? 'crouch' : fwd ? 'walkF' : back ? 'walkB' : 'idle'
      if (next !== f.act) setAct(f, next)
    }
  } else if (f.act === 'jump' && (p.punch || p.kick)) {
    startMove(f, 'jumpKick')
  } else if (f.act === 'thrown') {
    if (f.actTick < THROW_ESCAPE && (p.punch || p.grab)) clash(s, events)
  } else if (f.act === 'down') {
    if (f.y === 0 && f.actTick >= DOWN_MIN && any) setAct(f, 'rise')
  } else {
    let used = false
    if (f.act === 'attack' && f.move) {
      const m = MOVES[f.move]
      // Strings: the next button is remembered from the first frame and comes out on its frame.
      if (m.chain && !f.buffer && f.actTick <= (m.chainTo ?? 0)) {
        const key: ChainKey | null = p.kick ? (down && m.chain.dkick ? 'dkick' : 'kick') : p.punch ? 'punch' : null
        const next = key ? m.chain[key] : undefined
        if (next) {
          f.buffer = next
          used = true
        }
      }
      // Cancel into the jurus once the move has connected (hit or block).
      if (p.special || (p.punch && motion && !used)) f.cancelAt = s.frame
      if (m.cancel && f.moveHit && s.frame - f.cancelAt <= CANCEL_BUFFER && f.actTick <= m.startup + m.active + CANCEL_WINDOW) {
        cancelInto(f, stats.special)
        used = true
      }
    }
    if (!used && (p.punch || p.kick || p.special || p.grab || p.parry) && QUEUEABLE.has(f.act)) {
      f.queue = { punch: p.punch, kick: p.kick, special: p.special, grab: p.grab, parry: p.parry, at: s.frame }
    }
  }

  // ---- Advance ----
  f.actTick++
  switch (f.act) {
    case 'idle':
    case 'crouch':
    case 'win':
      break
    case 'walkF':
      f.x += f.facing * stats.walkF
      break
    case 'walkB':
      f.x -= f.facing * stats.walkB
      break
    case 'jumpSquat':
      if (f.actTick >= JUMP_SQUAT) {
        f.jumpDir = fwd ? 1 : back ? -1 : 0
        setAct(f, 'jump')
        f.vy = JUMP_V
        f.y = 0.0001
        events.push({ type: 'jump', player: i })
      }
      break
    case 'jump':
      f.x += f.facing * f.jumpDir * JUMP_DRIFT
      break
    case 'land':
      if (f.actTick >= LAND_FRAMES) setAct(f, 'idle')
      break
    case 'dashF':
      f.x += f.facing * DASH_V * (1 - (f.actTick - 1) / DASH_FRAMES)
      if (f.actTick >= DASH_FRAMES) setAct(f, 'idle')
      break
    case 'dashB':
      f.x -= f.facing * BACKDASH_V * (1 - (f.actTick - 1) / BACKDASH_FRAMES)
      if (f.actTick >= BACKDASH_FRAMES) setAct(f, 'idle')
      break
    case 'attack': {
      const m = MOVES[f.move!]
      if (m.air) f.x += f.facing * f.jumpDir * JUMP_DRIFT
      if (f.actTick <= m.startup) f.x += (f.facing * m.advance) / m.startup
      if (m.hopAt !== undefined && f.actTick >= m.hopAt && f.actTick < m.startup && f.y === 0 && f.vy === 0) {
        f.vy = 0.065
        f.y = 0.0001
      }
      if (f.actTick === Math.max(1, m.startup - 3) && m.height !== 'throw') events.push({ type: 'swing', player: i, move: m.id })
      if (f.buffer && f.actTick >= (m.chainFrom ?? 0)) startMove(f, f.buffer)
      else if (f.actTick >= m.total && !(m.air && f.y > 0)) setAct(f, 'idle')
      break
    }
    case 'hitstun':
    case 'blockstun':
    case 'throwBreak':
    case 'deflect':
    case 'stagger':
      if (f.actTick >= f.actLen) setAct(f, 'idle')
      break
    case 'throwing':
      if (f.actTick === THROW_SLAM) slam(s, i, events)
      if (f.actTick >= THROW_END) setAct(f, 'idle')
      break
    case 'thrown':
      // Held in front of the thrower until the slam.
      f.x = o.x + o.facing * 0.62
      break
    case 'down':
      if (f.y === 0 && f.actTick >= DOWN_MAX) setAct(f, 'rise')
      break
    case 'rise':
      if (f.actTick >= RISE_FRAMES) setAct(f, 'idle')
      break
    case 'parry':
      if (f.actTick >= PARRY_TOTAL) setAct(f, 'idle')
      break
    case 'air':
    case 'ko':
      break
  }

  // ---- Physics ----
  if (f.vx !== 0) {
    f.x += f.vx
    f.vx *= FRICTION
    if (Math.abs(f.vx) < 0.0005) f.vx = 0
  }
  if (f.y > 0 || f.vy !== 0) {
    f.y += f.vy
    f.vy -= GRAVITY
    if (f.y <= 0) {
      f.y = 0
      f.vy = 0
      if (f.act === 'jump' || (f.act === 'attack' && moveOf(f)?.air)) {
        setAct(f, 'land')
        events.push({ type: 'land', player: i })
      } else if (f.act === 'air') {
        // A juggle ends when the body hits the floor.
        setAct(f, 'down')
        f.actTick = AIR_LAND_DOWN
        events.push({ type: 'floor', player: i, x: f.x })
      } else if (f.act === 'down' || f.act === 'ko') {
        events.push({ type: 'floor', player: i, x: f.x })
      }
    }
  }
}

// ---- Contact -------------------------------------------------------------------------------

interface Strike {
  attacker: 0 | 1
  move: MoveData
  blocked: boolean
  crouchGuard: boolean
}

function guarding(d: Fighter, input: Input): boolean {
  const back = input.x === -d.facing
  if (!back) return false
  // A parry that missed its moment still guards if you are holding back.
  return d.act === 'idle' || d.act === 'walkB' || d.act === 'crouch' || d.act === 'blockstun' || (d.act === 'parry' && d.actTick > PARRY_WINDOW)
}

/** Does the move miss this stance entirely? */
function passes(m: MoveData, stance: Stance, y: number): boolean {
  if (stance === 'out') return true
  // Juggled: anything but throws connects, lows only once the body is low again.
  if (stance === 'juggle') return m.height === 'throw' || (m.height === 'low' && y > 0.45)
  if (m.height === 'high') return stance === 'crouch'
  if (m.height === 'low') return stance === 'air'
  if (m.height === 'throw') return stance !== 'stand'
  return false
}

function resolveContact(s: MatchState, inputs: [Input, Input], events: SimEvent[]): void {
  const strikes: Strike[] = []
  const grabs: (0 | 1)[] = []
  const parries: (0 | 1)[] = []
  for (const i of [0, 1] as const) {
    const f = s.fighters[i]
    const o = s.fighters[i === 0 ? 1 : 0]
    const m = moveOf(f)
    if (!m || f.moveHit || !isActive(m, f.actTick)) continue
    if (gap(f, o) > m.reach) continue
    const stance = stanceOf(o)
    if (passes(m, stance, o.y)) continue
    if (m.height === 'throw') {
      grabs.push(i)
      continue
    }
    // Tepis: a high or mid strike landing inside the parry window is deflected.
    if (o.act === 'parry' && o.actTick <= PARRY_WINDOW && (m.height === 'high' || m.height === 'mid')) {
      parries.push(i)
      continue
    }
    const input = inputs[i === 0 ? 1 : 0]
    const crouchGuard = input.y === -1
    let blocked = false
    if (guarding(o, input) && stance !== 'air') {
      // Standing guard stops highs and mids, crouching guard stops lows. Mids hit crouchers.
      blocked = m.height === 'low' ? crouchGuard : !crouchGuard
    }
    strikes.push({ attacker: i, move: m, blocked, crouchGuard })
  }

  for (const i of parries) {
    const f = s.fighters[i]
    const d = s.fighters[i === 0 ? 1 : 0]
    const m = moveOf(f)!
    f.moveHit = true
    setAct(f, 'stagger', STAGGER_FRAMES)
    f.vx = -f.facing * 0.08 * (1 - FRICTION)
    setAct(d, 'deflect', PARRY_RECOVER)
    s.hitstop = Math.max(s.hitstop, PARRY_STOP)
    events.push({ type: 'parry', defender: i === 0 ? 1 : 0, move: m.id, x: d.x - d.facing * BODY_HALF, y: m.height === 'high' ? 1.5 : 1.15 })
  }

  const struck = new Set<number>()
  for (const st of strikes) {
    applyStrike(s, st, events)
    if (!st.blocked) struck.add(st.attacker === 0 ? 1 : 0)
  }

  // A thrower who got hit this frame loses the grab; two grabs at once cancel out.
  const live = grabs.filter((i) => !struck.has(i))
  if (live.length === 2) {
    s.fighters.forEach((f) => (f.moveHit = true))
    clash(s, events)
  } else if (live.length === 1) {
    const i = live[0]!
    const f = s.fighters[i]
    const o = s.fighters[i === 0 ? 1 : 0]
    if (o.act !== 'throwing' && !struck.has(i === 0 ? 1 : 0)) {
      f.moveHit = true
      setAct(f, 'throwing')
      setAct(o, 'thrown')
      o.vx = 0
      o.combo = 0
      events.push({ type: 'grab', attacker: i })
    }
  }
}

function applyStrike(s: MatchState, st: Strike, events: SimEvent[]): void {
  const f = s.fighters[st.attacker]
  const d = s.fighters[st.attacker === 0 ? 1 : 0]
  const m = st.move
  f.moveHit = true
  const hitY = m.height === 'high' ? 1.55 : m.height === 'mid' ? 1.12 : 0.35
  const hitX = d.x - d.facing * BODY_HALF * 0.6
  if (st.blocked) {
    setAct(d, 'blockstun', m.blockstun)
    d.crouched = st.crouchGuard
    d.vx = -d.facing * m.push * 1.3 * (1 - FRICTION)
    s.hitstop = Math.max(s.hitstop, BLOCKSTOP)
    events.push({ type: 'block', defender: st.attacker === 0 ? 1 : 0, move: m.id, x: hitX, y: m.height === 'low' ? 0.45 : hitY, heavy: !!m.heavy })
    return
  }
  const inCombo = d.act === 'hitstun' || d.act === 'air'
  const airborne = d.act === 'air' || d.y > AIR_Y
  // Catching someone mid-move or reeling from a parry is a counter hit.
  const counter = !inCombo && (d.act === 'attack' || d.act === 'jumpSquat' || d.act === 'stagger')
  d.combo = inCombo ? d.combo + 1 : 1
  // Later hits of a combo are worth less, so long juggles stay fair.
  const damage = Math.max(1, Math.round(m.damage * FIGHTERS[f.id].power * (counter ? COUNTER_DAMAGE : 1) * comboScale(d.combo)))
  d.hp = Math.max(0, d.hp - damage)
  d.hitHeight = m.height
  d.hitVariant = Math.floor(random(s) * 3)
  const crouching = stanceOf(d) === 'crouch'
  if (d.hp === 0) knockDown(d, true)
  else if (m.launch || airborne) {
    // Launch or keep juggling: each hit pops the body up again, weaker every time.
    const n = d.act === 'air' ? d.juggle : 0
    setAct(d, 'air')
    d.juggle = n + 1
    d.vy = m.launch ? m.launch * RELAUNCH_DECAY ** n : JUGGLE_POP * JUGGLE_DECAY ** n
    d.y = Math.max(d.y, 0.0001)
    d.vx = -d.facing * (m.knockdown ? 0.05 : 0.025)
  } else if (m.knockdown) knockDown(d, false)
  else {
    setAct(d, 'hitstun', m.hitstun + (counter ? COUNTER_STUN : 0))
    d.crouched = crouching
    d.vx = -d.facing * m.push * (1 - FRICTION)
  }
  const heavy = !!m.heavy || counter || d.hp === 0
  s.hitstop = Math.max(s.hitstop, heavy ? HITSTOP_HEAVY : HITSTOP)
  events.push({ type: 'hit', attacker: st.attacker, move: m.id, x: hitX, y: d.act === 'air' ? Math.max(hitY, d.y + 0.9) : hitY, damage, combo: d.combo, counter, heavy })
}

function knockDown(d: Fighter, ko: boolean): void {
  setAct(d, ko ? 'ko' : 'down')
  d.vy = DOWN_V
  d.y = Math.max(d.y, 0.0001)
  d.vx = -d.facing * DOWN_PUSH
}

function slam(s: MatchState, i: 0 | 1, events: SimEvent[]): void {
  const f = s.fighters[i]
  const d = s.fighters[i === 0 ? 1 : 0]
  if (d.act !== 'thrown') return
  const damage = Math.round(MOVES.throw.damage * FIGHTERS[f.id].power)
  d.hp = Math.max(0, d.hp - damage)
  d.hitHeight = 'mid'
  setAct(d, d.hp === 0 ? 'ko' : 'down')
  d.y = 0
  d.vy = 0
  d.vx = -d.facing * 0.02
  // Straight onto the floor: the down timer starts with the fighter already lying.
  d.actTick = 18
  s.hitstop = HITSTOP_HEAVY
  events.push({ type: 'slam', attacker: i, x: d.x, damage })
  events.push({ type: 'floor', player: i === 0 ? 1 : 0, x: d.x })
}

function clash(s: MatchState, events: SimEvent[]): void {
  for (const f of s.fighters) {
    setAct(f, 'throwBreak', BREAK_FRAMES)
    f.vx = -f.facing * BREAK_PUSH * (1 - FRICTION)
  }
  events.push({ type: 'throwBreak', x: (s.fighters[0].x + s.fighters[1].x) / 2 })
}

// ---- Space ----------------------------------------------------------------------------------

/** Bodies don't overlap and stay on the stage; whoever is against the edge pushes the other. */
function separate(s: MatchState): void {
  const [a, b] = s.fighters
  for (const f of s.fighters) f.x = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, f.x))
  if (a.act === 'thrown' || b.act === 'thrown') return
  const d = b.x - a.x
  if (Math.abs(d) >= PUSH_DIST) return
  const dir = d !== 0 ? Math.sign(d) : a.facing
  const overlap = PUSH_DIST - Math.abs(d)
  a.x -= (dir * overlap) / 2
  b.x += (dir * overlap) / 2
  for (const [f, o, sign] of [
    [a, b, dir],
    [b, a, -dir],
  ] as const) {
    const clamped = Math.max(-STAGE_HALF, Math.min(STAGE_HALF, f.x))
    if (clamped !== f.x) {
      o.x += sign * Math.abs(clamped - f.x)
      f.x = clamped
    }
  }
}
