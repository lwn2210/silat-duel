import { DOWN_MAX, JUMP_SQUAT, LAND_FRAMES, PARRY_TOTAL, PARRY_WINDOW, RISE_FRAMES, THROW_SLAM } from '../sim/constants'
import type { Fighter, MatchState } from '../sim/match'
import { MOVES, type FighterId, type MoveData } from '../sim/moves'

// Keyframed poses. A pose is a handful of joint angles on a model that faces
// +z with its lead (left) side at +x; the renderer mirrors player 1. The sim
// says which act and frame a fighter is on, and this turns that into target
// angles. The rig chases the target with springs (fighterView.ts), which adds
// the overshoot and settle that keep it from looking robotic.
//
// Conventions: limbs are [pitch, roll, bend]. Pitch swings the limb forward,
// roll lifts it out to the side, bend folds the elbow forward / knee back.
// Every strike has four beats: wind-up (anticipation), chamber, impact, and a
// follow-through where the body keeps turning after the limb has landed.

export type Limb = [number, number, number]

export interface Pose {
  /** Pelvis yaw; negative turns the lead side forward (bladed stance). */
  yaw: number
  /** Spine pitch forward. */
  lean: number
  /** Spine yaw on top of the pelvis. */
  twist: number
  /** Spine roll (lean sideways, toward the lead side when positive). */
  side: number
  /** Head pitch, chin down when positive. */
  head: number
  la: Limb
  ra: Limb
  ll: Limb
  rl: Limb
  /** 0 = fists, 1 = open silat hands. */
  open: number
  /** Extra pelvis height (thrown lift, hops); negative sinks into the stance. */
  lift: number
  /** Whole body falls backward around the feet; π/2 = lying on the back. */
  tilt: number
}

export const POSE_KEYS = ['yaw', 'lean', 'twist', 'side', 'head', 'open', 'lift', 'tilt'] as const
export const LIMB_KEYS = ['la', 'ra', 'll', 'rl'] as const

const L = (a: number, b: number, c: number): Limb => [a, b, c]

function guard(id: FighterId): Pose {
  // Jaka: low, wide kuda-kuda. Sari: higher, lighter on her feet. Gatot: kokoh tegap.
  if (id === 'jaka') {
    return { yaw: -0.55, lean: 0.14, twist: 0.2, side: 0, head: 0.08, la: L(1.0, 0.18, 1.15), ra: L(0.5, 0.3, 1.95), ll: L(0.6, 0.18, 0.85), rl: L(-0.42, 0.18, 0.65), open: 1, lift: 0, tilt: 0 }
  }
  if (id === 'sari') {
    return { yaw: -0.5, lean: 0.08, twist: 0.18, side: 0, head: 0.04, la: L(1.15, 0.14, 1.3), ra: L(0.75, 0.22, 2.05), ll: L(0.45, 0.12, 0.6), rl: L(-0.34, 0.12, 0.5), open: 1, lift: 0, tilt: 0 }
  }
  return { yaw: -0.52, lean: 0.11, twist: 0.22, side: 0, head: 0.06, la: L(1.08, 0.2, 1.2), ra: L(0.6, 0.25, 2.0), ll: L(0.55, 0.15, 0.75), rl: L(-0.38, 0.15, 0.6), open: 0.8, lift: 0, tilt: 0 }
}

type Over = Partial<Pose>

function withP(base: Pose, over: Over): Pose {
  return { ...base, ...over }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpLimb(a: Limb, b: Limb, t: number): Limb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
}

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    yaw: lerp(a.yaw, b.yaw, t),
    lean: lerp(a.lean, b.lean, t),
    twist: lerp(a.twist, b.twist, t),
    side: lerp(a.side, b.side, t),
    head: lerp(a.head, b.head, t),
    la: lerpLimb(a.la, b.la, t),
    ra: lerpLimb(a.ra, b.ra, t),
    ll: lerpLimb(a.ll, b.ll, t),
    rl: lerpLimb(a.rl, b.rl, t),
    open: lerp(a.open, b.open, t),
    lift: lerp(a.lift, b.lift, t),
    tilt: lerp(a.tilt, b.tilt, t),
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t)
/** Fast out of the gate, gentle landing: for the snap into an impact. */
const snap = (t: number) => 1 - (1 - t) ** 3

