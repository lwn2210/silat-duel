import * as THREE from 'three'
import type { Fighter, MatchState } from '../sim/match'
import type { FighterId } from '../sim/moves'
import { LIMB_KEYS, POSE_KEYS, poseFor, type Limb, type Pose } from './poses'
import { batikKawung, batikMegamendung, batikParang } from './textures'

// A pendekar built from primitives: capsules on a jointed skeleton, dressed in
// a pangsi (loose top and wide trousers), a sash with hanging ends, a batik hip
// cloth and a headcloth. The model faces +z with its lead side at +x; player 1
// is the mirror image, so one set of poses serves both.
//
// Every joint chases its target pose with a damped spring instead of jumping
// there: strikes overshoot a little and settle, hits knock the body back and
// it wobbles home, and the sash and headcloth tails swing behind the body.

const THIGH = 0.43
const SHIN = 0.42
const ANKLE = 0.06
const UPPER_ARM = 0.27
const FOREARM = 0.25
/** Hip joint height with straight legs. */
const HIP_H = THIGH + SHIN + ANKLE
const N = POSE_KEYS.length + LIMB_KEYS.length * 3

interface Look {
  skin: string
  shirt: string
  trim: string
  pants: string
  sash: string
  cloth: () => THREE.Texture
  hair: string
}

const LOOKS: Record<FighterId, Look> = {
  jaka: { skin: '#a8693f', shirt: '#1d1817', trim: '#c0161f', pants: '#151111', sash: '#c0161f', cloth: () => batikParang('#9e1820', '#2a0c0a', '#e9b54a'), hair: '#120d0b' },
  sari: { skin: '#c48d62', shirt: '#22408a', trim: '#e0a526', pants: '#151d3a', sash: '#e0a526', cloth: () => batikKawung('#2c63ad', '#f1e3c2', '#152a55'), hair: '#0f0b0a' },
  gatot: { skin: '#9b5d38', shirt: '#1b3b22', trim: '#e8b839', pants: '#112415', sash: '#e8b839', cloth: () => batikMegamendung('#1b3b22', '#2e7d32', '#e8b839'), hair: '#14100e' },
}

interface LimbRig {
  top: THREE.Group
  mid: THREE.Group
  end: THREE.Group
  side: 1 | -1
}

/** A hanging piece of cloth with its own little spring. */
interface Tail {
  pivot: THREE.Group
  rest: number
  angle: number
  vel: number
}

function flatten(p: Pose, out: Float32Array): void {
  let i = 0
  for (const k of POSE_KEYS) out[i++] = p[k]
  for (const k of LIMB_KEYS) for (const v of p[k]) out[i++] = v
}

function unflatten(a: Float32Array, p: Pose): void {
  let i = 0
  for (const k of POSE_KEYS) p[k] = a[i++]!
  for (const k of LIMB_KEYS) {
    const l = p[k] as Limb
    l[0] = a[i++]!
    l[1] = a[i++]!
    l[2] = a[i++]!
  }
}

export class FighterView {
  readonly root = new THREE.Group()
  private readonly tiltPivot = new THREE.Group()
  private readonly pelvis = new THREE.Group()
  private readonly spine = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly arms: [LimbRig, LimbRig]
  private readonly legs: [LimbRig, LimbRig]
  private readonly fists: THREE.Object3D[] = []
  private readonly palms: THREE.Object3D[] = []
  private readonly tails: Tail[] = []
  private readonly materials: THREE.MeshStandardMaterial[] = []
  private readonly probe = new THREE.Vector3()
  private readonly target = new Float32Array(N)
  private readonly pos = new Float32Array(N)
  private readonly vel = new Float32Array(N)
  private readonly pose: Pose = { yaw: 0, lean: 0, twist: 0, side: 0, head: 0, la: [0, 0, 0], ra: [0, 0, 0], ll: [0, 0, 0], rl: [0, 0, 0], open: 1, lift: 0, tilt: 0 }
  private primed = false
  private flash = 0
  private flashColor = new THREE.Color('#ffffff')
  private lastX = 0

