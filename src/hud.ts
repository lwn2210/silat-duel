import { MAX_HP, ROUNDS_TO_WIN, TICK_RATE } from './sim/constants'
import type { MatchState } from './sim/match'
import { FIGHTERS } from './sim/moves'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

export class Hud {
  private readonly root = $('hud')
  private readonly fill = [$('hp0'), $('hp1')]
  private readonly trail = [$('trail0'), $('trail1')]
  private readonly pips = [$('pips0'), $('pips1')]
  private readonly combos = [$('combo0'), $('combo1')]
  private readonly timer = $('timer')
  private readonly banner = $('banner')
  private readonly bannerMain = $('banner-main')
  private readonly bannerSub = $('banner-sub')
  private readonly toast = $('toast')
  private bannerUntil = 0
  private toastUntil = 0
  private comboUntil = [0, 0]
  private lastScores = ''

  show(s: MatchState, tags: [string, string]): void {
    this.root.hidden = false
    s.roster.forEach((id, i) => ($(`name${i}`).textContent = FIGHTERS[id].name))
    tags.forEach((t, i) => ($(`tag${i}`).textContent = t))
    this.pips.forEach((el) => (el.innerHTML = Array.from({ length: ROUNDS_TO_WIN }, () => '<i></i>').join('')))
    this.lastScores = ''
  }

  hide(): void {
    this.root.hidden = true
  }

  say(main: string, sub = '', seconds = 1.6, ko = false, now = performance.now()): void {
    this.bannerMain.textContent = main
    this.bannerSub.textContent = sub
    this.banner.classList.toggle('ko', ko)
    this.banner.classList.add('show')
    this.bannerUntil = now + seconds * 1000
  }

  pop(text: string, seconds = 0.9, now = performance.now()): void {
    this.toast.textContent = text
    this.toast.classList.add('show')
    this.toastUntil = now + seconds * 1000
  }

  /** Combo counter on the attacker's side: hits, and the damage the combo has done. */
  combo(attacker: 0 | 1, hits: number, damage: number, now = performance.now()): void {
    if (hits < 2) return
    const el = this.combos[attacker]!
    el.querySelector('b')!.textContent = String(hits)
    el.querySelector('em')!.textContent = `${damage} damage`
    el.classList.remove('bump')
    void el.offsetWidth
    el.classList.add('show', 'bump')
    this.comboUntil[attacker] = now + 1500
  }

  update(s: MatchState, now: number): void {
    s.fighters.forEach((f, i) => {
      const pct = `${Math.max(0, (f.hp / MAX_HP) * 100)}%`
      this.fill[i]!.style.width = pct
      this.fill[i]!.classList.toggle('low', f.hp <= MAX_HP * 0.25)
      // The pale trail lags behind (CSS transition delay) so big hits read clearly.
      this.trail[i]!.style.width = pct
    })
    const scores = s.scores.join(':')
    if (scores !== this.lastScores) {
      this.lastScores = scores
      s.scores.forEach((n, i) => this.pips[i]!.querySelectorAll('i').forEach((el, j) => el.classList.toggle('on', j < n)))
    }
    const secs = Math.ceil(s.timer / TICK_RATE)
    this.timer.textContent = String(secs)
    this.timer.classList.toggle('hurry', s.phase === 'fight' && secs <= 10)

    if (now > this.bannerUntil) this.banner.classList.remove('show')
    if (now > this.toastUntil) this.toast.classList.remove('show')
    this.combos.forEach((el, i) => {
      if (now > this.comboUntil[i]!) el.classList.remove('show')
    })
  }
}