/** Pose at frame `t` along keys [[frame, pose, ease?], …]. */
function track(keys: [number, Pose, ((t: number) => number)?][], t: number): Pose {
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [f1, p1, ease] = keys[i]!
    if (t <= f1) {
      const [f0, p0] = keys[i - 1]!
      return mixPose(p0, p1, (ease ?? smooth)((t - f0) / Math.max(1e-6, f1 - f0)))
    }
  }
  return keys[keys.length - 1]![1]
}

function crouch(g: Pose): Pose {
  return withP(g, { lean: 0.38, head: -0.1, la: L(0.95, 0.2, 1.4), ra: L(0.55, 0.3, 1.9), ll: L(1.15, 0.22, 2.1), rl: L(0.2, 0.25, 2.25) })
}

/** Wind-up, chamber, impact, follow-through, recover. */
function strike(m: MoveData, g: Pose, chamber: Over, hit: Over, follow: Over = {}, windup: Over = {}): [number, Pose, ((t: number) => number)?][] {
  const out = m.startup + m.active
  const hitPose = withP(g, hit)
  const followPose = withP(hitPose, {
    twist: hitPose.twist + (hitPose.twist - g.twist) * 0.25,
    yaw: hitPose.yaw + (hitPose.yaw - g.yaw) * 0.15,
    lean: hitPose.lean + 0.05,
    ...follow,
  })
  const keys: [number, Pose, ((t: number) => number)?][] = [
    [0, g],
    [Math.max(1, Math.round(m.startup * 0.3)), withP(g, { twist: g.twist + 0.12, lean: g.lean - 0.06, lift: -0.03, ...windup })],
    [Math.max(2, m.startup - 4), withP(g, chamber)],
    [m.startup, hitPose, snap],
    [out + 3, followPose],
    [m.total, g],
  ]
  return keys.sort((a, b) => a[0] - b[0])
}