  constructor(
    scene: THREE.Scene,
    readonly side: 0 | 1,
    readonly id: FighterId,
  ) {
    const look = LOOKS[id]
    const mat = (color: string, rough = 0.85, map?: THREE.Texture) => {
      const m = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, roughness: rough, map: map ?? null, side: map ? THREE.DoubleSide : THREE.FrontSide })
      this.materials.push(m)
      return m
    }
    const skin = mat(look.skin, 0.55)
    const shirt = mat(look.shirt)
    const trim = mat(look.trim, 0.6)
    const pants = mat(look.pants)
    const sash = mat(look.sash, 0.65)
    const cloth = mat('', 0.8, look.cloth())
    const hair = mat(look.hair, 0.5)
    const dark = mat('#0b0706', 0.4)
    const white = mat('#f3ece2', 0.4)

    if (side === 1) this.root.scale.x = -1
    this.root.rotation.y = side === 0 ? Math.PI / 2 : -Math.PI / 2
    this.root.add(this.tiltPivot)
    this.tiltPivot.add(this.pelvis)
    this.pelvis.add(this.spine)

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], s?: [number, number, number], r?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(...p)
      if (s) mesh.scale.set(...s)
      if (r) mesh.rotation.set(...r)
      parent.add(mesh)
      return mesh
    }

    // Hips: trousers seat, batik hip cloth (kain samping) wrapped over it.
    add(this.pelvis, new THREE.CapsuleGeometry(0.15, 0.08, 4, 12), pants, [0, 0, 0], [1.2, 1, 0.82])
    add(this.pelvis, new THREE.CylinderGeometry(0.2, 0.25, 0.28, 20, 1, true), cloth, [0, -0.07, 0], [1, 1, 0.84])
    // The folded front panel of the samping.
    add(this.pelvis, new THREE.ConeGeometry(0.11, 0.3, 3, 1), cloth, [0.03, -0.1, 0.19], [1, 1, 0.25], [Math.PI, 0, 0])

    // Torso: V-shaped chest over a narrower waist.
    add(this.spine, new THREE.CapsuleGeometry(0.13, 0.12, 4, 12), shirt, [0, 0.13, 0], [1.15, 1, 0.8])
    add(this.spine, new THREE.CapsuleGeometry(0.16, 0.18, 4, 14), shirt, [0, 0.35, 0], [1.3, 1, 0.8])
    // Front opening and collar of the pangsi.
    add(this.spine, new THREE.BoxGeometry(0.035, 0.36, 0.02), trim, [0, 0.3, 0.135], undefined, [-0.12, 0, 0])
    add(this.spine, new THREE.TorusGeometry(0.075, 0.018, 6, 16, Math.PI * 1.3), trim, [0, 0.5, 0.02], [1, 1, 1.2], [Math.PI / 2 + 0.25, 0, Math.PI * 0.85])
    if (id === 'jaka') add(this.spine, new THREE.ConeGeometry(0.06, 0.16, 3), skin, [0, 0.46, 0.11], [1, 1, 0.3], [Math.PI, 0, 0])
    // Wide sash with a knot at the lead hip and two hanging ends.
    add(this.spine, new THREE.CylinderGeometry(0.175, 0.18, 0.11, 20), sash, [0, 0.03, 0], [1.05, 1, 0.82])
    add(this.spine, new THREE.SphereGeometry(0.045, 10, 8), sash, [0.13, 0.03, 0.12])
    for (const [dx, len] of [
      [0, 0.26],
      [0.04, 0.2],
    ] as const) {
      const pivot = new THREE.Group()
      pivot.position.set(0.13 + dx, 0.0, 0.13)
      add(pivot, new THREE.BoxGeometry(0.05, len, 0.015), sash, [0, -len / 2, 0])
      this.spine.add(pivot)
      this.tails.push({ pivot, rest: 0.08, angle: 0.08, vel: 0 })
    }

    // Neck and head.
    add(this.spine, new THREE.CylinderGeometry(0.052, 0.06, 0.1, 10), skin, [0, 0.56, 0])
    this.head.position.y = 0.6
    this.spine.add(this.head)
    add(this.head, new THREE.SphereGeometry(0.108, 20, 16), skin, [0, 0.1, 0], [0.9, 1.08, 1])
    add(this.head, new THREE.SphereGeometry(0.06, 12, 8), skin, [0, 0.045, 0.035], [1.1, 0.8, 1])
    for (const x of [-1, 1]) {
      add(this.head, new THREE.SphereGeometry(0.017, 8, 6), white, [x * 0.037, 0.115, 0.093], [1.2, 0.8, 0.6])
      add(this.head, new THREE.SphereGeometry(0.01, 8, 6), dark, [x * 0.037, 0.115, 0.102])
      add(this.head, new THREE.BoxGeometry(0.04, 0.008, 0.012), hair, [x * 0.04, 0.142, 0.098], undefined, [0, 0, x * -0.15])
      add(this.head, new THREE.SphereGeometry(0.022, 8, 6), skin, [x * 0.098, 0.1, 0], [0.5, 1, 0.8])
    }
    add(this.head, new THREE.ConeGeometry(0.018, 0.04, 6), skin, [0, 0.09, 0.112], undefined, [Math.PI / 2, 0, 0])
    add(this.head, new THREE.BoxGeometry(0.035, 0.007, 0.01), dark, [0, 0.055, 0.103])
    if (id === 'jaka') {
      add(this.head, new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, 0.11, -0.005])
      // Iket: batik headcloth, folded peak in front, knot and tails at the back.
      add(this.head, new THREE.TorusGeometry(0.106, 0.032, 8, 24), cloth, [0, 0.155, 0], undefined, [Math.PI / 2 + 0.15, 0, 0])
      add(this.head, new THREE.SphereGeometry(0.112, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), cloth, [0, 0.135, 0])
      add(this.head, new THREE.ConeGeometry(0.05, 0.07, 4), cloth, [0, 0.2, 0.06], [1, 1, 0.4], [0.3, Math.PI / 4, 0])
      add(this.head, new THREE.SphereGeometry(0.03, 8, 6), cloth, [0, 0.15, -0.11])
      for (const r of [-0.3, 0.3]) {
        const pivot = new THREE.Group()
        pivot.position.set(r * 0.06, 0.15, -0.12)
        pivot.rotation.z = r
        add(pivot, new THREE.BoxGeometry(0.045, 0.15, 0.012), cloth, [0, -0.075, 0])
        this.head.add(pivot)
        this.tails.push({ pivot, rest: -0.35, angle: -0.35, vel: 0 })
      }
      add(this.head, new THREE.BoxGeometry(0.07, 0.014, 0.022), hair, [0, 0.066, 0.1])
    } else if (id === 'sari') {
      add(this.head, new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, [0, 0.105, -0.008])
      // Fringe swept to one side.
      add(this.head, new THREE.BoxGeometry(0.13, 0.03, 0.04), hair, [0.01, 0.175, 0.075], undefined, [0.5, 0, -0.18])
      add(this.head, new THREE.SphereGeometry(0.07, 12, 10), hair, [0, 0.17, -0.11])
      add(this.head, new THREE.TorusGeometry(0.05, 0.012, 6, 16), sash, [0, 0.17, -0.11], undefined, [0.4, 0, 0])
      add(this.head, new THREE.TorusGeometry(0.112, 0.014, 6, 24), sash, [0, 0.165, 0], undefined, [Math.PI / 2 + 0.25, 0, 0])
      for (const x of [-1, 1]) add(this.head, new THREE.SphereGeometry(0.012, 6, 6), sash, [x * 0.1, 0.07, 0])
      // Hair ribbon tails from the bun.
      for (const r of [-0.25, 0.25]) {
        const pivot = new THREE.Group()
        pivot.position.set(r * 0.05, 0.15, -0.16)
        pivot.rotation.z = r
        add(pivot, new THREE.BoxGeometry(0.03, 0.14, 0.01), sash, [0, -0.07, 0])
        this.head.add(pivot)
        this.tails.push({ pivot, rest: -0.2, angle: -0.2, vel: 0 })
      }
    } else {
      // Gatot: Udeng Megamendung with golden rim
      add(this.head, new THREE.SphereGeometry(0.118, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, [0, 0.11, -0.005])
      add(this.head, new THREE.TorusGeometry(0.108, 0.035, 8, 24), cloth, [0, 0.155, 0], undefined, [Math.PI / 2 + 0.15, 0, 0])
      add(this.head, new THREE.SphereGeometry(0.114, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), cloth, [0, 0.135, 0])
      add(this.head, new THREE.ConeGeometry(0.06, 0.09, 4), trim, [0, 0.22, 0.05], [1, 1, 0.4], [0.2, 0, 0])
    }

    // Arms: wide pangsi sleeves with coloured cuffs, bare hands that switch between fist and open palm.
    this.arms = [1, -1].map((s) => {
      const top = new THREE.Group()
      top.position.set(s * 0.23, 0.48, 0)
      this.spine.add(top)
      add(top, new THREE.SphereGeometry(0.075, 12, 10), shirt, [0, -0.01, 0])
      top.add(this.bone(UPPER_ARM, 0.064, shirt))
      const mid = new THREE.Group()
      mid.position.y = -UPPER_ARM
      top.add(mid)
      mid.add(this.bone(FOREARM - 0.06, 0.058, shirt))
      add(mid, new THREE.CylinderGeometry(0.068, 0.058, 0.07, 12), shirt, [0, -FOREARM + 0.07, 0])
      add(mid, new THREE.TorusGeometry(0.066, 0.01, 6, 14), trim, [0, -FOREARM + 0.035, 0], undefined, [Math.PI / 2, 0, 0])
      const end = new THREE.Group()
      end.position.y = -FOREARM
      mid.add(end)
      add(end, new THREE.CylinderGeometry(0.032, 0.036, 0.06, 8), skin, [0, 0.02, 0])
      const fist = new THREE.Group()
      add(fist, new THREE.BoxGeometry(0.085, 0.085, 0.095), skin, [0, -0.04, 0])
      add(fist, new THREE.CapsuleGeometry(0.016, 0.04, 3, 6), skin, [0, -0.035, 0.05], undefined, [0, 0, Math.PI / 2])
      end.add(fist)
      // Open hand: flat palm with fingers together and the thumb along it.
      const palm = new THREE.Group()
      add(palm, new THREE.CapsuleGeometry(0.03, 0.08, 3, 8), skin, [0, -0.06, 0], [0.55, 1, 1.2])
      add(palm, new THREE.CapsuleGeometry(0.012, 0.035, 3, 6), skin, [0, -0.03, 0.04], undefined, [0.5, 0, 0])
      end.add(palm)
      this.fists.push(fist)
      this.palms.push(palm)
      return { top, mid, end, side: s as 1 | -1 }
    }) as [LimbRig, LimbRig]

    // Legs: loose pangsi trousers flaring at the ankle, bare feet.
    this.legs = [1, -1].map((s) => {
      const top = new THREE.Group()
      top.position.set(s * 0.1, -0.02, 0)
      this.pelvis.add(top)
      top.add(this.bone(THIGH, 0.092, pants))
      const mid = new THREE.Group()
      mid.position.y = -THIGH
      top.add(mid)
      add(mid, new THREE.SphereGeometry(0.083, 10, 8), pants, [0, 0, 0])
      add(mid, new THREE.CylinderGeometry(0.075, 0.1, SHIN - 0.02, 12), pants, [0, -SHIN / 2 + 0.01, 0])
      add(mid, new THREE.TorusGeometry(0.096, 0.01, 6, 14), trim, [0, -SHIN + 0.035, 0], undefined, [Math.PI / 2, 0, 0])
      const end = new THREE.Group()
      end.position.y = -SHIN
      mid.add(end)
      add(end, new THREE.CylinderGeometry(0.04, 0.045, 0.06, 8), skin, [0, 0.0, 0])
      add(end, new THREE.BoxGeometry(0.085, 0.05, 0.2), skin, [0, -0.035, 0.05])
      add(end, new THREE.CapsuleGeometry(0.03, 0.04, 3, 6), skin, [0, -0.04, 0.15], [1.3, 0.8, 1], [Math.PI / 2, 0, 0])
      return { top, mid, end, side: s as 1 | -1 }
    }) as [LimbRig, LimbRig]

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true
    })
    scene.add(this.root)
  }

  private bone(length: number, radius: number, material: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 1.4), 4, 10), material)
    m.position.y = -length / 2
    return m
  }

  private setLimb(rig: LimbRig, [pitch, roll, bend]: Limb, knee: boolean): void {
    rig.top.rotation.set(-pitch, 0, rig.side * roll)
    rig.mid.rotation.set(knee ? bend : -bend, 0, 0)
  }

  /** Snap to the next pose instead of springing there (new round). */
  reset(): void {
    this.primed = false
  }

  /** A blow lands: the body gets knocked (spring velocity) and flashes. */
  impulse(kind: 'hit' | 'heavy' | 'block' | 'parried'): void {
    const k = kind === 'heavy' || kind === 'parried' ? 1.6 : kind === 'hit' ? 1 : 0.4
    const lean = POSE_KEYS.indexOf('lean')
    const head = POSE_KEYS.indexOf('head')
    const twist = POSE_KEYS.indexOf('twist')
    this.vel[lean]! -= 7 * k
    this.vel[head]! -= 12 * k
    this.vel[twist]! += (Math.random() - 0.5) * 10 * k
    this.flash = kind === 'block' ? 0.22 : kind === 'parried' ? 0.35 : kind === 'heavy' ? 0.6 : 0.42
    this.flashColor.set(kind === 'block' ? '#8fc8ff' : kind === 'parried' ? '#ffd36a' : '#ffe2c4')
  }

  /** Stiff springs for strikes (snappy), loose ones for hits and juggles (wobbly). */
  private springFor(f: Fighter): [number, number] {
    if (f.act === 'attack' || f.act === 'throwing' || f.act === 'parry' || f.act === 'deflect') return [1300, 0.72]
    if (f.act === 'hitstun' || f.act === 'air' || f.act === 'blockstun' || f.act === 'stagger') return [650, 0.42]
    if (f.act === 'down' || f.act === 'ko' || f.act === 'thrown') return [500, 0.55]
    return [380, 0.62]
  }

  /**
   * `x`, `y`: interpolated sim position. `t`: fractional frames into the
   * fighter's act. `clock`: seconds, for idle motion.
   */
  update(f: Fighter, s: MatchState, x: number, y: number, t: number, clock: number, dt: number): void {
    flatten(poseFor(f, s, t, clock + this.side * 1.3), this.target)
    if (!this.primed) {
      this.pos.set(this.target)
      this.vel.fill(0)
      this.primed = true
      this.lastX = x
    }
    // Damped springs, integrated in small steps so a slow frame can't blow them up.
    const [k, zeta] = this.springFor(f)
    const c = 2 * zeta * Math.sqrt(k)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    for (let n = 0; n < steps; n++) {
      for (let i = 0; i < N; i++) {
        const a = k * (this.target[i]! - this.pos[i]!) - c * this.vel[i]!
        this.vel[i]! += a * h
        this.pos[i]! += this.vel[i]! * h
      }
    }
    unflatten(this.pos, this.pose)
    const p = this.pose

    // A hair apart in depth, so bodies pressed together overlap instead of cutting through each other.
    this.root.position.set(x, y, this.side === 0 ? 0.09 : -0.09)
    this.pelvis.rotation.set(0, p.yaw, 0)
    this.spine.rotation.set(p.lean, p.twist, -p.side)
    this.head.rotation.set(p.head, -p.twist * 0.5, 0)
    this.setLimb(this.arms[0], p.la, false)
    this.setLimb(this.arms[1], p.ra, false)
    this.setLimb(this.legs[0], p.ll, true)
    this.setLimb(this.legs[1], p.rl, true)
    const open = p.open > 0.5
    this.fists.forEach((m) => (m.visible = !open))
    this.palms.forEach((m) => (m.visible = open))

    // Cloth tails trail the body's motion and settle with a little bounce.
    const speed = dt > 0 ? (x - this.lastX) / dt : 0
    this.lastX = x
    const forward = speed * (this.side === 0 ? 1 : -1)
    for (const tail of this.tails) {
      const goal = tail.rest + Math.max(-0.9, Math.min(0.9, forward * 0.9)) + Math.sin(clock * 2.3 + tail.rest * 5) * 0.06
      for (let n = 0; n < steps; n++) {
        tail.vel += (90 * (goal - tail.angle) - 6 * tail.vel) * h
        tail.angle += tail.vel * h
      }
      tail.pivot.rotation.x = tail.angle
    }
    // Twisting the spine fast flicks the tails too.
    const twistVel = this.vel[POSE_KEYS.indexOf('twist')]!
    for (const tail of this.tails) tail.vel += twistVel * 0.02

    // Hit flash.
    if (this.flash > 0.01) {
      this.flash *= Math.exp(-dt * 18)
      for (const m of this.materials) {
        m.emissive.copy(this.flashColor)
        m.emissiveIntensity = this.flash
      }
    } else if (this.flash !== 0) {
      this.flash = 0
      for (const m of this.materials) m.emissiveIntensity = 0
    }

    // Plant the lowest foot or knee on the floor, then fall backward around the feet.
    this.tiltPivot.rotation.x = 0
    this.pelvis.position.y = HIP_H
    this.root.updateMatrixWorld(true)
    let low = Infinity
    for (const leg of this.legs) {
      low = Math.min(low, leg.end.getWorldPosition(this.probe).y - ANKLE, leg.mid.getWorldPosition(this.probe).y - 0.08)
    }
    // Feet stay on the floor: only a positive lift (hops, being thrown) raises the body.
    this.pelvis.position.y = HIP_H + (y - low) + Math.max(0, p.lift) + Math.sin(Math.max(0, p.tilt)) * 0.13
    this.tiltPivot.rotation.x = -p.tilt
  }
}
