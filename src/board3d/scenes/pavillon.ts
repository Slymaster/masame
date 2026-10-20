// Pavillon du lettré: the board on a waxed huanghuali table in an open pavilion by a garden pond. A few of the scholar's
// things lie at the frame's edges, never over the board: an inkstone with its ink stick, a mountain-shaped brush rest
// with a brush across it, a brush pot, and a small bronze censer whose thread of incense smoke rises slowly. When the
// eyes rise, the pavilion's lacquered columns and low rail frame the blurred garden (the Look's backdrop).
import * as THREE from 'three'
import type { Scene } from '.'
import { particles, PARTICLES, skyDome, type ParticleLook } from '../fx'
import { BT } from '../logic'

const TILE: [number, number] = [1600, 800] // mm: the table's figure repeats every 1.6 m along the grain, 0.8 m across

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const canvas = (w: number, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h })

/**
 * Huanghuali: amber honey to reddish brown, fine growth lines running along the board, a few "ghost faces"
 * (the swirling figure around knots the wood is prized for) and fine pores. Canvas strokes, wrapped so it tiles; the
 * waxed sheen is the material's (low roughness), not drawn. ~40 ms on this Mac.
 */
/** The table's wood (variants A/B/C of the grid were rendered from these). */
export interface Wood { tones: string[]; rough: number }
// an older, deeper huanghuali (amber to reddish brown): the golden one matched the kaya, the board's lit far edge read 0.99–1.09×
// the table's luminance; now 1.41–1.74× (seated view, every hour)
export const WOOD: Wood = { tones: ['#93633a', '#9e6d40', '#885a33', '#99693d', '#8e5f37', '#a06f42', '#93633a'], rough: 0.55 }

export function huanghuali(w: Wood = WOOD, seed = 9, S = 2048) {
  const W = S, H = S / 2, k = W / TILE[0], r = rng(seed), cv = canvas(W, H), x = cv.getContext('2d')!
  // broad bands of colour across the grain (whole tile height, so it wraps)
  const g = x.createLinearGradient(0, 0, 0, H)
  w.tones.forEach((c, i) => g.addColorStop(i / (w.tones.length - 1), c))
  x.fillStyle = g; x.fillRect(0, 0, W, H)
  // ghost faces: centres the growth lines swirl around
  const faces = Array.from({ length: 5 }, () => ({ cx: r() * W, cy: r() * H, sx: (60 + 90 * r()) * k, sy: (18 + 22 * r()) * k, a: (14 + 18 * r()) * k * (r() < 0.5 ? -1 : 1) }))
  const per = (d: number, L: number) => d - L * Math.round(d / L)
  const lineY = (y0: number, xx: number, p: number[], f: number[]) => {
    let y = y0 + p[0] * Math.sin((6.2832 * f[0] * xx) / W + p[1]) + p[2] * Math.sin((6.2832 * f[1] * xx) / W + p[3])
    for (const fc of faces) { const dx = per(xx - fc.cx, W) / fc.sx, dy = per(y0 - fc.cy, H) / (fc.sy * 3); y += fc.a * Math.exp(-dx * dx - dy * dy) }
    return y
  }
  x.lineCap = 'round'
  const lines = 900
  for (let i = 0; i < lines; i++) {
    const y0 = (i / lines) * H + r() * 2, f = [1 + Math.floor(r() * 2), 2 + Math.floor(r() * 3)], p = [(6 + 10 * r()) * k, r() * 6.28, (2 + 4 * r()) * k, r() * 6.28]
    const dark = r() < 0.12 // the darker latewood lines; the rest a faint figure between them
    x.strokeStyle = dark ? `rgba(92,54,26,${0.18 + 0.16 * r()})` : `rgba(112,72,38,${0.05 + 0.06 * r()})`
    x.lineWidth = dark ? (0.6 + 0.9 * r()) * k : (0.4 + 0.6 * r()) * k
    for (const oy of [-H, 0, H]) {
      x.beginPath()
      for (let xx = -16; xx <= W + 16; xx += 8) { const y = lineY(y0, xx, p, f) + oy; if (xx > -16) x.lineTo(xx, y); else x.moveTo(xx, y) }
      x.stroke()
    }
  }
  // a soft glow in the figure (the wood's depth under the wax): lighter clouds
  for (let n = 0; n < 40; n++) {
    const cx = r() * W, cy = r() * H, rx = (80 + 200 * r()) * k
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      const rg = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rx)
      rg.addColorStop(0, `rgba(214,172,112,${0.05 + 0.05 * r()})`); rg.addColorStop(1, 'rgba(214,172,112,0)')
      x.fillStyle = rg; x.fillRect(cx + ox - rx, cy + oy - rx, 2 * rx, 2 * rx)
    }
  }
  // fine pores along the grain
  x.fillStyle = 'rgba(70,42,20,0.2)'
  for (let n = 0; n < 9000; n++) { const px = r() * (W - 6 * k), py = r() * H; x.fillRect(px, py, (1.5 + 3 * r()) * k, 0.45 * k) }
  return cv
}