function moveKeys(id: FighterId, m: MoveData): [number, Pose, ((t: number) => number)?][] {
  const g = guard(id)
  const c = crouch(g)
  switch (m.id) {
    case 'jab':
      return strike(m, g, { la: L(1.05, 0.2, 1.7), open: 0, twist: 0.3 }, { la: L(1.58, 0.45, 0.04), yaw: -0.6, twist: -0.12, lean: 0.2, open: 0 }, { la: L(1.45, 0.4, 0.35) })
    case 'jab2':
      return strike(m, g, { ra: L(0.7, 0.3, 2.1), open: 0, twist: -0.1 }, { ra: L(1.58, 0.6, 0.04), la: L(0.8, 0.25, 1.9), yaw: 0.05, twist: 0.6, lean: 0.28, open: 0 }, { ra: L(1.45, 0.55, 0.4) })
    case 'kick3':
      // Crescent kick sweeping upward: the leg arcs from low to high.
      return strike(
        m,
        g,
        { yaw: 0.5, twist: -0.3, rl: L(0.3, 0.7, 1.6), ll: L(0.25, 0.05, 0.45), lift: -0.05 },
        { yaw: 1.3, twist: -0.9, side: -0.3, lean: -0.25, rl: L(1.9, 0.9, 0.1), ll: L(0.1, 0.0, 0.2), la: L(0.5, 1.0, 1.0), ra: L(0.3, 0.8, 1.3), lift: 0.04 },
        { rl: L(2.3, 0.8, 0.4), lean: -0.35 },
      )
    case 'jabKick':
      return strike(m, g, { rl: L(1.2, 0.2, 2.1), lean: -0.05, yaw: -0.1 }, { rl: L(1.4, 0.5, 0.06), ll: L(0.1, 0.1, 0.35), yaw: 0.35, twist: -0.25, lean: -0.15, la: L(0.9, 0.3, 1.5) })
    case 'kick':
      return strike(
        m,
        g,
        { ll: L(1.5, 0.3, 2.05), lean: -0.05, lift: 0.02 },
        { ll: L(1.45, 0.35, 0.05), rl: L(-0.12, 0.1, 0.3), lean: -0.22, yaw: -0.35, la: L(0.9, 0.3, 1.5) },
        { ll: L(1.2, 0.3, 1.0) },
      )
    case 'kick2':
      // Spinning heel kick: full turn of the hips, the leg comes round high.
      return strike(
        m,
        g,
        { yaw: 1.4, twist: 0.6, lean: 0.15, rl: L(0.4, 0.3, 1.4) },
        { yaw: 2.6, twist: -0.8, side: -0.45, lean: -0.15, rl: L(0.75, 1.55, 0.08), ll: L(0.05, 0.0, 0.25), la: L(0.4, 1.1, 0.6), ra: L(0.3, 1.0, 0.8) },
        { yaw: 3.0, rl: L(0.6, 1.2, 0.6) },
        { yaw: -0.8, twist: 0.4 },
      )
    case 'lowPunch':
      return strike(m, c, { la: L(0.8, 0.2, 1.7), open: 0 }, { la: L(1.2, 0.35, 0.05), lean: 0.6, yaw: -0.8, open: 0 })
    case 'sweep':
    case 'sweep2': {
      const low = withP(c, { lean: 0.6, ll: L(1.15, 0.35, 2.4), la: L(0.55, 0.55, 0.3), ra: L(0.6, 0.6, 0.5), lift: -0.05 })
      return strike(m, low, { yaw: -0.2, rl: L(-0.2, 1.2, 0.3) }, { yaw: 1.2, rl: L(0.3, 1.5, 0.05) }, { yaw: 1.9, rl: L(0.5, 1.45, 0.2) })
    }
    case 'tapak':
      return strike(
        m,
        g,
        { la: L(0.3, 0.2, 2.1), ra: L(0.3, 0.2, 2.1), yaw: -0.1, lean: -0.1, ll: L(0.35, 0.15, 0.6), lift: -0.04 },
        { la: L(1.45, 0.08, 0.08), ra: L(1.38, 0.05, 0.12), yaw: -0.05, twist: 0, lean: 0.45, ll: L(1.0, 0.12, 1.05), rl: L(-0.8, 0.12, 0.05), lift: -0.04 },
        { lean: 0.55 },
        { la: L(0.6, 0.6, 1.6), ra: L(0.6, 0.6, 1.6), lean: -0.15 },
      )
    case 'rajawali':
      return strike(
        m,
        g,
        { ll: L(1.4, 0.3, 2.1), rl: L(0.6, 0.1, 2.2), la: L(0.4, 1.35, 0.2), ra: L(0.4, 1.35, 0.2), lean: -0.2 },
        { ll: L(1.55, 0.6, 0.05), rl: L(0.15, 0.1, 1.9), la: L(0.1, 1.5, 0.15), ra: L(0.1, 1.5, 0.15), lean: -0.38, yaw: -0.7 },
        { la: L(-0.2, 1.4, 0.2), ra: L(-0.2, 1.4, 0.2) },
      )
    case 'guntur':
      return strike(
        m,
        g,
        { la: L(0.4, 0.3, 1.8), ra: L(0.2, 0.3, 2.2), yaw: -0.2, lean: -0.15, ll: L(0.4, 0.15, 0.7), lift: -0.05 },
        { la: L(1.5, 0.05, 0.05), ra: L(0.4, 0.4, 1.8), yaw: -0.1, twist: 0.1, lean: 0.48, ll: L(1.1, 0.12, 1.1), rl: L(-0.75, 0.12, 0.1), lift: -0.05 },
        { lean: 0.58 },
        { la: L(0.7, 0.5, 1.4), ra: L(0.5, 0.5, 1.7), lean: -0.12 },
      )
    case 'jumpKick':
      return strike(m, g, { ll: L(1.2, 0.3, 1.9), rl: L(0.5, 0.1, 2.0) }, { ll: L(1.05, 0.45, 0.08), rl: L(0.45, 0.1, 2.0), lean: -0.25, la: L(0.4, 1.0, 0.4), ra: L(0.4, 1.0, 0.4) })
    case 'throw':
      return strike(m, g, { la: L(0.7, 0.4, 1.0), ra: L(0.7, 0.4, 1.0) }, { la: L(1.3, 0.25, 0.5), ra: L(1.3, -0.1, 0.5), lean: 0.3, yaw: -0.2 })
  }
}

