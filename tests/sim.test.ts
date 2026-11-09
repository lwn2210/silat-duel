import { describe, expect, it } from 'vitest'
import { Bot, type BotLevel } from '../src/bot/bot'
import { BUFFER_FRAMES, PARRY_RECOVER, PARRY_WINDOW, STAGGER_FRAMES, DOWN_MAX, DOWN_MIN, INTRO_TICKS, MAX_HP, PUSH_DIST, ROUND_OVER_TICKS, ROUND_TICKS, STAGE_HALF, THROW_ESCAPE } from '../src/sim/constants'
import { canAct, createMatch, IDLE, step, type Input, type MatchState, type SimEvent } from '../src/sim/match'
import { comboScale, FIGHTERS, MOVES, type FighterId } from '../src/sim/moves'

// Player 0 stands on the left facing right, so "forward" is x: +1 for them
// and x: −1 for player 1.

const P = (b: Partial<Input> = {}): Input => ({ ...IDLE, ...b })

/** A match already in the fight phase with the fighters `distance` apart. */
function fight(distance = 1.0, roster: [FighterId, FighterId] = ['jaka', 'sari']): MatchState {
  const s = createMatch(42, roster)
  s.phase = 'fight'
  s.phaseTick = 0
  s.fighters[0].x = -distance / 2
  s.fighters[1].x = distance / 2
  return s
}

/** Runs ticks, collecting events. `inputs` may depend on the tick index. */
function run(s: MatchState, ticks: number, inputs: (t: number) => [Input, Input] = () => [IDLE, IDLE]): SimEvent[] {
  const events: SimEvent[] = []
  for (let t = 0; t < ticks; t++) events.push(...step(s, inputs(t)))
  return events
}

/** Runs until a predicate holds (or fails the test). */
function until(s: MatchState, done: (s: MatchState) => boolean, inputs: (t: number) => [Input, Input] = () => [IDLE, IDLE], max = 5000): SimEvent[] {
  const events: SimEvent[] = []
  for (let t = 0; t < max; t++) {
    events.push(...step(s, inputs(t)))
    if (done(s)) return events
  }
  throw new Error('condition never reached')
}

const hits = (e: SimEvent[]) => e.filter((x) => x.type === 'hit') as Extract<SimEvent, { type: 'hit' }>[]
const blocks = (e: SimEvent[]) => e.filter((x) => x.type === 'block')
const dmg = (id: FighterId, base: number) => Math.round(base * FIGHTERS[id].power)
const scaled = (id: FighterId, base: number, hit: number) => Math.max(1, Math.round(base * FIGHTERS[id].power * comboScale(hit)))

/**
 * Player 0 presses a button once at tick 0; player 1 holds `defence`.
 * Returns the frame advantage once both can act again (positive = player 0 recovers first).
 */
function advantage(press: Partial<Input>, defence: Input, distance = 1.0): { adv: number; events: SimEvent[]; s: MatchState } {
  const s = fight(distance)
  const events: SimEvent[] = []
  const ready: [number, number] = [0, 0]
  let contact = false
  for (let t = 0; t < 200 && (!ready[0] || !ready[1]); t++) {
    const e = step(s, [t === 0 ? P(press) : IDLE, defence])
    events.push(...e)
    contact ||= e.some((x) => x.type === 'hit' || x.type === 'block')
    if (!contact) continue
    s.fighters.forEach((f, i) => {
      if (!ready[i] && canAct(f)) ready[i] = s.frame + 1
    })
  }
  return { adv: ready[1] - ready[0], events, s }
}

