import * as THREE from 'three'

// Every texture is painted on a canvas at start-up, so nothing is downloaded.
// Uses Math.random freely: it only decorates, the sim never sees it.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

function texture(c: HTMLCanvasElement, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 4
  return t
}

/** Batik parang: rows of slanted S-shapes, the classic diagonal motif. */
export function batikParang(base: string, ink: string, dot: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)
  g.save()
  g.translate(128, 128)
  g.rotate(-Math.PI / 4)
  g.translate(-200, -200)
  for (let row = 0; row < 400; row += 40) {
    g.fillStyle = ink
    g.fillRect(0, row, 400, 8)
    for (let x = 0; x < 400; x += 32) {
      g.beginPath()
      g.ellipse(x + 16, row + 24, 13, 9, 0.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = dot
      g.beginPath()
      g.arc(x + 16, row + 24, 3.5, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = ink
    }
  }
  g.restore()
  return texture(c, 2)
}

/** Batik kawung: four-petal ovals in a grid. */
export function batikKawung(base: string, ink: string, dot: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)
  const step = 64
  for (let y = 0; y <= 256; y += step) {
    for (let x = 0; x <= 256; x += step) {
      g.fillStyle = ink
      for (let k = 0; k < 4; k++) {
        g.beginPath()
        g.ellipse(x + Math.cos((k * Math.PI) / 2) * 16, y + Math.sin((k * Math.PI) / 2) * 16, 15, 9, (k * Math.PI) / 2, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = dot
      g.beginPath()
      g.arc(x, y, 4, 0, Math.PI * 2)
      g.fill()
    }
  }
  return texture(c, 2)
}

/** Batik megamendung: layered cloud shapes, classic motif with vibrant accents. */
export function batikMegamendung(base: string, cloud: string, accent: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = base
  g.fillRect(0, 0, 256, 256)
  const stepY = 64
  const stepX = 80
  for (let y = 0; y <= 256; y += stepY) {
    for (let x = -40; x <= 280; x += stepX) {
      const ox = (y / stepY) % 2 === 0 ? 0 : stepX / 2
      g.fillStyle = accent
      g.beginPath()
      g.ellipse(x + ox, y, 32, 18, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = cloud
      g.beginPath()
      g.ellipse(x + ox - 4, y, 22, 12, 0, 0, Math.PI * 2)
      g.fill()
      g.fillStyle = '#ffffff'
      g.beginPath()
      g.ellipse(x + ox - 6, y, 10, 5, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  return texture(c, 2)
}

/** Packed earth with grit, for the yard around the stone court. */
export function earth(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#8a5d3d'
  g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 9000; i++) {
    const v = Math.random()
    g.fillStyle = v < 0.5 ? `rgba(60,35,20,${0.08 + v * 0.12})` : `rgba(210,160,110,${(v - 0.5) * 0.18})`
    const r = Math.random() * 3 + 0.5
    g.fillRect(Math.random() * 512, Math.random() * 512, r, r)
  }
  return texture(c, 10)
}

/** Old stone slabs for the courtyard (pelataran). */
export function stoneTiles(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512)
  const rows = 4
  const h = 512 / rows
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -64 : 0
    while (x < 512) {
      const w = 96 + Math.floor(Math.random() * 3) * 32
      const l = 46 + Math.random() * 10
      g.fillStyle = `hsl(28, ${14 + Math.random() * 8}%, ${l}%)`
      g.fillRect(x, r * h, w, h)
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(40,25,15,${Math.random() * 0.12})`
        g.fillRect(x + Math.random() * w, r * h + Math.random() * h, 2, 2)
      }
      g.strokeStyle = 'rgba(45,28,18,0.55)'
      g.lineWidth = 4
      g.strokeRect(x + 2, r * h + 2, w - 4, h - 4)
      x += w
    }
  }
  return texture(c, 1)
}

/** Red brick for the wall and gate. */
export function brick(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#5a2a1c'
  g.fillRect(0, 0, 256, 256)
  const bh = 16
  for (let y = 0; y < 256; y += bh) {
    const off = (y / bh) % 2 ? 16 : 0
    for (let x = -32; x < 256; x += 32) {
      g.fillStyle = `hsl(${10 + Math.random() * 8}, ${45 + Math.random() * 15}%, ${30 + Math.random() * 10}%)`
      g.fillRect(x + off + 1, y + 1, 30, bh - 2)
    }
  }
  return texture(c, 1)
}

/** Wooden shingles (sirap) for the joglo roof. */
export function shingles(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256)
  g.fillStyle = '#3d2519'
  g.fillRect(0, 0, 256, 256)
  for (let y = 0; y < 256; y += 16) {
    const off = (y / 16) % 2 ? 10 : 0
    for (let x = -20; x < 256; x += 20) {
      g.fillStyle = `hsl(20, ${30 + Math.random() * 15}%, ${16 + Math.random() * 9}%)`
      g.fillRect(x + off + 1, y, 18, 15)
    }
  }
  return texture(c, 1)
}

/** The perguruan emblem on the court: rings, a lotus-like star and a border of triangles (tumpal). */
export function emblem(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512)
  g.clearRect(0, 0, 512, 512)
  g.translate(256, 256)
  const ink = 'rgba(70, 30, 14, 0.55)'
  const gold = 'rgba(214, 160, 70, 0.5)'
  g.lineWidth = 10
  g.strokeStyle = ink
  g.beginPath()
  g.arc(0, 0, 240, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 4
  g.beginPath()
  g.arc(0, 0, 205, 0, Math.PI * 2)
  g.stroke()
  // Tumpal triangles between the rings.
  g.fillStyle = gold
  for (let i = 0; i < 32; i++) {
    g.save()
    g.rotate((i / 32) * Math.PI * 2)
    g.beginPath()
    g.moveTo(-14, -232)
    g.lineTo(14, -232)
    g.lineTo(0, -210)
    g.closePath()
    g.fill()
    g.restore()
  }
  // Eight-petal star.
  g.fillStyle = ink
  for (let i = 0; i < 8; i++) {
    g.save()
    g.rotate((i / 8) * Math.PI * 2)
    g.beginPath()
    g.ellipse(0, -95, 30, 85, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  g.fillStyle = gold
  g.beginPath()
  g.arc(0, 0, 46, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Soft round blob for sparks, dust and glows. */
export function softDot(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64)
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
