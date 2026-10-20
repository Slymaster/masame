// Salle Honinbo: an Edo-period room at night (the layout is ours, not documented). An andon stands on the tatami at the
// far left of the board, the lamp inside its paper (setLampPose), its warm glow the room's only light; when the eyes rise,
// the tokonoma across the room, a hanging scroll of abstract ink strokes (never real writing) in it, faintly lit.
import * as THREE from 'three'
import type { Scene } from '.'

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const canvas = (w: number, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h })

/** The andon on the floor (mm, board-top coordinates): its centre on the tatami, its size, and where its light sits inside. */
export const ANDON = { x: -820, z: -480, w: 250, h: 720, paper: [190, 610] as [number, number], light: 430 }
/** Warm paper glow (~2400 K through washi). */
export const ANDON_COLOR = 0xffa65a
/** The tokonoma: the room's far wall (z), the alcove's opening (x), its depth and the raised floor's height. */
const TOKO = { wall: -1400, x0: -700, x1: 800, depth: 520, floor: 100 }

/**
 * The scroll (kakejiku), 450 × 1800 mm: silk mounting (dark heaven and earth panels, a paler surround, two thin bands),
 * the paper, and on it a column of abstract ink marks made of pressed, lifted, dry-brushed strokes and a vermilion seal.
 * Nothing in it is a real character.
 */
export function scrollMap(seed = 5) {
  const W = 512, H = 2048, cv = canvas(W, H), x = cv.getContext('2d')!, r = rng(seed), k = W / 450
  x.fillStyle = '#3a3226'; x.fillRect(0, 0, W, H) // the heaven and earth silk
  x.fillStyle = '#6e6250'; x.fillRect(40 * k, 300 * k, 370 * k, 1400 * k) // the surround
  x.fillStyle = '#8a7444'; x.fillRect(40 * k, 300 * k, 370 * k, 22 * k); x.fillRect(40 * k, 1678 * k, 370 * k, 22 * k) // the bands (ichimonji)
  const px0 = 75 * k, py0 = 340 * k, pw = 300 * k, ph = 1320 * k
  const pg = x.createLinearGradient(0, py0, 0, py0 + ph); pg.addColorStop(0, '#e2d6bc'); pg.addColorStop(1, '#d8caa8') // aged paper
  x.fillStyle = pg; x.fillRect(px0, py0, pw, ph)
  for (let i = 0; i < 1500; i++) { x.fillStyle = `rgba(120,100,70,${0.04 * r()})`; x.fillRect(px0 + r() * pw, py0 + r() * ph, 1 + 3 * r(), 1 + 3 * r()) }
  // a stroke: a curve swept by a brush whose width swells and lifts, its edge broken where the brush runs dry
  const stroke = (pts: [number, number][], w0: number, dry: number) => {
    const n = 60
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t
      const [a, b, c] = pts, X = u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], Y = u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]
      const w = w0 * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + (t < 0.08 ? 0.35 : 0)) // a press at the start, a lift at the end
      x.fillStyle = `rgba(18,14,12,${0.82 + 0.15 * r()})`
      x.beginPath(); x.ellipse(X, Y, w, w * 0.8, 0.6, 0, 6.2832); x.fill()
      if (t > 1 - dry) for (let j = 0; j < 5; j++) { x.fillStyle = '#ddd0b2'; x.fillRect(X - w + 2 * w * r(), Y - w + 2 * w * r(), 1.2, 1.2 + 3 * r()) } // dry brush
    }
  }
  const cx = px0 + pw / 2
  for (let g = 0; g < 5; g++) { // five marks down the column, each a few strokes
    const gy = py0 + (130 + g * 268) * k, s = (70 + 30 * r()) * k
    for (let i = 0, m = 3 + Math.floor(r() * 3); i < m; i++) {
      const a: [number, number] = [cx + (r() - 0.5) * s * 1.6, gy + (r() - 0.5) * s * 1.4], c: [number, number] = [a[0] + (r() - 0.5) * s * 1.8, a[1] + (r() - 0.2) * s * 1.4]
      stroke([a, [(a[0] + c[0]) / 2 + (r() - 0.5) * s, (a[1] + c[1]) / 2 + (r() - 0.5) * s], c], (3 + 5 * r()) * k, 0.2 + 0.4 * r())
    }
  }
  x.fillStyle = '#a8321e'; x.fillRect(cx + 78 * k, py0 + 1270 * k, 26 * k, 26 * k) // the seal: a plain vermilion square
  x.fillStyle = '#d8caa8'; x.fillRect(cx + 83 * k, py0 + 1275 * k, 16 * k, 4 * k); x.fillRect(cx + 83 * k, py0 + 1285 * k, 6 * k, 8 * k)
  return cv
}