const cache = new Map<string, [number, Pose, ((t: number) => number)?][]>()

function keysFor(id: FighterId, m: MoveData): [number, Pose, ((t: number) => number)?][] {
  const key = `${id}:${m.id}`
  let k = cache.get(key)
  if (!k) cache.set(key, (k = moveKeys(id, m)))
  return k
}

/**
 * Silat idle (kembangan): weight rolls side to side, hands drift in slow
 * circles, knees breathe. `c` is seconds.
 */
function idlePose(g: Pose, c: number, id: FighterId): Pose {
  const sp = id === 'sari' ? 1.15 : 0.9
  const a = Math.sin(c * 0.9 * sp)
  const b = Math.sin(c * 1.8 * sp)
  const h1 = c * 1.3 * sp
  return withP(g, {
    side: 0.05 * a,
    yaw: g.yaw + 0.08 * a,
    lean: g.lean + 0.03 * b,
    lift: -0.02 - 0.015 * b,
    head: g.head - 0.03 * a,
    la: L(g.la[0] + 0.12 * Math.sin(h1), g.la[1] + 0.1 * Math.cos(h1), g.la[2] + 0.15 * Math.sin(h1 + 1)),
    ra: L(g.ra[0] + 0.1 * Math.sin(h1 + 2.2), g.ra[1] + 0.08 * Math.cos(h1 + 2.2), g.ra[2] + 0.12 * Math.sin(h1 + 3)),
    ll: L(g.ll[0], g.ll[1], g.ll[2] + 0.06 * b),
    rl: L(g.rl[0], g.rl[1], g.rl[2] + 0.06 * b),
  })
}

/**
 * The pose for a fighter, `t` frames into its current act (fractional, for
 * smooth motion between sim frames). `clock` is seconds, for idle motion.
 */
