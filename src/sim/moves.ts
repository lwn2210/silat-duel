// Frame data, Tekken notation: `startup` is the first active frame (i10 =
// hits on the 10th frame after the press), `total` the last frame of the move.
// Frame advantage when a move connects on its first active frame:
//   on hit   = hitstun   + startup − total
//   on block = blockstun + startup − total

export type Height = 'high' | 'mid' | 'low' | 'throw'

export type MoveId =
  | 'jab'
  | 'jab2'
  | 'kick3'
  | 'jabKick'
  | 'sweep2'
  | 'kick'
  | 'kick2'
  | 'lowPunch'
  | 'sweep'
  | 'tapak'
  | 'rajawali'
  | 'guntur'
  | 'jumpKick'
  | 'throw'

export type Button = 'punch' | 'kick' | 'special' | 'grab'

/** What can follow in a string: a button, or ↓ + Tendang. */
export type ChainKey = 'punch' | 'kick' | 'dkick'

export interface MoveData {
  id: MoveId
  /** Shown in the move list. */
  name: string
  height: Height
  startup: number
  active: number
  total: number
  damage: number
  hitstun: number
  blockstun: number
  /** From body centre to the tip of the fist or foot. */
  reach: number
  /** Steps forward this far during startup. */
  advance: number
  /** Knockback on hit (block pushes 1.3× this). */
  push: number
  knockdown?: boolean
  /** Launcher: sends the opponent up (vertical speed, m/frame) for a juggle. */
  launch?: number
  /** Big hit: longer freeze, heavier sound. */
  heavy?: boolean
  /** The attacker is crouching throughout: highs pass over. */
  crouching?: boolean
  /** Started in the air; landing ends it. */
  air?: boolean
  /** Hops on this frame: airborne for a while (lows pass under). */
  hopAt?: number
  /** Once it connects (hit or block) the recovery can be cancelled into the jurus. */
  cancel?: boolean
  /** Follow-ups: pressing between frame 1 and `chainTo` queues the next move, which starts after frame `chainFrom`. */
  chain?: Partial<Record<ChainKey, MoveId>>
  chainFrom?: number
  chainTo?: number
}

export const MOVES: Record<MoveId, MoveData> = {
  // Pukul: fast high jab, +1 on block, +8 on hit. Opens two strings.
  jab: {
    id: 'jab', name: 'Pukul', height: 'high', startup: 10, active: 2, total: 24,
    damage: 5, hitstun: 22, blockstun: 15, reach: 0.95, advance: 0.06, push: 0.12,
    chain: { punch: 'jab2', kick: 'jabKick' }, chainFrom: 11, chainTo: 23, cancel: true,
  },
  // Pukul, Pukul: rear-hand straight.
  jab2: {
    id: 'jab2', name: 'Pukul Kedua', height: 'high', startup: 9, active: 2, total: 26,
    damage: 6, hitstun: 24, blockstun: 14, reach: 1.0, advance: 0.12, push: 0.12,
    chain: { kick: 'kick3' }, chainFrom: 10, chainTo: 25, cancel: true,
  },
  // Pukul, Pukul, Tendang: rising crescent kick that launches. −9 on block.
  kick3: {
    id: 'kick3', name: 'Tendangan Melambung', height: 'mid', startup: 13, active: 3, total: 38,
    damage: 12, hitstun: 0, blockstun: 16, reach: 1.25, advance: 0.25, push: 0.08,
    launch: 0.105, heavy: true,
  },
  // Pukul, Tendang: mid kick off the jab.
  jabKick: {
    id: 'jabKick', name: 'Tendang Sambung', height: 'mid', startup: 12, active: 3, total: 32,
    damage: 9, hitstun: 22, blockstun: 14, reach: 1.2, advance: 0.15, push: 0.14,
    chain: { dkick: 'sweep2' }, chainFrom: 14, chainTo: 30, cancel: true,
  },
  // Pukul, Tendang, ↓+Tendang: sweep to finish. Low, knocks down, −16 on block.
  sweep2: {
    id: 'sweep2', name: 'Sapuan Sambung', height: 'low', startup: 14, active: 4, total: 44,
    damage: 10, hitstun: 0, blockstun: 14, reach: 1.3, advance: 0.1, push: 0.2,
    knockdown: true, heavy: true, crouching: true,
  },
  // Tendang: front kick to the stomach, +4 on hit, −5 on block. Tendang again = spinning kick.
  kick: {
    id: 'kick', name: 'Tendang', height: 'mid', startup: 14, active: 3, total: 34,
    damage: 11, hitstun: 24, blockstun: 15, reach: 1.2, advance: 0.1, push: 0.18,
    chain: { kick: 'kick2' }, chainFrom: 16, chainTo: 32, cancel: true,
  },
  // Tendang, Tendang: spinning high kick, knocks down. Ducks under it; −13 on block.
  kick2: {
    id: 'kick2', name: 'Tendangan Putar', height: 'high', startup: 12, active: 3, total: 40,
    damage: 13, hitstun: 0, blockstun: 15, reach: 1.3, advance: 0.2, push: 0.25,
    knockdown: true, heavy: true,
  },
  // ↓ + Pukul: crouching punch to the shins. Low, so it must be blocked crouching.
  lowPunch: {
    id: 'lowPunch', name: 'Pukul Bawah', height: 'low', startup: 11, active: 2, total: 26,
    damage: 5, hitstun: 20, blockstun: 14, reach: 0.95, advance: 0.04, push: 0.1,
    crouching: true, cancel: true,
  },
  // ↓ + Tendang: sweep. Low, knocks down, but −14 on block: punishable.
  sweep: {
    id: 'sweep', name: 'Sapuan', height: 'low', startup: 16, active: 4, total: 44,
    damage: 10, hitstun: 0, blockstun: 14, reach: 1.3, advance: 0.08, push: 0.2,
    knockdown: true, heavy: true, crouching: true,
  },
  // Jaka's jurus: lunging two-palm strike. Mid, knocks down, −14 on block.
  tapak: {
    id: 'tapak', name: 'Tapak Harimau', height: 'mid', startup: 20, active: 4, total: 50,
    damage: 20, hitstun: 0, blockstun: 16, reach: 1.0, advance: 1.0, push: 0.3,
    knockdown: true, heavy: true,
  },
  // Sari's jurus: hopping flying kick, sails over lows. Mid, knocks down, −14 on block.
  rajawali: {
    id: 'rajawali', name: 'Tendangan Rajawali', height: 'mid', startup: 18, active: 5, total: 48,
    damage: 18, hitstun: 0, blockstun: 16, reach: 1.25, advance: 0.95, push: 0.3,
    knockdown: true, heavy: true, hopAt: 5,
  },
  // Gatot's jurus: lightning lunge punch. Mid, knocks down, −14 on block.
  guntur: {
    id: 'guntur', name: 'Pukulan Guntur', height: 'mid', startup: 19, active: 4, total: 49,
    damage: 19, hitstun: 0, blockstun: 16, reach: 1.15, advance: 0.98, push: 0.35,
    knockdown: true, heavy: true,
  },
  // Pukul or Tendang in the air.
  jumpKick: {
    id: 'jumpKick', name: 'Tendang Lompat', height: 'mid', startup: 7, active: 8, total: 30,
    damage: 10, hitstun: 22, blockstun: 12, reach: 1.15, advance: 0, push: 0.2,
    air: true,
  },
  // Banting (or Pukul + Tendang together): beats blocking, whiffs on crouching or airborne.
  throw: {
    id: 'throw', name: 'Bantingan', height: 'throw', startup: 10, active: 3, total: 38,
    damage: 22, hitstun: 0, blockstun: 0, reach: 0.78, advance: 0.05, push: 0,
    knockdown: true,
  },
}