/* ---------- the scholar's things ---------- */
const mat = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o)

/** A rounded slab (mm): w along x, d along z, h tall, its bottom at y = 0. */
function slab(w: number, d: number, h: number, rad: number, bevel = 2) {
  const s = new THREE.Shape(), a = w / 2 - rad, b = d / 2 - rad
  s.moveTo(-a, -d / 2); s.lineTo(a, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -b); s.lineTo(w / 2, b); s.quadraticCurveTo(w / 2, d / 2, a, d / 2)
  s.lineTo(-a, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, b); s.lineTo(-w / 2, -b); s.quadraticCurveTo(-w / 2, -d / 2, -a, -d / 2)
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 6 })
  return g.rotateX(-Math.PI / 2).translate(0, bevel, 0)
}

type Own = { dispose(): void }[]
const mesh = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, own: Own, shadow = true) => {
  const o = new THREE.Mesh(geo, m); o.castShadow = shadow; o.receiveShadow = true; g.add(o); own.push(geo); return o
}

/** A brush: bamboo shaft along +x from the origin, a dark horn ferrule, the hair tapering to a point. */
function brush(len: number, own: Own) {
  const g = new THREE.Group(), ms = [mat({ color: 0xcdb27e, roughness: 0.42, clearcoat: 0.3 }), mat({ color: 0x24170f, roughness: 0.3, clearcoat: 0.4 }), mat({ color: 0x17110c, roughness: 0.85, sheen: 0.6, sheenColor: 0x5a4632 })]
  own.push(...ms)
  mesh(g, new THREE.CylinderGeometry(3.6, 4, len, 16).rotateZ(Math.PI / 2).translate(len / 2, 0, 0), ms[0], own)
  mesh(g, new THREE.CylinderGeometry(4.4, 4, 12, 16).rotateZ(Math.PI / 2).translate(len + 6, 0, 0), ms[1], own)
  mesh(g, new THREE.LatheGeometry([[0, 0], [4.2, 1], [4.8, 7], [3.8, 16], [1.8, 25], [0, 30]].map(([a, b]) => new THREE.Vector2(a, b)), 16).rotateZ(-Math.PI / 2).translate(len + 12, 0, 0), ms[2], own)
  return g
}

