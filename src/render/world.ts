import * as THREE from 'three'
import { brick, earth, emblem, shingles, softDot, stoneTiles } from './textures'

// The arena: a stone courtyard (pelataran) in front of a joglo pendopo at a
// padepokan, late afternoon. Brick wall and split gate behind, palms and a
// volcano in the haze, torches already lit. All primitives, no assets.

const SKY_TOP = new THREE.Color('#3b2a5c')
const SKY_MID = new THREE.Color('#d9734a')
const SKY_LOW = new THREE.Color('#f7c27c')

interface Torch {
  flame: THREE.Mesh
  glow: THREE.Sprite
  light: THREE.PointLight | null
  seed: number
}

/** A box-like frustum: rectangle (w0 × d0) at the bottom to (w1 × d1) at height h. Sides only. */
function frustum(w0: number, d0: number, w1: number, d1: number, h: number): THREE.BufferGeometry {
  const b = [
    [-w0 / 2, 0, -d0 / 2],
    [w0 / 2, 0, -d0 / 2],
    [w0 / 2, 0, d0 / 2],
    [-w0 / 2, 0, d0 / 2],
  ]
  const t = [
    [-w1 / 2, h, -d1 / 2],
    [w1 / 2, h, -d1 / 2],
    [w1 / 2, h, d1 / 2],
    [-w1 / 2, h, d1 / 2],
  ]
  const pos: number[] = []
  const uv: number[] = []
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    const quad = [b[i]!, b[j]!, t[j]!, b[i]!, t[j]!, t[i]!]
    pos.push(...quad.flat())
    const w = i % 2 ? d0 : w0
    uv.push(0, 0, w / 2, 0, w / 2, h / 2, 0, 0, w / 2, h / 2, 0, h / 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

export class World {
  readonly sun: THREE.DirectionalLight
  private readonly torches: Torch[] = []
  private readonly embers: THREE.Points
  private readonly emberVel: Float32Array
  private readonly flags: { mesh: THREE.Mesh; base: Float32Array; seed: number }[] = []
  private readonly leaves: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3 }[] = []

  constructor(private readonly scene: THREE.Scene) {
    scene.fog = new THREE.Fog('#c9805c', 22, 110)
    scene.background = SKY_MID.clone()
    this.sky()

    const hemi = new THREE.HemisphereLight('#8f7fb8', '#5a3422', 1.1)
    scene.add(hemi)
    // Low warm sun from the front left, long shadows across the court.
    this.sun = new THREE.DirectionalLight('#ffbb7d', 2.6)
    this.sun.position.set(-7, 6.5, 8)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(1024, 1024)
    const sc = this.sun.shadow.camera
    sc.left = -7
    sc.right = 7
    sc.top = 5
    sc.bottom = -3
    sc.near = 1
    sc.far = 30
    this.sun.shadow.bias = -0.0008
    this.sun.shadow.normalBias = 0.02
    scene.add(this.sun, this.sun.target)
    const rim = new THREE.DirectionalLight('#ff8a5c', 0.9)
    rim.position.set(4, 3, -8)
    scene.add(rim)

    this.ground()
    this.pendopo(0, -9.5)
    this.wall()
    this.gate(-9.5, -13.2)
    this.trees()
    this.mountains()
    this.torch(-5.6, -2.3, true)
    this.torch(5.6, -2.3, true)
    this.torch(-3.4, -3.9, false)
    this.torch(3.4, -3.9, false)
    this.torch(-8.5, 1.5, false)
    this.torch(8.5, 1.5, false)
    this.courtEmblem()
    for (const [x, z, color] of [
      [-12, -12.4, '#c8202a'],
      [-7.2, -12.4, '#f1e3c2'],
      [6.5, -12.4, '#e0a526'],
      [11.5, -12.4, '#c8202a'],
    ] as const)
      this.umbul(x, z, color, 7)
    this.umbul(-7.6, -3.6, '#e0a526', 5.2)
    this.umbul(7.6, -3.6, '#c8202a', 5.2)
    this.lanterns()
    this.fallingLeaves()

    const n = 60
    const pos = new Float32Array(n * 3)
    this.emberVel = new Float32Array(n)
    for (let i = 0; i < n; i++) this.resetEmber(pos, i, true)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this.embers = new THREE.Points(
      g,
      new THREE.PointsMaterial({ color: '#ffb35c', size: 0.06, map: softDot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    scene.add(this.embers)
  }

  private sky(): void {
    const geo = new THREE.SphereGeometry(400, 32, 16)
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: SKY_TOP },
        mid: { value: SKY_MID },
        low: { value: SKY_LOW },
        sunDir: { value: new THREE.Vector3(-0.55, 0.12, -1).normalize() },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          c += vec3(1.0, 0.75, 0.45) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.35);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    this.scene.add(new THREE.Mesh(geo, mat))
  }

  private ground(): void {
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(140, 100), new THREE.MeshStandardMaterial({ map: earth(), roughness: 1 }))
    yard.rotation.x = -Math.PI / 2
    yard.position.y = -0.04
    yard.receiveShadow = true
    this.scene.add(yard)

    const tiles = stoneTiles()
    tiles.repeat.set(5, 2)
    const court = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.06, 5.6), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.95 }))
    court.position.set(0, -0.03, 0.2)
    court.renderOrder = 1
    court.receiveShadow = true
    this.scene.add(court)
    // Border kerb.
    const kerbMat = new THREE.MeshStandardMaterial({ color: '#6b4a36', roughness: 1 })
    for (const [w, d, x, z] of [
      [12.9, 0.18, 0, -2.6],
      [12.9, 0.18, 0, 3.0],
      [0.18, 5.8, -6.4, 0.2],
      [0.18, 5.8, 6.4, 0.2],
    ] as const) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), kerbMat)
      k.position.set(x, 0.02, z)
      k.receiveShadow = true
      this.scene.add(k)
    }
  }

  private pendopo(cx: number, cz: number): void {
    const g = new THREE.Group()
    g.position.set(cx, 0, cz)
    const stone = new THREE.MeshStandardMaterial({ color: '#7d6656', roughness: 1 })
    const wood = new THREE.MeshStandardMaterial({ color: '#6a3f22', roughness: 0.8 })
    const darkWood = new THREE.MeshStandardMaterial({ color: '#3f2414', roughness: 0.8 })
    const roofTex = shingles()
    roofTex.repeat.set(3, 2)
    const roof = new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.9, side: THREE.DoubleSide })

    // Stone platform with steps.
    const base = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 7.2), stone)
    base.position.y = 0.25
    g.add(base)
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(4, 0.17, 0.4), stone)
      s.position.set(0, 0.085 + i * 0.17, 3.8 - i * 0.35)
      g.add(s)
    }

    // Pillars: four tall saka guru in the middle, a ring of shorter ones outside.
    const pillar = (x: number, z: number, h: number, r: number) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(r, h, r), wood)
      p.position.set(x, 0.5 + h / 2, z)
      g.add(p)
      const umpak = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, 0.18, 4), stone)
      umpak.rotation.y = Math.PI / 4
      umpak.position.set(x, 0.59, z)
      g.add(umpak)
    }
    for (const x of [-1.5, 1.5]) for (const z of [-1.3, 1.3]) pillar(x, z, 3.9, 0.24)
    for (const x of [-5.4, -3.2, -1, 1, 3.2, 5.4]) {
      pillar(x, -3.2, 2.2, 0.17)
      pillar(x, 3.2, 2.2, 0.17)
    }
    for (const z of [-1.1, 1.1]) {
      pillar(-5.4, z, 2.2, 0.17)
      pillar(5.4, z, 2.2, 0.17)
    }
    // Beams.
    const beam = (w: number, d: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), darkWood)
      m.position.y = y
      g.add(m)
    }
    beam(11.2, 6.8, 2.75)
    beam(3.6, 3.2, 4.4)

    // Joglo roof: shallow outer skirt, steeper middle, tall ridge on top.
    const layers: [number, number, number, number, number, number][] = [
      [13.4, 8.6, 7.2, 4.8, 0.85, 2.7],
      [7.2, 4.8, 4.4, 3.4, 0.95, 3.55],
      [4.4, 3.4, 2.6, 0.25, 2.0, 4.5],
    ]
    for (const [w0, d0, w1, d1, h, y] of layers) {
      const m = new THREE.Mesh(frustum(w0, d0, w1, d1, h), roof)
      m.position.y = y
      m.castShadow = true
      g.add(m)
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 0.32), darkWood)
    ridge.position.y = 6.55
    g.add(ridge)
    for (const x of [-1.45, 1.45]) {
      const end = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), darkWood)
      end.position.set(x, 6.75, 0)
      g.add(end)
    }

    // A gamelan corner: hanging gong on its frame and a pair of kendang.
    const bronze = new THREE.MeshStandardMaterial({ color: '#b8862f', metalness: 0.75, roughness: 0.35 })
    const frame = new THREE.Group()
    frame.position.set(-2.6, 0.5, -1.8)
    for (const x of [-0.8, 0.8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.12), darkWood)
      post.position.set(x, 0.95, 0)
      frame.add(post)
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.14), darkWood)
    bar.position.y = 1.85
    frame.add(bar)
    const gong = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 28), bronze)
    gong.rotation.x = Math.PI / 2
    gong.position.y = 1.15
    frame.add(gong)
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), bronze)
    boss.position.set(0, 1.15, 0.06)
    frame.add(boss)
    g.add(frame)
    const drumMat = new THREE.MeshStandardMaterial({ color: '#7a4a2a', roughness: 0.6 })
    for (const [x, s] of [
      [1.8, 1],
      [2.5, 0.7],
    ] as const) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * s, 0.17 * s, 0.6 * s, 14), drumMat)
      drum.rotation.z = Math.PI / 2
      drum.position.set(x, 0.5 + 0.18 * s, -1.6)
      g.add(drum)
    }

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.receiveShadow = true
        o.castShadow = true
      }
    })
    this.scene.add(g)
  }

  private wall(): void {
    const tex = brick()
    tex.repeat.set(16, 1)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
    const capMat = new THREE.MeshStandardMaterial({ color: '#4a2116', roughness: 1 })
    const seg = (w: number, x: number, z: number, rot = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.9, 0.4), mat)
      m.position.set(x, 0.95, z)
      m.rotation.y = rot
      this.scene.add(m)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.14, 0.55), capMat)
      cap.position.set(x, 1.95, z)
      cap.rotation.y = rot
      this.scene.add(cap)
    }
    seg(22, 2.4, -13.2)
    seg(6, -15, -13.2)
    seg(16, -18, -5.2, Math.PI / 2)
    seg(16, 18, -5.2, Math.PI / 2)
  }

  /** Candi bentar: a tower split down the middle to make a gate. */
  private gate(x: number, z: number): void {
    const tex = brick()
    tex.repeat.set(2, 3)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
    for (const s of [-1, 1]) {
      const half = new THREE.Group()
      half.position.set(x + s * 1.35, 0, z)
      const tiers: [number, number, number][] = [
        [1.6, 1.6, 0],
        [1.35, 1.0, 1.6],
        [1.1, 0.8, 2.6],
        [0.85, 0.6, 3.4],
        [0.6, 0.5, 4.0],
        [0.35, 0.45, 4.5],
      ]
      for (const [w, h, y] of tiers) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat)
        box.position.y = y + h / 2
        box.castShadow = true
        half.add(box)
      }
      this.scene.add(half)
    }
  }

  private trees(): void {
    const trunk = new THREE.MeshStandardMaterial({ color: '#5c4434', roughness: 1 })
    const frond = new THREE.MeshStandardMaterial({ color: '#2f4a26', roughness: 1, side: THREE.DoubleSide })
    const palm = (x: number, z: number, h: number, lean: number) => {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      g.rotation.z = lean
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 7), trunk)
      t.position.y = h / 2
      g.add(t)
      for (let i = 0; i < 8; i++) {
        const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.6), frond)
        leaf.position.set(0, h, 0)
        leaf.rotation.set(-1.0, (i / 8) * Math.PI * 2, 0)
        leaf.translateY(1.1)
        g.add(leaf)
      }
      this.scene.add(g)
    }
    palm(-13, -16, 8, 0.08)
    palm(-6, -17.5, 9.5, -0.06)
    palm(7.5, -16.5, 8.5, 0.1)
    palm(13.5, -18, 10, -0.05)
    palm(16, -10, 7.5, -0.12)
    palm(-16.5, -9, 8, 0.1)
    const leaves = new THREE.MeshStandardMaterial({ color: '#33462a', roughness: 1 })
    for (const [x, z, r] of [
      [-20, -22, 4.5],
      [3, -24, 5],
      [20, -21, 4],
      [-28, -12, 5],
      [28, -14, 5.5],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(r * (0.6 + Math.random() * 0.4), 10, 8), leaves)
        b.position.set(x + (Math.random() - 0.5) * r, r * 0.9 + Math.random() * r * 0.6, z + (Math.random() - 0.5) * r * 0.5)
        this.scene.add(b)
      }
    }
  }

  private mountains(): void {
    const mat = new THREE.MeshBasicMaterial({ color: '#8a5a6e', fog: true })
    const far = new THREE.Mesh(new THREE.ConeGeometry(70, 42, 24, 1, true), mat)
    far.position.set(-40, 19, -170)
    this.scene.add(far)
    const mat2 = new THREE.MeshBasicMaterial({ color: '#9a6670', fog: true })
    const near = new THREE.Mesh(new THREE.ConeGeometry(55, 24, 20, 1, true), mat2)
    near.position.set(60, 10, -140)
    this.scene.add(near)
  }

  private torch(x: number, z: number, lit: boolean): void {
    const bamboo = new THREE.MeshStandardMaterial({ color: '#a88a4a', roughness: 0.8 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 2.1, 7), bamboo)
    pole.position.set(x, 1.05, z)
    pole.castShadow = true
    this.scene.add(pole)
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.18, 8), new THREE.MeshStandardMaterial({ color: '#3a2a1c' }))
    cup.position.set(x, 2.15, z)
    this.scene.add(cup)
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.09, 0.36, 8),
      new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    flame.position.set(x, 2.38, z)
    this.scene.add(flame)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ff9a3c', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    glow.position.set(x, 2.35, z)
    glow.scale.set(1.1, 1.1, 1)
    this.scene.add(glow)
    let light: THREE.PointLight | null = null
    if (lit) {
      light = new THREE.PointLight('#ff9040', 6, 9, 1.6)
      light.position.set(x, 2.45, z)
      this.scene.add(light)
    }
    this.torches.push({ flame, glow, light, seed: Math.random() * 100 })
  }

  /** The perguruan emblem painted on the stones where the duel happens. */
  private courtEmblem(): void {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 4.6),
      new THREE.MeshStandardMaterial({ map: emblem(), transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    )
    decal.rotation.x = -Math.PI / 2
    decal.position.set(0, 0.002, 0.1)
    decal.receiveShadow = true
    this.scene.add(decal)
  }

  /** Umbul-umbul: a tall bent bamboo pole with a long banner that ripples in the wind. */
  private umbul(x: number, z: number, color: string, h: number): void {
    const bamboo = new THREE.MeshStandardMaterial({ color: '#b39456', roughness: 0.8 })
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, h, 6), bamboo)
    pole.position.set(x, h / 2, z)
    pole.rotation.z = 0.04
    this.scene.add(pole)
    const geo = new THREE.PlaneGeometry(0.5, 4.2, 4, 16)
    geo.translate(0.27, -2.1, 0)
    geo.scale(1, h / 7.5, 1)
    const banner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide }))
    banner.position.set(x, h - 0.1, z)
    banner.castShadow = true
    this.scene.add(banner)
    this.flags.push({ mesh: banner, base: Float32Array.from(geo.getAttribute('position').array), seed: Math.random() * 10 })
  }

  /** Oil lamps hanging from the pendopo beams. */
  private lanterns(): void {
    const frame = new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.7 })
    const glass = new THREE.MeshStandardMaterial({ color: '#ffcf7a', emissive: '#ff9a3c', emissiveIntensity: 1.6, roughness: 0.4 })
    for (const x of [-3.6, 0, 3.6]) {
      const g = new THREE.Group()
      g.position.set(x, 2.15, -6.2)
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), frame)
      cord.position.y = 0.25
      g.add(cord)
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.26, 6), glass))
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.12, 6), frame)
      cap.position.y = 0.18
      g.add(cap)
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ffb05a', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }))
      glow.scale.set(0.9, 0.9, 1)
      g.add(glow)
      this.scene.add(g)
    }
  }

  /** A few dry leaves drifting down across the court. */
  private fallingLeaves(): void {
    const geo = new THREE.PlaneGeometry(0.09, 0.05)
    const colors = ['#9a6a2a', '#7b5a24', '#a8452a', '#6a6a2a']
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, roughness: 1 }))
      mesh.position.set((Math.random() - 0.5) * 14, Math.random() * 6, -3 + Math.random() * 4)
      this.scene.add(mesh)
      this.leaves.push({ mesh, vel: new THREE.Vector3(0.25 + Math.random() * 0.3, -(0.25 + Math.random() * 0.25), 0), spin: new THREE.Vector3(Math.random() * 3, Math.random() * 3, Math.random() * 3) })
    }
  }

  private resetEmber(pos: Float32Array, i: number, scatter: boolean): void {
    const t = [-5.6, 5.6, -3.4, 3.4][i % 4]!
    pos[i * 3] = t + (Math.random() - 0.5) * 0.15
    pos[i * 3 + 1] = 2.45 + (scatter ? Math.random() * 2.5 : 0)
    pos[i * 3 + 2] = (i % 4 < 2 ? -2.3 : -3.9) + (Math.random() - 0.5) * 0.15
    this.emberVel[i] = 0.3 + Math.random() * 0.5
  }

  /** Flicker the torches, drift the embers, keep the shadow box around the fight. */
  update(clock: number, dt: number, focusX: number): void {
    for (const t of this.torches) {
      const f = 0.8 + 0.2 * Math.sin(clock * 13 + t.seed) * Math.sin(clock * 7.3 + t.seed * 2)
      t.flame.scale.set(1, f * (0.9 + 0.2 * Math.sin(clock * 21 + t.seed)), 1)
      t.glow.material.opacity = 0.4 + 0.2 * f
      if (t.light) t.light.intensity = 5 + 2.5 * f
    }
    const attr = this.embers.geometry.getAttribute('position') as THREE.BufferAttribute
    const pos = attr.array as Float32Array
    for (let i = 0; i < this.emberVel.length; i++) {
      pos[i * 3 + 1] += this.emberVel[i]! * dt
      pos[i * 3] += Math.sin(clock * 2 + i) * 0.15 * dt
      if (pos[i * 3 + 1]! > 5.2) this.resetEmber(pos, i, false)
    }
    attr.needsUpdate = true

    for (const f of this.flags) {
      const a = f.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = a.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        // Ripple grows toward the free end of the banner.
        const along = -f.base[i + 1]! / 4.2
        const across = f.base[i]! / 0.55
        const w = Math.sin(clock * 2.6 + along * 5 + f.seed) * 0.22 * along + Math.sin(clock * 4.1 + across * 3 + f.seed) * 0.05 * along
        arr[i + 2] = w
        arr[i] = f.base[i]! + w * 0.3
      }
      a.needsUpdate = true
      f.mesh.geometry.computeVertexNormals()
    }
    for (const l of this.leaves) {
      l.mesh.position.addScaledVector(l.vel, dt)
      l.mesh.position.x += Math.sin(clock * 1.7 + l.spin.x * 3) * 0.3 * dt
      l.mesh.rotation.x += l.spin.x * dt
      l.mesh.rotation.y += l.spin.y * dt
      if (l.mesh.position.y < 0.02) {
        l.mesh.position.set(focusX - 8 + Math.random() * 6, 5 + Math.random() * 2, -3 + Math.random() * 4)
      }
    }
    this.sun.position.set(focusX - 7, 6.5, 8)
    this.sun.target.position.set(focusX, 0.8, 0)
  }
}