export function poseFor(f: Fighter, s: MatchState, t: number, clock: number): Pose {
  const g = guard(f.id)
  const idle = idlePose(g, clock, f.id)

  if (s.phase === 'intro' && s.phaseTick < 95 && f.act === 'idle') return salute(g, Math.min(1, s.phaseTick / 20))

  switch (f.act) {
    case 'idle':
      return idle
    case 'walkF':
    case 'walkB': {
      // Steps: one foot lifts and swings through while the other carries the weight.
      const phase = f.x * 9
      const s1 = Math.sin(phase)
      const leadLift = Math.max(0, s1)
      const rearLift = Math.max(0, -s1)
      return withP(idle, {
        lift: -0.03 + 0.025 * Math.abs(Math.cos(phase)),
        side: 0.06 * s1,
        ll: L(g.ll[0] + 0.25 * s1, g.ll[1], g.ll[2] + 0.55 * leadLift),
        rl: L(g.rl[0] - 0.25 * s1, g.rl[1], g.rl[2] + 0.55 * rearLift),
        la: L(g.la[0] - 0.1 * s1, g.la[1], g.la[2]),
        ra: L(g.ra[0] + 0.1 * s1, g.ra[1], g.ra[2]),
      })
    }
    case 'crouch':
      return mixPose(g, crouch(g), Math.min(1, t / 4))
    case 'jumpSquat':
      return mixPose(g, crouch(g), Math.min(1, t / JUMP_SQUAT) * 0.6)
    case 'land':
      return mixPose(crouch(g), g, Math.min(1, t / LAND_FRAMES))
    case 'jump':
      return withP(g, { ll: L(0.95, 0.1, 1.6), rl: L(0.35, 0.1, 1.7), la: L(1.2, 0.35, 1.0), lean: 0.05 })
    case 'dashF':
      return withP(g, { lean: 0.38, lift: -0.06, ll: L(0.85, 0.12, 0.75), rl: L(-0.7, 0.12, 0.35), la: L(0.8, 0.3, 1.4), ra: L(0.3, 0.4, 1.6) })
    case 'dashB':
      return withP(g, { lean: -0.15, ll: L(0.3, 0.12, 0.35), rl: L(-0.15, 0.12, 0.95), la: L(1.2, 0.2, 1.4) })
    case 'attack':
      return track(keysFor(f.id, MOVES[f.move!]), t)
    case 'hitstun': {
      const base = f.crouched ? crouch(g) : g
      const v = f.hitVariant - 1
      const hurt =
        f.hitHeight === 'high'
          ? withP(base, { head: -0.6, lean: base.lean - 0.4, twist: 0.35 * v, side: 0.15 * v, la: L(0.35, 0.55, 0.6), ra: L(0.25, 0.45, 0.8), open: 1 })
          : f.hitHeight === 'low'
            ? withP(base, { lean: base.lean + 0.25, head: 0.2, ll: L(-0.15, 0.15, 1.0), la: L(0.5, 0.4, 1.2), lift: -0.04 })
            : withP(base, { lean: base.lean + 0.6, head: 0.45, twist: 0.2 * v, la: L(0.75, -0.1, 1.95), ra: L(0.7, -0.1, 1.95), lift: -0.05 })
      // In the hurt pose from the moment of impact (the springs and the knock
      // impulse do the snap), hold, then ease back into guard before the stun ends.
      return track(
        [
          [0, hurt],
          [f.actLen * 0.5, hurt],
          [f.actLen, base],
        ],
        t,
      )
    }
    case 'blockstun': {
      const base = f.crouched ? crouch(g) : g
      const block = withP(base, { la: L(1.35, -0.15, 1.95), ra: L(1.2, -0.2, 2.15), lean: base.lean - 0.12, head: 0.22, open: 0.5, lift: -0.03 })
      return track(
        [
          [0, block],
          [Math.max(1, f.actLen - 5), block],
          [f.actLen, base],
        ],
        t,
      )
    }
    case 'throwing': {
      const grab = withP(g, { la: L(1.25, 0.2, 0.8), ra: L(1.2, -0.05, 0.9), lean: 0.25, yaw: -0.2 })
      const toss = withP(g, { la: L(0.9, 0.3, 1.3), ra: L(1.6, 0.2, 0.6), yaw: 0.9, twist: 0.5, lean: 0.75, ll: L(0.8, 0.15, 1.2), lift: -0.08 })
      return track(
        [
          [0, grab],
          [14, withP(grab, { lean: 0.1, lift: -0.05 })],
          [THROW_SLAM, toss, snap],
          [THROW_SLAM + 8, toss],
          [THROW_SLAM + 26, g],
        ],
        t,
      )
    }
    case 'thrown': {
      const caught = withP(g, { head: -0.3, lean: -0.2, la: L(0.6, 0.6, 0.4), ra: L(0.5, 0.7, 0.4), open: 1 })
      const flip = withP(caught, { lift: 0.55, tilt: 1.2, ll: L(0.9, 0.2, 0.6), rl: L(0.7, 0.2, 0.5) })
      return track(
        [
          [0, caught],
          [14, caught],
          [THROW_SLAM - 4, flip],
          [THROW_SLAM, withP(flip, { lift: 0.1, tilt: Math.PI / 2 })],
        ],
        t,
      )
    }
    case 'parry': {
      // Tepisan: the lead hand cuts in across the body, then sweeps the blow aside.
      const cut = withP(g, { la: L(1.25, -0.4, 1.0), ra: L(0.9, 0.1, 1.9), yaw: -0.35, lean: -0.05, open: 1 })
      const sweep = withP(g, { la: L(1.35, 0.95, 0.45), ra: L(0.95, 0.05, 1.8), yaw: -0.7, lean: -0.08, open: 1 })
      return track(
        [
          [0, g],
          [2, cut, snap],
          [PARRY_WINDOW, sweep],
          [PARRY_TOTAL, g],
        ],
        t,
      )
    }
    case 'deflect': {
      // Caught it: blow swept aside, rear hand already loaded for the answer.
      const swept = withP(g, { la: L(1.3, 1.05, 0.4), ra: L(1.05, 0.0, 1.6), yaw: -0.75, twist: 0.3, lean: 0.05, open: 1 })
      return track(
        [
          [0, swept],
          [f.actLen, withP(g, { ra: L(1.0, 0.1, 1.7) })],
        ],
        t,
      )
    }
    case 'stagger': {
      // Off balance after being parried: reeling back, arms flung wide, a step back to stay up.
      const reel = withP(g, { lean: -0.35, head: -0.4, twist: 0.5, side: -0.15, la: L(0.6, 1.1, 0.4), ra: L(0.4, 1.0, 0.5), ll: L(0.2, 0.15, 0.3), rl: L(-0.6, 0.15, 0.9), open: 1 })
      return track(
        [
          [0, reel],
          [f.actLen * 0.7, withP(reel, { lean: -0.2, twist: 0.3 })],
          [f.actLen, g],
        ],
        t,
      )
    }
    case 'throwBreak':
      return mixPose(withP(g, { lean: -0.25, la: L(0.6, 0.65, 0.4), ra: L(0.5, 0.6, 0.5), head: -0.2 }), g, Math.min(1, t / f.actLen))
    case 'air': {
      // Juggled: thrown back, limbs trailing; tips further back as it falls.
      const k = Math.max(0, Math.min(1, 0.5 - f.vy * 6))
      const up = withP(g, { tilt: 0.45, head: -0.6, lean: -0.35, la: L(1.6, 0.9, 0.3), ra: L(1.4, 1.1, 0.3), ll: L(0.9, 0.2, 1.2), rl: L(0.5, 0.2, 1.4), open: 1 })
      const down = withP(up, { tilt: 1.2, ll: L(0.6, 0.15, 0.5), rl: L(0.3, 0.15, 0.7), la: L(2.2, 0.8, 0.2), ra: L(2.0, 0.9, 0.2) })
      return mixPose(up, down, k)
    }
    case 'down':
    case 'ko':
      return downPose(g, f, t)
    case 'rise':
      return track(
        [
          [0, lying(g)],
          [RISE_FRAMES * 0.55, withP(crouch(g), { tilt: 0.5, lean: 0.7 })],
          [RISE_FRAMES, g],
        ],
        t,
      )
    case 'win':
      return victory(g, t)
  }
}