/** The things on the table, each with its bottom at y = 0. */
function things(own: Own) {
  // the inkstone: a dark plum-grey slab with a raised rim, its well still wet with ink, an ink stick resting on the grinding face
  const ink = new THREE.Group(), stoneM = mat({ color: 0x3e3236, roughness: 0.55, clearcoat: 0.15 }), wetM = mat({ color: 0x060506, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.12 })
  const faceM = mat({ color: 0x2a2124, roughness: 0.35, clearcoat: 0.3 }), stickM = mat({ color: 0x100d0d, roughness: 0.55 })
  own.push(stoneM, wetM, faceM, stickM)
  mesh(ink, slab(86, 132, 20, 12), stoneM, own)
  mesh(ink, slab(70, 112, 2, 9, 0.8).translate(0, 18.6, 0), faceM, own, false) // the sunk grinding face
  mesh(ink, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2).scale(26, 1, 15).translate(0, 20.8, -40), wetM, own, false) // the well
  mesh(ink, slab(16, 62, 9, 3, 1.5).rotateY(-0.3).translate(8, 20.6, 16), stickM, own)
  // the brush rest: a little mountain range in celadon, a brush laid across two of its valleys
  const rest = new THREE.Group(), cel = mat({ color: 0xa3b8a4, roughness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.12 })
  own.push(cel)
  const peaks = new THREE.Shape(), P: [number, number][] = [[-50, 0], [-50, 8], [-40, 20], [-30, 14], [-17, 32], [-5, 17], [6, 38], [19, 18], [30, 27], [42, 12], [50, 8], [50, 0]]
  peaks.moveTo(...P[0]); for (let i = 1; i < P.length; i++) { const [px, py] = P[i], [qx] = P[i - 1]; peaks.quadraticCurveTo(qx + (px - qx) * 0.2, py, px, py) }
  mesh(rest, new THREE.ExtrudeGeometry(peaks, { depth: 12, bevelEnabled: true, bevelSize: 2.5, bevelThickness: 2.5, bevelSegments: 3, curveSegments: 8 }).translate(0, 0, -6), cel, own)
  // the censer: a small bronze tripod with upright ears, an incense stick standing in its ash, its tip glowing
  const cen = new THREE.Group(), bronze = mat({ color: 0x5f4a33, metalness: 1, roughness: 0.48 }), ash = mat({ color: 0x57524d, roughness: 0.95 })
  const stickI = mat({ color: 0x4a2418, roughness: 0.8 }), ember = new THREE.MeshBasicMaterial({ color: 0xff8a3a })
  own.push(bronze, ash, stickI, ember)
  mesh(cen, new THREE.LatheGeometry([[0, 10], [20, 10], [31, 18], [34, 30], [32, 40], [35, 43], [33, 45], [29, 42], [28, 33], [0, 33]].map(([a, c]) => new THREE.Vector2(a, c)), 48), bronze, own)
  for (let i = 0; i < 3; i++) { const a = (i * Math.PI * 2) / 3 + 0.5; mesh(cen, new THREE.CylinderGeometry(3.2, 2, 14, 10).translate(Math.cos(a) * 20, 7, Math.sin(a) * 20), bronze, own) }
  for (const s of [-1, 1]) mesh(cen, new THREE.TorusGeometry(7, 2, 8, 20, Math.PI).translate(0, 44, 0).rotateY(Math.PI / 2).translate(s * 30, 0, 0), bronze, own) // the ears, upright on the rim
  mesh(cen, new THREE.CircleGeometry(28, 32).rotateX(-Math.PI / 2).translate(0, 33, 0), ash, own).receiveShadow = false // no acne from the bowl's rim
  mesh(cen, new THREE.CylinderGeometry(0.8, 0.8, 70, 6).translate(3, 73, -2), stickI, own)
  mesh(cen, new THREE.SphereGeometry(1.2, 8, 6).translate(3, 108.4, -2), ember, own, false)
  return { ink, rest, cen, brush: brush(165, own), tip: new THREE.Vector3(3, 109, -2) }
}

