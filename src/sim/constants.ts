// Every number the duel runs on. Distances are metres along the fighting
// line, times are sim frames at 60 Hz, speeds are metres per frame.

export const TICK_RATE = 60
export const DT = 1 / TICK_RATE

// ---- Match flow (ticks) ------------------------------------------------------
export const ROUND_TICKS = 60 * TICK_RATE
/** "Ronde 1" … "Mulai!" before control is handed over. */
export const INTRO_TICKS = 150
/** From KO / time up until the next round. */
export const ROUND_OVER_TICKS = 240
/** Slow motion after a KO, in ticks. The world moves on every SLOW_FACTOR-th tick. */
export const KO_SLOW_TICKS = 105
export const SLOW_FACTOR = 3
export const ROUNDS_TO_WIN = 2
/** Draws score nobody; after this many rounds the score decides (a tie is a drawn match). */
export const MAX_ROUNDS = 5
export const MAX_HP = 100

// ---- Space -------------------------------------------------------------------
export const STAGE_HALF = 4.6
export const START_X = 1.3
/** Half the width of a body, for reach. */
export const BODY_HALF = 0.28
/** Centres are never closer than this: fighters cannot walk through each other. */
export const PUSH_DIST = 0.6
/** Above this a fighter is airborne: lows pass under, throws miss. */
export const AIR_Y = 0.25

// ---- Movement (frames, m/frame) -------------------------------------------------
export const GRAVITY = 0.005
/** A small hop: ±30 frames in the air, apex ±0.55 m. */
export const JUMP_V = 0.075
export const JUMP_SQUAT = 4
export const JUMP_DRIFT = 0.025
export const LAND_FRAMES = 6
export const DASH_FRAMES = 16
/** Forward dash starts this fast and slows linearly to a stop: ±1.1 m. */
export const DASH_V = 0.13
export const BACKDASH_FRAMES = 18
export const BACKDASH_V = 0.11
/** Two taps of a direction within this many frames make a dash. */
export const DOUBLE_TAP = 12
/** For ↓ then → + Pukul: the down must be this recent. */
export const MOTION_WINDOW = 12
/** Knockback slides decay by this each frame. */
export const FRICTION = 0.82

// ---- Throws ----------------------------------------------------------------------
/** Frames after the grab in which the victim can break free with Pukul or Banting. */
export const THROW_ESCAPE = 20
/** Frame of the throw where the victim hits the floor. */
export const THROW_SLAM = 36
export const THROW_END = 54
export const BREAK_FRAMES = 22
export const BREAK_PUSH = 0.55

// ---- Knockdown -------------------------------------------------------------------
export const DOWN_V = 0.06
export const DOWN_PUSH = 0.07
/** Earliest frame a downed fighter may get up (any button or direction). */
export const DOWN_MIN = 42
/** Gets up by itself by this frame. */
export const DOWN_MAX = 84
export const RISE_FRAMES = 26

// ---- Impact ------------------------------------------------------------------------
/** Freeze frames on contact (both fighters stop, so frame advantage is unchanged). */
export const HITSTOP = 5
export const HITSTOP_HEAVY = 9
export const BLOCKSTOP = 3
export const COUNTER_DAMAGE = 1.25
export const COUNTER_STUN = 8

// ---- Combos -------------------------------------------------------------------------
/** A button pressed this many frames before a fighter is free again still comes out. */
export const BUFFER_FRAMES = 8
/** A Jurus press is remembered this long while waiting for the move to connect. */
export const CANCEL_BUFFER = 12
/** Frames after a move's active frames in which it may still be cancelled into the jurus. */
export const CANCEL_WINDOW = 16
/** Each juggle hit pops the opponent up again, a little less every time. */
export const JUGGLE_POP = 0.06
export const JUGGLE_DECAY = 0.78
/** A launcher on someone already in the air relaunches them, weaker. */
export const RELAUNCH_DECAY = 0.55
/** Landing from a juggle: already lying, the down timer starts here. */
export const AIR_LAND_DOWN = 16

// ---- Parry (tepisan) ------------------------------------------------------------------
/** Frames from the press in which an incoming high or mid strike is deflected. */
export const PARRY_WINDOW = 7
/** A parry that catches nothing leaves you open until this frame (holding back still guards). */
export const PARRY_TOTAL = 26
/** After a successful parry you are free again this fast… */
export const PARRY_RECOVER = 6
/** …while the attacker reels this long: room for a full combo. */
export const STAGGER_FRAMES = 32
export const PARRY_STOP = 10
