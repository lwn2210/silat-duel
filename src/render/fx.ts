import * as THREE from 'three'
import { softDot } from './textures'

// Hit sparks, guard flashes and dust puffs from a pool of sprites.

interface Particle {
  sprite: THREE.Sprite
  vel: THREE.Vector3
  life: number
  max: number
  grow: number
  gravity: number
}

const POOL = 160

export class Effects {
  private readonly pool: Particle[] = []
  private next = 0

  constructor(scene: THREE.Scene) {
    const map = softDot()
    for (let i = 0; i < POOL; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      sprite.visible = false
      scene.add(sprite)
      this.pool.push({ sprite, vel: new THREE.Vector3(), life: 0, max: 1, grow: 0, gravity: 0 })
    }
  }

  private spawn(x: number, y: number, z: number, color: THREE.ColorRepresentation, size: number, life: number, additive = true): Particle {
    const p = this.pool[this.next]!
    this.next = (this.next + 1) % POOL
    p.sprite.position.set(x, y, z)
    p.sprite.scale.set(size, size, 1)
    p.sprite.material.color.set(color)
    p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending
    p.sprite.material.opacity = 1
    p.sprite.visible = true
    p.life = life
    p.max = life
    p.grow = 0
    p.gravity = 0
    p.vel.set(0, 0, 0)
    return p
  }

  /** Impact at a point: a flash, then sparks flying away from the attacker. */
  hit(x: number, y: number, dir: number, heavy: boolean, counter: boolean): void {
    const core = counter ? '#ff5a3a' : '#fff1c4'
    const flash = this.spawn(x, y, 0.25, core, heavy ? 0.9 : 0.6, 0.14)
    flash.grow = heavy ? 6 : 4
    if (heavy) this.shockwave(x, y)
    const n = heavy ? 18 : 10
    for (let i = 0; i < n; i++) {
      const p = this.spawn(x, y, 0.25, i % 3 ? '#ffc35a' : core, 0.08 + Math.random() * 0.06, 0.25 + Math.random() * 0.2)
      const a = (Math.random() - 0.5) * 2.2
      const speed = (heavy ? 5 : 3.5) * (0.4 + Math.random())
      p.vel.set(dir * Math.cos(a) * speed, Math.sin(a) * speed + 1, (Math.random() - 0.5) * 2)
      p.gravity = 9
    }
  }

  /** Special martial arts aura burst when Tapak Harimau or Tendangan Rajawali lands */
  jurus(x: number, y: number, dir: number, move: string): void {
    const isTiger = move === 'tapak'
    const color = isTiger ? '#ff6d00' : '#00e5ff'
    const subColor = isTiger ? '#ffd600' : '#80d8ff'
    const flash = this.spawn(x, y, 0.35, color, 1.4, 0.28)
    flash.grow = 8
    this.shockwave(x, y)
    for (let i = 0; i < 24; i++) {
      const p = this.spawn(x, y, 0.35, i % 2 ? color : subColor, 0.12 + Math.random() * 0.08, 0.4 + Math.random() * 0.3)
      const a = (Math.random() - 0.5) * Math.PI * 1.5
      const speed = 6 * (0.5 + Math.random())
      p.vel.set(dir * Math.cos(a) * speed, Math.sin(a) * speed + 2, (Math.random() - 0.5) * 3)
      p.gravity = 7
    }
  }

  /** Heavy impacts: a ring of light that bursts out from the point of contact. */
  shockwave(x: number, y: number): void {
    for (let i = 0; i < 12; i++) {
      const p = this.spawn(x, y, 0.3, '#ffe2a8', 0.16, 0.22)
      const a = (i / 12) * Math.PI * 2
      p.vel.set(Math.cos(a) * 6, Math.sin(a) * 6, 0)
      p.grow = -2
    }
  }

  /** Guard: a cool blue flash and a short ring of sparks. */
  block(x: number, y: number, dir: number): void {
    const flash = this.spawn(x, y, 0.25, '#9fd4ff', 0.55, 0.12)
    flash.grow = 3
    for (let i = 0; i < 7; i++) {
      const p = this.spawn(x, y, 0.25, '#cfe9ff', 0.06, 0.18)
      const a = (i / 7) * Math.PI * 2
      p.vel.set(dir * 0.5 + Math.cos(a) * 2, Math.sin(a) * 2, 0)
    }
  }

  /** Tepis: a golden flash, a ring and a fan of sparks deflected upward. */
  parry(x: number, y: number, dir: number): void {
    const flash = this.spawn(x, y, 0.3, '#ffe9a8', 0.9, 0.2)
    flash.grow = 6
    this.shockwave(x, y)
    for (let i = 0; i < 12; i++) {
      const p = this.spawn(x, y, 0.3, i % 2 ? '#ffd35a' : '#ffffff', 0.07, 0.3)
      const a = 0.3 + Math.random() * 1.4
      p.vel.set(-dir * Math.cos(a) * 4, Math.sin(a) * 5, (Math.random() - 0.5) * 2)
      p.gravity = 8
    }
  }

  /** Throw break: a white burst between the two. */
  burst(x: number, y: number): void {
    const flash = this.spawn(x, y, 0.25, '#ffffff', 0.7, 0.18)
    flash.grow = 5
  }

  /** Someone hits the floor. */
  dust(x: number, heavy = true): void {
    const n = heavy ? 9 : 5
    for (let i = 0; i < n; i++) {
      const p = this.spawn(x + (Math.random() - 0.5) * 0.9, 0.08, (Math.random() - 0.5) * 0.5, '#b89474', 0.35, 0.7 + Math.random() * 0.3, false)
      p.sprite.material.opacity = 0.5
      p.vel.set((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6)
      p.grow = 1.4
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.sprite.visible) continue
      p.life -= dt
      if (p.life <= 0) {
        p.sprite.visible = false
        continue
      }
      p.vel.y -= p.gravity * dt
      p.sprite.position.addScaledVector(p.vel, dt)
      if (p.grow) {
        const s = Math.max(0.01, p.sprite.scale.x * (1 + p.grow * dt))
        p.sprite.scale.set(s, s, 1)
      }
      const k = p.life / p.max
      p.sprite.material.opacity = p.sprite.material.blending === THREE.NormalBlending ? 0.5 * k : k
    }
  }
}