/** The andon's paper as its light shows it: brightest low (where the flame is), the frame's middle rail and the paper's fibres darker. */
function paperMap() {
  const W = 128, H = 256, cv = canvas(W, H), x = cv.getContext('2d')!, r = rng(13)
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#b08a60'); g.addColorStop(0.55, '#fff0d8'); g.addColorStop(0.8, '#ffe6c2'); g.addColorStop(1, '#c09670')
  x.fillStyle = g; x.fillRect(0, 0, W, H)
  const side = x.createLinearGradient(0, 0, W, 0); side.addColorStop(0, 'rgba(60,30,10,0.35)'); side.addColorStop(0.5, 'rgba(60,30,10,0)'); side.addColorStop(1, 'rgba(60,30,10,0.35)')
  x.fillStyle = side; x.fillRect(0, 0, W, H)
  for (let i = 0; i < 400; i++) { x.strokeStyle = `rgba(120,80,40,${0.1 * r()})`; x.beginPath(); const px = r() * W, py = r() * H; x.moveTo(px, py); x.lineTo(px + (r() - 0.5) * 20, py + (r() - 0.5) * 20); x.stroke() }
  x.fillStyle = 'rgba(40,20,8,0.6)'; x.fillRect(0, H * 0.42, W, 5) // the frame's middle rail, seen through the paper
  x.fillStyle = 'rgba(60,30,10,0.22)'; x.fillRect(W / 2 - 1, 0, 3, H); for (const f of [0.18, 0.66, 0.84]) x.fillRect(0, H * f, W, 2) // the thin lattice the paper is pasted on
  return cv
}