describe('aturan kena / tangkis', () => {
  it('pukul (tinggi) kena lawan yang berdiri diam', () => {
    const s = fight()
    const e = run(s, 30, (t) => [P({ punch: t === 0 }), IDLE])
    expect(hits(e)).toHaveLength(1)
    expect(s.fighters[1].hp).toBe(MAX_HP - dmg('jaka', 5))
  })

  it('serangan tinggi lewat di atas yang jongkok', () => {
    const s = fight()
    const e = run(s, 30, (t) => [P({ punch: t === 0 }), P({ y: -1 })])
    expect(hits(e)).toHaveLength(0)
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('tangkis berdiri menahan tinggi dan tengah, tapi bawah tetap kena', () => {
    const guard = P({ x: 1 })
    expect(blocks(advantage({ punch: true }, guard).events)).toHaveLength(1)
    expect(blocks(advantage({ kick: true }, guard).events)).toHaveLength(1)
    const low = advantage({ y: -1, punch: true }, guard, 0.8)
    expect(blocks(low.events)).toHaveLength(0)
    expect(hits(low.events)).toHaveLength(1)
  })

  it('tangkis jongkok menahan bawah, tapi tengah tetap kena', () => {
    const crouchGuard = P({ x: 1, y: -1 })
    expect(blocks(advantage({ y: -1, kick: true }, crouchGuard).events)).toHaveLength(1)
    const mid = advantage({ kick: true }, crouchGuard)
    expect(hits(mid.events)).toHaveLength(1)
    expect(mid.s.fighters[1].hp).toBe(MAX_HP - dmg('jaka', 11))
  })

  it('serangan bawah lewat di bawah yang lompat', () => {
    const s = fight()
    // Player 1 hops first; the sweep comes out while they are in the air.
    const e = run(s, 40, (t) => [P({ y: t === 6 ? -1 : 0, kick: t === 6 }), P({ y: t < 3 ? 1 : 0 })])
    expect(hits(e).filter((h) => h.move === 'sweep')).toHaveLength(0)
  })

  it('di luar jangkauan nggak kena', () => {
    const e = advantage({ punch: true }, IDLE, 2.4).events
    expect(hits(e)).toHaveLength(0)
  })

  it('serangan saat lawan lagi nyerang = counter, damage lebih besar', () => {
    const s = fight(1.0)
    // Player 1 starts a slow kick; player 0's jab lands during its startup.
    const e = run(s, 30, (t) => [P({ punch: t === 2 }), P({ kick: t === 0 })])
    const h = hits(e).find((x) => x.attacker === 0)!
    expect(h.counter).toBe(true)
    expect(h.damage).toBe(Math.round(5 * FIGHTERS.jaka.power * 1.25))
  })
})

describe('frame data dan kombo', () => {
  it('pukul +1 kalau ditangkis, +8 kalau kena', () => {
    expect(advantage({ punch: true }, P({ x: 1 })).adv).toBe(MOVES.jab.blockstun + MOVES.jab.startup - MOVES.jab.total)
    expect(advantage({ punch: true }, P({ x: 1 })).adv).toBe(1)
    expect(advantage({ punch: true }, IDLE).adv).toBe(8)
  })

  it('tendang −5 kalau ditangkis, sapuan −14 (bisa dihukum)', () => {
    expect(advantage({ kick: true }, P({ x: 1 })).adv).toBe(-5)
    expect(advantage({ y: -1, kick: true }, P({ x: 1, y: -1 })).adv).toBe(-14)
  })

  it('pukul-pukul-tendang nyambung jadi kombo 3 hit dan melambungkan lawan', () => {
    const s = fight(1.0)
    const e = until(s, (x) => x.fighters[1].act === 'air', (t) => [P({ punch: t === 0 || t === 8, kick: t === 18 }), IDLE], 80)
    const h = hits(e)
    expect(h.map((x) => x.move)).toEqual(['jab', 'jab2', 'kick3'])
    expect(h.map((x) => x.combo)).toEqual([1, 2, 3])
    run(s, 25)
    expect(s.fighters[1].act).toBe('air')
    expect(s.fighters[1].y).toBeGreaterThan(0.3)
    expect(s.fighters[1].hp).toBe(MAX_HP - scaled('jaka', 5, 1) - scaled('jaka', 6, 2) - scaled('jaka', 12, 3))
  })

  it('string tetap jalan walau ditangkis (tapi bukan kombo)', () => {
    const s = fight(1.0)
    const e = run(s, 70, (t) => [P({ punch: t === 0 || t === 8, kick: t === 18 }), P({ x: 1 })])
    expect(blocks(e)).toHaveLength(3)
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('jurus keluar dari tombol Jurus dan dari gerakan ↓ lalu → + Pukul', () => {
    const a = fight(2.0)
    run(a, 2, (t) => [P({ special: t === 0 }), IDLE])
    expect(a.fighters[0].move).toBe('tapak')

    const b = fight(2.0, ['sari', 'jaka'])
    run(b, 6, (t) => [t < 3 ? P({ y: -1 }) : t === 3 ? P({ x: 1 }) : t === 4 ? P({ x: 1, punch: true }) : IDLE, IDLE])
    expect(b.fighters[0].move).toBe('rajawali')
  })

  it('jurus Jaka (Tapak Harimau) menerjang dari jarak tengah dan menjatuhkan', () => {
    const s = fight(2.0)
    const e = run(s, 40, (t) => [P({ special: t === 0 }), IDLE])
    expect(hits(e).map((h) => h.move)).toEqual(['tapak'])
    expect(s.fighters[1].act).toBe('down')
  })

  it('jurus Gatot (Pukulan Guntur) menerjang dan menjatuhkan lawan', () => {
    const s = fight(2.0, ['gatot', 'jaka'])
    const e = run(s, 40, (t) => [P({ special: t === 0 }), IDLE])
    expect(hits(e).map((h) => h.move)).toEqual(['guntur'])
    expect(s.fighters[1].act).toBe('down')
  })

  it('tendangan Rajawali Sari terbang di atas serangan bawah', () => {
    const s = fight(1.6, ['sari', 'jaka'])
    // Jaka sweeps as Sari takes off; the sweep passes under her.
    const e = run(s, 50, (t) => [P({ special: t === 0 }), P({ y: t === 6 ? -1 : 0, kick: t === 6 })])
    expect(hits(e).filter((h) => h.move === 'sweep')).toHaveLength(0)
    expect(hits(e).filter((h) => h.move === 'rajawali')).toHaveLength(1)
  })

  it('dash maju (dobel tap) pindah ±1,1 m, jalan biasa jauh lebih pelan', () => {
    const s = fight(4)
    const x0 = s.fighters[0].x
    run(s, 30, (t) => [P({ x: t === 0 || t === 3 ? 1 : 0 }), IDLE])
    expect(s.fighters[0].x - x0).toBeGreaterThan(1.0)
    expect(s.fighters[0].x - x0).toBeLessThan(1.25)
  })

  it('badan nggak bisa tembus dan nggak bisa keluar arena', () => {
    const s = fight(1.0)
    run(s, 240, () => [P({ x: 1 }), P({ x: 1 })])
    expect(s.fighters[1].x - s.fighters[0].x).toBeGreaterThanOrEqual(PUSH_DIST - 1e-9)
    expect(s.fighters[1].x).toBeLessThanOrEqual(STAGE_HALF)
  })
})

describe('bantingan', () => {
  it('membanting lawan yang menangkis, lalu dia jatuh', () => {
    const s = fight(0.8)
    const e = run(s, 80, (t) => [P({ grab: t === 0 }), P({ x: 1 })])
    expect(e.some((x) => x.type === 'grab')).toBe(true)
    expect(e.some((x) => x.type === 'slam')).toBe(true)
    expect(s.fighters[1].hp).toBe(MAX_HP - dmg('jaka', 22))
    expect(s.fighters[1].act).toBe('down')
  })

  it('Pukul + Tendang bareng juga membanting', () => {
    const s = fight(0.8)
    const e = run(s, 20, (t) => [P({ punch: t === 0, kick: t === 0 }), IDLE])
    expect(e.some((x) => x.type === 'grab')).toBe(true)
  })

  it('meleset kalau lawan jongkok', () => {
    const s = fight(0.8)
    const e = run(s, 60, (t) => [P({ grab: t === 0 }), P({ y: -1 })])
    expect(e.some((x) => x.type === 'grab')).toBe(false)
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('bisa dilepas dengan Pukul di jendela waktu', () => {
    const s = fight(0.8)
    const grabbed = until(s, (x) => x.fighters[1].act === 'thrown', (t) => [P({ grab: t === 0 }), IDLE])
    expect(grabbed.some((x) => x.type === 'grab')).toBe(true)
    const e = run(s, 60, (t) => [IDLE, P({ punch: t === 10 })])
    expect(e.some((x) => x.type === 'throwBreak')).toBe(true)
    expect(e.some((x) => x.type === 'slam')).toBe(false)
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('telat mencet = nggak lepas', () => {
    const s = fight(0.8)
    until(s, (x) => x.fighters[1].act === 'thrown', (t) => [P({ grab: t === 0 }), IDLE])
    const e = run(s, 60, (t) => [IDLE, P({ punch: t === THROW_ESCAPE + 2 })])
    expect(e.some((x) => x.type === 'throwBreak')).toBe(false)
    expect(e.some((x) => x.type === 'slam')).toBe(true)
  })

  it('kalah cepat sama pukulan: yang mau banting kena duluan', () => {
    const s = fight(0.8)
    const e = run(s, 40, (t) => [P({ grab: t === 3 }), P({ punch: t === 0 })])
    expect(e.some((x) => x.type === 'grab')).toBe(false)
    expect(hits(e).some((h) => h.attacker === 1)).toBe(true)
  })
})

describe('jatuh dan bangun', () => {
  it('kena sapuan → jatuh, kebal di lantai, bangun sendiri', () => {
    const s = fight(1.0)
    const e = run(s, 30, (t) => [P({ y: t === 0 ? -1 : 0, kick: t === 0 }), IDLE])
    expect(hits(e).map((h) => h.move)).toEqual(['sweep'])
    expect(s.fighters[1].act).toBe('down')
    // Jabbing someone on the floor does nothing.
    const hp = s.fighters[1].hp
    const floor = run(s, 30, (t) => [P({ punch: t === 0 }), IDLE])
    expect(floor.some((x) => x.type === 'floor')).toBe(true)
    expect(s.fighters[1].hp).toBe(hp)
    until(s, (x) => x.fighters[1].act === 'idle', () => [IDLE, IDLE], DOWN_MAX + 60)
  })

  it('pencet tombol buat bangun lebih cepat', () => {
    const s = fight(1.0)
    run(s, 2, (t) => [P({ y: t === 0 ? -1 : 0, kick: t === 0 }), IDLE])
    until(s, (x) => x.fighters[1].act === 'down', () => [IDLE, IDLE])
    let n = 0
    until(s, (x) => (n++, x.fighters[1].act === 'rise'), (t) => [IDLE, P({ kick: t % 2 === 0 })])
    expect(n).toBeLessThan(DOWN_MAX)
    expect(n).toBeGreaterThanOrEqual(DOWN_MIN - 30)
  })
})

describe('KO, ronde, waktu', () => {
  it('KO → slow-motion, skor nambah, ronde berikutnya darah penuh lagi', () => {
    const s = fight(1.0)
    s.fighters[1].hp = 3
    const e = until(s, (x) => x.phase === 'roundOver', (t) => [P({ punch: t === 0 }), IDLE])
    expect(e.some((x) => x.type === 'ko' && x.loser === 1)).toBe(true)
    expect(s.scores).toEqual([1, 0])
    expect(s.fighters[1].act).toBe('ko')
    // Slow motion: the world crawls while the tick runs on.
    const f0 = s.frame
    run(s, 30)
    expect(s.frame - f0).toBeLessThanOrEqual(11)
    const next = until(s, (x) => x.phase === 'intro', () => [IDLE, IDLE], ROUND_OVER_TICKS + 10)
    next.push(...step(s, [IDLE, IDLE]))
    expect(next.some((x) => x.type === 'roundStart' && x.round === 2)).toBe(true)
    expect(s.round).toBe(2)
    expect(s.fighters.map((f) => f.hp)).toEqual([MAX_HP, MAX_HP])
    until(s, (x) => x.phase === 'fight', () => [IDLE, IDLE], INTRO_TICKS + 1)
  })

  it('waktu habis: yang darahnya lebih banyak menang ronde', () => {
    const s = fight(3)
    s.fighters[0].hp = 60
    const e = run(s, ROUND_TICKS)
    expect(e.some((x) => x.type === 'timeUp')).toBe(true)
    expect(s.lastResult).toMatchObject({ winner: 1, reason: 'time' })
    expect(s.scores).toEqual([0, 1])
  })

  it('waktu habis dengan darah sama = seri, nggak ada yang dapat poin', () => {
    const s = fight(3)
    run(s, ROUND_TICKS)
    expect(s.lastResult?.winner).toBe(-1)
    expect(s.scores).toEqual([0, 0])
  })

  it('menang 2 ronde = menang match', () => {
    const s = fight(1.0)
    let events: SimEvent[] = []
    for (let round = 0; round < 2; round++) {
      until(s, (x) => x.phase === 'fight', () => [IDLE, IDLE], INTRO_TICKS + 5)
      s.fighters[1].hp = 2
      s.fighters[0].x = -0.5
      s.fighters[1].x = 0.5
      events = until(s, (x) => x.phase === 'matchOver' || (x.phase === 'intro' && x.round === round + 2), (t) => [P({ punch: t === 0 }), IDLE])
    }
    expect(events.some((x) => x.type === 'matchOver' && x.winner === 0)).toBe(true)
    expect(s.winner).toBe(0)
    expect(s.scores).toEqual([2, 0])
  })
})

describe('combo, cancel, juggle', () => {
  it('Tendang, Tendang: 2 hit nyambung lalu menjatuhkan', () => {
    const s = fight(1.0)
    const e = run(s, 60, (t) => [P({ kick: t === 0 || t === 10 }), IDLE])
    expect(hits(e).map((h) => [h.move, h.combo])).toEqual([
      ['kick', 1],
      ['kick2', 2],
    ])
    expect(s.fighters[1].act).toBe('down')
  })

  it('Pukul, Tendang, ↓+Tendang: 3 hit, ditutup sapuan bawah', () => {
    const s = fight(1.0)
    const e = run(s, 70, (t) => [P({ punch: t === 0, kick: t === 8 || t === 22, y: t >= 20 && t <= 23 ? -1 : 0 }), IDLE])
    expect(hits(e).map((h) => [h.move, h.combo])).toEqual([
      ['jab', 1],
      ['jabKick', 2],
      ['sweep2', 3],
    ])
    expect(s.fighters[1].act).toBe('down')
  })

  it('Tendang tanpa ↓ setelah Pukul, Tendang nggak jadi sapuan', () => {
    const s = fight(1.0)
    const e = run(s, 70, (t) => [P({ punch: t === 0, kick: t === 8 || t === 22 }), IDLE])
    expect(hits(e).map((h) => h.move)).not.toContain('sweep2')
  })

  it('cancel ke Jurus setelah pukulan kena = jurus nyambung jadi kombo', () => {
    const s = fight(1.0)
    // Jurus pressed early (frame 4), comes out the moment the jab connects.
    const e = run(s, 60, (t) => [P({ punch: t === 0, special: t === 4 }), IDLE])
    const h = hits(e)
    expect(h.map((x) => [x.move, x.combo])).toEqual([
      ['jab', 1],
      ['tapak', 2],
    ])
    expect(h[1]!.damage).toBe(scaled('jaka', 20, 2))
    expect(s.fighters[1].act).toBe('down')
  })

  it('cancel juga jalan kalau ditangkis, tapi nggak kalau pukulannya meleset', () => {
    const blocked = fight(1.0)
    const e = run(blocked, 50, (t) => [P({ punch: t === 0, special: t === 12 }), P({ x: 1 })])
    expect(blocks(e).map((b) => b.move)).toEqual(['jab', 'tapak'])

    const whiff = fight(2.6)
    run(whiff, 20, (t) => [P({ punch: t === 0, special: t === 11 }), IDLE])
    expect(whiff.fighters[0].move).not.toBe('tapak')
    run(whiff, 40)
    expect(whiff.fighters[0].move).not.toBe('tapak')
  })

  it('juggle: lawan yang melambung bisa dipukul lagi di udara, tiap hit damage-nya diskala', () => {
    const s = fight(1.0)
    // P, P, K launches; as soon as the kick recovers, P, P again while the body is in the air.
    const e = until(s, (x) => x.fighters[1].act === 'air', (t) => [P({ punch: t === 0 || t === 8, kick: t === 18 }), IDLE], 80)
    e.push(...until(s, (x) => canAct(x.fighters[0]), () => [IDLE, IDLE], 80))
    e.push(...run(s, 40, (t) => [P({ punch: t === 0 || t === 8 }), IDLE]))
    const h = hits(e)
    expect(h.length).toBeGreaterThanOrEqual(5)
    expect(h.map((x) => x.combo)).toEqual(h.map((_, i) => i + 1))
    for (const x of h) {
      const base = MOVES[x.move].damage
      expect(x.damage).toBe(scaled('jaka', base, x.combo))
    }
    expect(h[4]!.damage).toBeLessThan(dmg('jaka', MOVES[h[4]!.move].damage))
    // The juggle ends on the floor.
    until(s, (x) => x.fighters[1].act === 'down', () => [IDLE, IDLE], 200)
  })

  it('juggle yang panjang tetap berakhir: pantulan makin lemah', () => {
    const s = fight(1.0)
    run(s, 40, (t) => [P({ punch: t === 0 || t === 8, kick: t === 18 }), IDLE])
    // Mash Pukul: the body still comes down within a few seconds.
    until(s, (x) => x.fighters[1].act === 'down', (t) => [P({ punch: t % 6 === 0 }), IDLE], 300)
    expect(s.fighters[1].juggle).toBeLessThan(12)
  })

  it('combo dimulai dari counter: hit pertama counter, hit berikutnya nggak', () => {
    const s = fight(1.0)
    const e = run(s, 40, (t) => [P({ punch: t === 2 || t === 10 }), P({ kick: t === 0 })])
    const mine = hits(e).filter((h) => h.attacker === 0)
    expect(mine[0]!.counter).toBe(true)
    expect(mine[1]!.counter).toBe(false)
    expect(mine[1]!.combo).toBe(2)
  })

  it('input buffer: tombol yang dipencet sesaat sebelum pulih tetap keluar', () => {
    const s = fight(3)
    // Kick whiffs (total 34 frames). Pukul pressed 5 frames before the end comes out right after.
    let started = -1
    for (let t = 0; t < 60; t++) {
      step(s, [P({ kick: t === 0, punch: t === MOVES.kick.total - 5 }), IDLE])
      if (started < 0 && s.fighters[0].move === 'jab') started = s.frame
    }
    expect(started).toBe(MOVES.kick.total + 1)

    const early = fight(3)
    run(early, 60, (t) => [P({ kick: t === 0, punch: t === MOVES.kick.total - BUFFER_FRAMES - 6 }), IDLE])
    expect(early.fighters[0].move).not.toBe('jab')
  })
})

describe('tepis (parry)', () => {
  const parries = (e: SimEvent[]) => e.filter((x) => x.type === 'parry')

  it('Tepis tepat waktu menepis pukulan: tanpa damage, penyerang terhuyung', () => {
    const s = fight(1.0)
    // Jab hits on frame 10; Tepis pressed on frame 6, so its 7-frame window covers it.
    const e = run(s, 14, (t) => [P({ punch: t === 0 }), P({ parry: t === 5 })])
    expect(parries(e)).toHaveLength(1)
    expect(hits(e)).toHaveLength(0)
    expect(blocks(e)).toHaveLength(0)
    expect(s.fighters[1].hp).toBe(MAX_HP)
    expect(s.fighters[0].act).toBe('stagger')
    expect(s.fighters[1].act).toBe('deflect')
  })

  it('jendela tepis: tepat di frame kena masih masuk, kepagian nggak', () => {
    // Pressed on the very frame the jab lands: still a parry.
    const late = fight(1.0)
    expect(parries(run(late, 14, (t) => [P({ punch: t === 0 }), P({ parry: t === 9 })]))).toHaveLength(1)
    // Pressed so early that the window has closed before the jab arrives: the jab connects.
    const early = fight(1.0)
    const e = run(early, 30, (t) => [P({ punch: t === 0 }), P({ parry: t === 9 - PARRY_WINDOW - 1 })])
    expect(parries(e)).toHaveLength(0)
    expect(hits(e)).toHaveLength(1)
  })

  it('salah timing tapi tahan mundur = tetap tangkis biasa', () => {
    const s = fight(1.0)
    const e = run(s, 30, (t) => [P({ punch: t === 0 }), P({ parry: t === 0, x: 1 })])
    expect(parries(e)).toHaveLength(0)
    expect(blocks(e)).toHaveLength(1)
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('habis menepis, yang menepis bebas jauh lebih dulu dan bisa langsung combo', () => {
    const s = fight(1.0)
    const ready: [number, number] = [0, 0]
    let parried = false
    for (let t = 0; t < 120 && (!ready[0] || !ready[1]); t++) {
      const e = step(s, [P({ punch: t === 0 }), P({ parry: t === 5 })])
      parried ||= e.some((x) => x.type === 'parry')
      if (!parried) continue
      s.fighters.forEach((f, i) => {
        if (!ready[i] && canAct(f)) ready[i] = s.frame + 1
      })
    }
    expect(ready[0] - ready[1]).toBe(STAGGER_FRAMES - PARRY_RECOVER)

    // Answer with P, P, K: the first hit is a counter on the staggered attacker and the rest combo.
    const c = fight(1.0)
    run(c, 10, (t) => [P({ punch: t === 0 }), P({ parry: t === 5 })])
    until(c, (x) => canAct(x.fighters[1]), () => [IDLE, IDLE], 40)
    // (The counter hit freezes longer, so the presses are spaced a little wider than usual.)
    const e = run(c, 90, (t) => [IDLE, P({ punch: t === 0 || t === 12, kick: t === 30 })])
    const h = hits(e)
    expect(h.map((x) => x.move)).toEqual(['jab', 'jab2', 'kick3'])
    expect(h[0]!.counter).toBe(true)
    expect(h.map((x) => x.combo)).toEqual([1, 2, 3])
  })

  it('jurus dan tendangan juga bisa ditepis', () => {
    const s = fight(1.6)
    const e = run(s, 30, (t) => [P({ special: t === 0 }), P({ parry: t === 15 })])
    expect(parries(e).map((p) => p.type === 'parry' && p.move)).toEqual(['tapak'])
    expect(s.fighters[1].hp).toBe(MAX_HP)
  })

  it('bantingan nggak bisa ditepis', () => {
    const s = fight(0.8)
    const e = run(s, 20, (t) => [P({ grab: t === 0 }), P({ parry: t === 6 })])
    expect(parries(e)).toHaveLength(0)
    expect(e.some((x) => x.type === 'grab')).toBe(true)
  })

  it('serangan bawah nggak bisa ditepis', () => {
    const s = fight(1.0)
    const e = run(s, 30, (t) => [P({ y: t === 0 ? -1 : 0, kick: t === 0 }), P({ parry: t === 12 })])
    expect(parries(e)).toHaveLength(0)
    expect(hits(e).map((h) => h.move)).toEqual(['sweep'])
  })

  it('Tepis yang meleset bikin terbuka: kena penuh kalau nggak tahan mundur', () => {
    const s = fight(1.0)
    const e = run(s, 40, (t) => [P({ kick: t === 0 }), P({ parry: t === 0 })])
    expect(parries(e)).toHaveLength(0)
    expect(hits(e)).toHaveLength(1)
    expect(s.fighters[1].hp).toBe(MAX_HP - dmg('jaka', 11))
  })
})

describe('determinisme dan bot', () => {
  function botMatch(seed: number, levels: [BotLevel, BotLevel], roster: [FighterId, FighterId] = ['jaka', 'sari'], maxTicks = 60 * 60 * 8) {
    const s = createMatch(seed, roster)
    const bots = [new Bot(0, levels[0], seed + 1), new Bot(1, levels[1], seed + 2)] as const
    const log: SimEvent[] = []
    let t = 0
    while (s.phase !== 'matchOver' && t < maxTicks) {
      const inputs: [Input, Input] = [bots[0].think(s), bots[1].think(s)]
      log.push(...step(s, inputs))
      t++
    }
    return { s, log, ticks: t }
  }

  it('seed + input sama = match sama persis, juga setelah lewat JSON', () => {
    const a = botMatch(7, ['sedang', 'jago'], ['jaka', 'sari'], 4000)
    const b = botMatch(7, ['sedang', 'jago'], ['jaka', 'sari'], 4000)
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s))

    // Snapshot mid-match, continue both copies with the same inputs.
    const s = createMatch(9)
    const bots = [new Bot(0, 'jago', 1), new Bot(1, 'jago', 2)]
    for (let t = 0; t < 1500; t++) step(s, [bots[0]!.think(s), bots[1]!.think(s)])
    const copy = JSON.parse(JSON.stringify(s)) as MatchState
    for (let t = 0; t < 1500; t++) {
      const inputs: [Input, Input] = [bots[0]!.think(s), bots[1]!.think(s)]
      step(s, inputs)
      step(copy, inputs)
    }
    expect(JSON.stringify(copy)).toBe(JSON.stringify(s))
  })

  it('bot vs bot menyelesaikan match di semua tingkat', () => {
    const levels: BotLevel[] = ['mudah', 'sedang', 'jago']
    for (const a of levels) {
      for (const b of levels) {
        const { s, log } = botMatch(100 + levels.indexOf(a) * 3 + levels.indexOf(b), [a, b])
        expect(s.phase, `${a} vs ${b}`).toBe('matchOver')
        expect(hits(log).length).toBeGreaterThan(5)
      }
    }
  })

  it('bot Jago kadang menepis, Mudah nggak pernah', () => {
    const jago = botMatch(900, ['jago', 'jago'])
    expect(jago.log.filter((e) => e.type === 'parry').length).toBeGreaterThan(0)
    const mudah = botMatch(901, ['mudah', 'mudah'])
    expect(mudah.log.filter((e) => e.type === 'parry')).toHaveLength(0)
  })

  it('Jago jauh lebih sering menang lawan Mudah', () => {
    let wins = 0
    for (let i = 0; i < 6; i++) {
      const { s } = botMatch(500 + i, i % 2 ? ['jago', 'mudah'] : ['mudah', 'jago'], i % 2 ? ['jaka', 'sari'] : ['sari', 'jaka'])
      const jago = i % 2 ? 0 : 1
      if (s.winner === jago) wins++
    }
    expect(wins).toBeGreaterThanOrEqual(5)
  })
})