/** A cancelled jurus skips its wind-up and lands this many frames after the cancel. */
export const CANCEL_STARTUP = 10

export type FighterId = 'jaka' | 'sari' | 'gatot'

export interface FighterStats {
  id: FighterId
  name: string
  /** One line for the select screen. */
  style: string
  walkF: number
  walkB: number
  /** Damage multiplier. */
  power: number
  special: 'tapak' | 'rajawali' | 'guntur'
}

export const FIGHTERS: Record<FighterId, FighterStats> = {
  jaka: { id: 'jaka', name: 'Jaka', style: 'Kuda-kuda kokoh, pukulannya berat.', walkF: 0.027, walkB: 0.021, power: 1.1, special: 'tapak' },
  sari: { id: 'sari', name: 'Sari', style: 'Lincah dan cepat, tendangannya terbang.', walkF: 0.034, walkB: 0.027, power: 0.92, special: 'rajawali' },
  gatot: { id: 'gatot', name: 'Gatot', style: 'Pendekar gagah, pukulan guntur beruntun.', walkF: 0.03, walkB: 0.024, power: 1.05, special: 'guntur' },
}

/** Combo damage scaling: the n-th hit of a combo deals this share (last value repeats). */
export const COMBO_SCALE = [1, 0.9, 0.8, 0.7, 0.62, 0.55, 0.5, 0.45, 0.4]

export function comboScale(hit: number): number {
  return COMBO_SCALE[Math.min(Math.max(hit, 1), COMBO_SCALE.length) - 1]!
}

/** Strings and specials for the move list (menu and pause screen). */
export const MOVE_LIST: { input: string; name: string; note: string }[] = [
  { input: 'Pukul', name: 'Pukul', note: 'cepat, atas' },
  { input: 'Pukul, Pukul, Tendang', name: 'Tendangan Melambung', note: 'kombo 3 hit, lawan terlempar ke atas' },
  { input: 'Pukul, Tendang, ↓+Tendang', name: 'Sapuan Sambung', note: 'kombo 3 hit, akhir bawah, menjatuhkan' },
  { input: 'Tendang, Tendang', name: 'Tendangan Putar', note: 'kombo 2 hit, menjatuhkan (lewat atas yang jongkok)' },
  { input: '↓+Pukul / ↓+Tendang', name: 'Pukul Bawah / Sapuan', note: 'serangan bawah' },
  { input: 'Jurus (atau ↓ lalu →+Pukul)', name: 'Tapak Harimau / Tendangan Rajawali', note: 'menjatuhkan' },
  { input: 'serangan kena/ditangkis → Jurus', name: 'Cancel ke Jurus', note: 'jurus keluar cepat, nyambung jadi kombo' },
  { input: 'lawan melambung → Pukul, Pukul…', name: 'Juggle', note: 'pukul terus selagi di udara' },
  { input: 'Tepis, tepat sebelum kena', name: 'Tepisan', note: 'menepis serangan atas/tengah, lawan terhuyung → balas combo' },
  { input: 'Banting (atau Pukul+Tendang)', name: 'Bantingan', note: 'tembus tangkisan & tepisan; lepas: pencet Pukul' },
]

export function isActive(move: MoveData, frame: number): boolean {
  return frame >= move.startup && frame < move.startup + move.active
}