export default (): Scene => {
  const own: { dispose(): void }[] = []
  return {
    animated: false,
    build(ctx) {
      const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = false) => { const o = new THREE.Mesh(geo, m); o.castShadow = cast; o.receiveShadow = true; ctx.root.add(o); own.push(geo); return o }
      const M = (o: THREE.MeshStandardMaterialParameters) => { const m = new THREE.MeshStandardMaterial(o); own.push(m); return m }
      // the andon: a dark wooden frame (four legs, rails, a top rim), paper sides glowing with the light inside.
      // Nothing of it casts a shadow: the lamp sits inside it.
      const A = ANDON, FLOOR = ctx.board.groundY, wood = M({ color: 0x2a1a10, roughness: 0.55 })
      const ptex = new THREE.CanvasTexture(paperMap()); ptex.colorSpace = THREE.SRGBColorSpace; own.push(ptex)
      const paper = M({ color: 0x5a4a38, roughness: 0.9, emissive: ANDON_COLOR, emissiveMap: ptex, emissiveIntensity: 1.6, side: THREE.DoubleSide })
      const at = (geo: THREE.BufferGeometry, dx: number, y: number, dz: number) => geo.translate(A.x + dx, FLOOR + y, A.z + dz)
      const s = A.w / 2
      for (const [dx, dz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) add(at(new THREE.BoxGeometry(22, A.h, 22), dx, A.h / 2, dz), wood)
      for (const y of [A.paper[0], (A.paper[0] + A.paper[1]) / 2 - 20, A.paper[1], A.h - 10]) for (const [dx, dz, w, d] of [[0, -s, A.w, 16], [0, s, A.w, 16], [-s, 0, 16, A.w], [s, 0, 16, A.w]]) add(at(new THREE.BoxGeometry(w, 16, d), dx, y, dz), wood)
      add(at(new THREE.BoxGeometry(A.w, 10, A.w), 0, A.paper[0] - 30, 0), wood) // the shelf the oil dish stands on
      for (const dz of [-s, s]) add(at(new THREE.BoxGeometry(18, 120, 18), 0, A.h + 60, dz), wood) // the carrying handle's uprights
      add(at(new THREE.BoxGeometry(18, 18, A.w + 18), 0, A.h + 120, 0), wood) // and its bar
      const ph = A.paper[1] - A.paper[0]
      for (const [dx, dz, ry] of [[0, -s + 3, 0], [0, s - 3, 0], [-s + 3, 0, Math.PI / 2], [s - 3, 0, Math.PI / 2]]) add(at(new THREE.PlaneGeometry(A.w - 20, ph).rotateY(ry), dx, A.paper[0] + ph / 2, dz), paper)
      // the paper's own glow on the tatami round the andon's foot (the lamp's cone looks away, at the board)
      const pool = canvas(128), px = pool.getContext('2d')!, pg = px.createRadialGradient(64, 64, 0, 64, 64, 64)
      pg.addColorStop(0, 'rgba(255,170,90,0.5)'); pg.addColorStop(0.35, 'rgba(255,160,80,0.22)'); pg.addColorStop(1, 'rgba(255,150,70,0)')
      px.fillStyle = pg; px.fillRect(0, 0, 128, 128)
      const pt = new THREE.CanvasTexture(pool); pt.colorSpace = THREE.SRGBColorSpace; own.push(pt)
      const pm = new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true }); own.push(pm)
      add(at(new THREE.PlaneGeometry(1300, 1300).rotateX(-Math.PI / 2), 0, 0.5, 0), pm).renderOrder = 1
      ctx.setLampPose(new THREE.Vector3(A.x, FLOOR + A.light, A.z), new THREE.Vector3(150, 0, 120)) // aimed past the centre: the board's far corners as lit as its near ones
      ctx.setLampColor(new THREE.Color(ANDON_COLOR))
      // the tokonoma across the room: a clay wall, the alcove's raised floor behind its black lacquered edge, the post at
      // its left, the scroll on the back wall. Faintly self-lit (emissive ∝ its colour): the andon's glow reaching that far.
      const T = TOKO, back = T.wall - T.depth, glow = (c: number, e: number) => M({ color: c, roughness: 0.9, emissive: c, emissiveIntensity: e })
      const clay = glow(0x6b5640, 0.12), clayIn = glow(0x5e4b38, 0.09)
      add(new THREE.PlaneGeometry(2400, 2400).translate(T.x0 - 1200, FLOOR + 1200, T.wall), clay) // the wall left of the alcove
      add(new THREE.PlaneGeometry(2400, 2400).translate(T.x1 + 1200, FLOOR + 1200, T.wall), clay) // and right of it
      add(new THREE.PlaneGeometry(T.x1 - T.x0, 2400).translate((T.x0 + T.x1) / 2, FLOOR + 1200, back), clayIn) // the alcove's back
      for (const xx of [T.x0, T.x1]) add(new THREE.PlaneGeometry(T.depth, 2400).rotateY(xx === T.x0 ? Math.PI / 2 : -Math.PI / 2).translate(xx, FLOOR + 1200, T.wall - T.depth / 2), clayIn)
      add(new THREE.BoxGeometry(T.x1 - T.x0, T.floor, T.depth).translate((T.x0 + T.x1) / 2, FLOOR + T.floor / 2, T.wall - T.depth / 2), M({ color: 0x4a3322, roughness: 0.4, emissive: 0x4a3322, emissiveIntensity: 0.16 }))
      add(new THREE.BoxGeometry(T.x1 - T.x0 + 20, T.floor + 6, 46).translate((T.x0 + T.x1) / 2, FLOOR + T.floor / 2 + 3, T.wall + 20), M({ color: 0x0c0a09, roughness: 0.2, metalness: 0, emissive: 0x0c0a09 }))
      add(new THREE.CylinderGeometry(55, 60, 2400, 20).translate(T.x0 - 10, FLOOR + 1200, T.wall + 20), M({ color: 0x6a4e34, roughness: 0.55, emissive: 0x6a4e34, emissiveIntensity: 0.2 })) // the tokobashira
      const st = new THREE.CanvasTexture(scrollMap()); st.colorSpace = THREE.SRGBColorSpace; st.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()); own.push(st)
      const scroll = M({ map: st, roughness: 0.85, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: 0.13 })
      const sx = (T.x0 + T.x1) / 2 + 40, sb = FLOOR + T.floor + 70 // a long scroll: its roller just above the alcove's floor
      add(new THREE.PlaneGeometry(450, 1800).translate(sx, sb + 900, back + 4), scroll)
      add(new THREE.CylinderGeometry(9, 9, 470, 16).rotateZ(Math.PI / 2).translate(sx, sb, back + 12), M({ color: 0x2a2018, roughness: 0.5, emissive: 0x2a2018, emissiveIntensity: 0.2 })) // the roller
      for (const d of [-1, 1]) add(new THREE.CylinderGeometry(13, 13, 28, 16).rotateZ(Math.PI / 2).translate(sx + d * 249, sb, back + 12), M({ color: 0x1a120c, roughness: 0.3, emissive: 0x1a120c, emissiveIntensity: 0.3 })) // its knobs
    },
    update() {},
    dispose() { for (const o of own) o.dispose(); own.length = 0 },
  }
}