function lying(g: Pose): Pose {
  return withP(g, { tilt: Math.PI / 2, lift: 0, lean: 0, twist: 0, yaw: -0.2, head: 0.25, la: L(0.25, 1.0, 0.35), ra: L(0.35, 0.8, 0.5), ll: L(0.15, 0.18, 0.3), rl: L(0.3, 0.12, 0.7), open: 1 })
}

function downPose(g: Pose, f: Fighter, t: number): Pose {
  const fall = withP(g, { tilt: 0.7, head: -0.5, lean: -0.3, la: L(0.9, 0.9, 0.3), ra: L(0.8, 1.0, 0.3), ll: L(0.6, 0.15, 0.4), rl: L(0.4, 0.15, 0.6) })
  // Already reeling on the impact frame (it is held through the hit-stop).
  const reel = withP(g, { head: -0.6, lean: -0.4, la: L(0.6, 0.7, 0.5), ra: L(0.5, 0.8, 0.5), open: 1 })
  const keys: [number, Pose][] = [
    [0, reel],
    [6, fall],
    [20, lying(g)],
  ]
  // A KO'd fighter goes limp; a downed one stirs before getting up.
  if (f.act === 'down') keys.push([DOWN_MAX - 10, lying(g)], [DOWN_MAX, withP(lying(g), { head: 0.5, ll: L(0.4, 0.18, 1.2) })])
  return track(keys, t)
}

/** The silat salute: palms pressed together before the chest, feet together. */
function salute(g: Pose, k: number): Pose {
  const pose = withP(g, { yaw: -0.05, twist: 0, lean: 0.05, head: 0.25, la: L(0.72, -0.32, 2.05), ra: L(0.72, -0.32, 2.05), ll: L(0.05, 0.03, 0.08), rl: L(-0.05, 0.03, 0.08), open: 1 })
  return mixPose(g, pose, smooth(k))
}

function victory(g: Pose, t: number): Pose {
  const bow = withP(salute(g, 1), { yaw: -1.25, head: 0.22, lean: 0.12 })
  const proud = withP(salute(g, 1), { yaw: -1.25, head: -0.1, lean: -0.05, la: L(2.9, 0.25, 0.15), open: 0 })
  return track(
    [
      [0, g],
      [18, bow],
      [55, bow],
      [75, proud],
    ],
    t,
  )
}