/* ---------- the pavilion's opening, seen when the eyes rise ---------- */
/** The garden behind the pavilion: backdrop_2k.jpg (chinese_garden, pre-blurred), turned so the pond faces the board. */
const GARDEN = /* glsl */`
uniform sampler2D uMap; uniform float uRot, uGain;
vec3 sky(vec3 d) {
  float a = atan(d.z, d.x) + uRot;
  return texture2D(uMap, vec2(fract(a / 6.28318 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5)).rgb * uGain;
}`
/** Two lacquered columns either side of the view and the low rail between them, beyond the table's faded edge. */
function pavilion(own: Own) {
  const g = new THREE.Group(), lac = mat({ color: 0x6e2619, roughness: 0.32, clearcoat: 0.7 }), wood = mat({ color: 0x2e1c12, roughness: 0.5 })
  own.push(lac, wood)
  // past the table's far edge (the table is 3.2 m: its edge at 1.6 m), standing on the pavilion's floor below it
  for (const x of [-780, 780]) mesh(g, new THREE.CylinderGeometry(80, 84, 3000, 32).translate(x, -BT - 300 + 1500, -1780), lac, own, false)
  mesh(g, new THREE.BoxGeometry(1560, 24, 40).translate(0, 8, -1800), lac, own, false) // the bench's back rail
  for (let i = -3; i <= 3; i++) mesh(g, new THREE.BoxGeometry(18, 400, 18).translate(i * 230, -180, -1800), wood, own, false)
  return g
}

/** The incense: a thin thread rising slowly, widening and fading as it goes. */
const SMOKE: ParticleLook = { ...PARTICLES.smoke, fall: -12, drift: [1.5, -0.8], sway: 3, size: 4, grow: 6, spin: 0.2, opacity: 0.035 }

export const make = (w: Wood = WOOD) => (): Scene => {
  const own: Own = []
  let smoke: ReturnType<typeof particles> | null = null
  return {
    animated: true,
    async build(ctx) {
      const { BW, BD } = ctx.board, aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
      const sky = await new THREE.TextureLoader().loadAsync(`${ctx.base}pavillon/backdrop_2k.jpg`)
      sky.colorSpace = THREE.SRGBColorSpace; sky.generateMipmaps = false; sky.minFilter = THREE.LinearFilter // pre-blurred; no mip seam at the wrap
      const garden = skyDome(GARDEN, { uMap: { value: sky }, uRot: { value: 1.885 }, uGain: { value: 2.5 } })
      ctx.root.add(garden.mesh); own.push(garden, sky)
      const t = new THREE.CanvasTexture(huanghuali(w))
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3200 / TILE[0], 3200 / TILE[1]); t.anisotropy = aniso; t.colorSpace = THREE.SRGBColorSpace
      ctx.setGround({ map: t, roughness: w.rough, tint: 1 })
      // at the frame's edges, clear of the board and the bowls: the inkstone and the brush rest near the left corner,
      // the censer by the far right corner (its smoke rises away from the board as the camera sees it)
      const th = things(own), y = -BT
      th.ink.position.set(-BW / 2 - 135, y, BD / 2 + 30); th.ink.rotation.y = 0.18
      // the rest runs along the board's edge; the brush lies across it, its hair in a valley (local x = -5, 17 mm up), its end on the table
      th.rest.position.set(-BW / 2 - 50, y, BD / 2 - 75); th.rest.rotation.y = Math.PI / 2
      th.brush.position.set(-BW / 2 - 50 - 172, y + 4, BD / 2 - 70); th.brush.rotation.z = Math.atan2(17, 172)
      th.cen.position.set(BW / 2 + 120, y, -BD / 2 + 55)
      for (const o of [th.ink, th.rest, th.brush, th.cen, pavilion(own)]) ctx.root.add(o)
      if (ctx.fx === 2) { // the smoke thread, from the stick's glowing tip
        th.cen.updateMatrixWorld()
        const p = th.tip.clone().applyMatrix4(th.cen.matrixWorld)
        smoke = particles(SMOKE, [p.x - 1.5, p.y, p.z - 1.5, p.x + 1.5, p.y + 300, p.z + 1.5], 800, p.y - 60, 4)
        ctx.root.add(smoke.mesh); own.push(smoke)
      }
    },
    update(_dt, t) { smoke?.update(t) },
    dispose() { for (const o of own) o.dispose(); own.length = 0; smoke = null },
  }
}

export default make()
