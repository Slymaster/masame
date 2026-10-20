// Jardin de bambous: a weathered cedar engawa facing a bamboo garden. The sun reaches the board through two layers of
// slender bamboo leaves and a few stems (komorebi, the key's cookie), dust motes drift in the light, two or three fallen
// leaves lie on the planks by the frame's edges, and green culms stand between the veranda and the blurred garden.
import * as THREE from 'three'
import type { Scene } from '.'
import { blurCanvas, cookie, particles } from '../fx'
import { BT } from '../logic'

/** The leaf canopy's character (variants A/B/C were rendered from these). */
export interface Canopy {
  /** Leaf fans on the near (sharp) and far (soft) layers. */
  near: number; far: number
  /** Leaf length scale (1 = 110–200 mm on the board). */
  scale: number
  /** Light left in a leaf's shadow (cookie value, linear): the readability floor. */
  floor: number
  /** Sway (cookie px at 512) and the slowest/fastest sway periods (s). */
  sway: number; tMin: number; tMax: number
  /** Stems' shadows across the light. */
  stems: number
}
// variant B of the grid (denser shade, brighter sun patches); floor 0.24 darkens the board by 22–23 % at most (measured)
export const CANOPY: Canopy = { near: 110, far: 60, scale: 0.7, floor: 0.24, sway: 5, tMin: 6, tMax: 10, stems: 2 }

const S = 512 // cookie size: it spans the shoji spot's 3200 mm at the board, 6.25 mm a pixel

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

/** A bamboo leaf, pointing +x: slender, lanceolate, its tip drawn out. */
function leafPath(x: CanvasRenderingContext2D, L: number, W: number) {
  x.beginPath(); x.moveTo(0, 0)
  x.bezierCurveTo(L * 0.2, -W * 0.55, L * 0.55, -W * 0.5, L, 0)
  x.bezierCurveTo(L * 0.55, W * 0.5, L * 0.2, W * 0.55, 0, 0)
  x.fill()
}

/** Rare, soft gusts (0..1): a few seconds every two minutes or so, two incommensurate periods so they never feel scheduled. */
export const gust = (t: number) => Math.max(0, Math.sin(t * 0.057)) ** 24 + 0.6 * Math.max(0, Math.sin(t * 0.037 + 2.1)) ** 24

/** The komorebi painter: white = full sun; leaves and stems take the light down to `floor`, never below (min blending). */
export function canopy(c: Canopy = CANOPY) {
  const r = rng(7), g = Math.round(255 * c.floor), ink = `rgb(${g},${g},${g})`
  const sprite = (w: number, h: number, blur: number, draw: (x: CanvasRenderingContext2D) => void) => {
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: h }), x = cv.getContext('2d')!
    x.fillStyle = ink; draw(x); return blurCanvas(cv, blur) // blurred by hand: WebKit ignores ctx.filter
  }
  // a near leaf (6 mm penumbra: the cookie's own texels) and a far fan, blurred by the sun's disc from higher up
  const leaf = sprite(32, 8, 0.5, x => { x.translate(2, 4); leafPath(x, 27 * c.scale, 4 * c.scale) })
  const fan = sprite(64, 64, 0, x => { // each leaf blurred on its own, then laid over the others (as ctx.filter drew them)
    for (let k = 0; k < 6; k++) { const a = -1.1 + k * 0.45 + r() * 0.2, L = (20 + 8 * r()) * c.scale; x.drawImage(sprite(64, 64, 3, y => { y.translate(32, 32); y.rotate(a); leafPath(y, L, 5 * c.scale) }), 0, 0) }
  })
  // fans of 3–6 leaves at a twig's tip, spread over the visible ground (the board in the middle), each twig its own sway
  type Twig = { x: number; y: number; a: number; T: number; ph: number; amp: number; leaves: [number, number][] }
  const twigs = (n: number, far: boolean): Twig[] => Array.from({ length: n }, () => {
    const d = Math.sqrt(r()) * S * (far ? 0.3 : 0.24), a = r() * Math.PI * 2 // the seated view sees ±0.2 S
    return {
      x: S / 2 + Math.cos(a) * d, y: S / 2 + Math.sin(a) * d, a: r() * Math.PI * 2, T: c.tMin + r() * (c.tMax - c.tMin), ph: r() * 6.283,
      amp: c.sway * (far ? 0.6 : 0.8 + 0.4 * r()),
      leaves: Array.from({ length: 3 + Math.floor(r() * 4) }, (_, k) => [(k - 1.5) * 0.42 + (r() - 0.5) * 0.3, 0.75 + 0.5 * r()] as [number, number]),
    }
  })
  const nearT = twigs(c.near, false), farT = twigs(c.far, true)
  const stems = Array.from({ length: c.stems }, () => ({ u: S * (0.3 + 0.4 * r()), a: (r() - 0.5) * 0.5, w: 7 + 4 * r(), T: 9 + 3 * r(), ph: r() * 6.283 }))
  // culms far above: long soft bars (2 px penumbra), each pre-blurred once across its width
  const bars = stems.map(s => sprite(Math.ceil(s.w) + 16, 2 * S, 0, x => x.fillRect((Math.ceil(s.w) + 16 - s.w) / 2, 0, s.w, 2 * S)))
  bars.forEach(b => blurCanvas(b, 2, 3, 'x'))
  return (x: CanvasRenderingContext2D, t: number) => {
    x.globalCompositeOperation = 'source-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, S, S)
    x.globalCompositeOperation = 'darken'
    const G = gust(t)
    const at = (w: Twig) => { // a twig's slow pendulum, livelier in a gust (with a quick flutter on top)
      const s = Math.sin(t * 6.283 / w.T + w.ph) * (1 + 1.5 * G) + G * 0.25 * Math.sin(t * 4.1 + w.ph * 3)
      return [w.x + Math.cos(w.a + 1.57) * w.amp * s, w.y + Math.sin(w.a + 1.57) * w.amp * s, w.a + 0.06 * s] as const
    }
    for (const w of farT) { const [px, py, a] = at(w); x.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), px, py); x.drawImage(fan, -32, -32) }
    stems.forEach((s, i) => { // barely moving
      const a = s.a + 0.01 * Math.sin(t * 6.283 / s.T + s.ph)
      x.setTransform(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), s.u, S / 2); x.drawImage(bars[i], -bars[i].width / 2, -S)
    })
    for (const w of nearT) {
      const [px, py, a] = at(w)
      for (const [da, k] of w.leaves) { const b = a + da; x.setTransform(Math.cos(b) * k, Math.sin(b) * k, -Math.sin(b) * k, Math.cos(b) * k, px, py); x.drawImage(leaf, -2, -4) }
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'
  }
}

/* ---------- the engawa: weathered cedar planks running across the view ---------- */
const PLANK = 120, TILE: [number, number] = [1600, 960] // mm; the tile holds 8 planks, one butt joint each
let planks: [HTMLCanvasElement, HTMLCanvasElement] | null = null
/** The planks' colour and bump canvases, drawn once per session (a ~350 ms pixel loop) and shared by every scene that lays
 *  them (bambous, hanami, pluie, nuages): wrap them in your own textures, tint through the material, never draw on them. */
export const engawa = () => (planks ??= drawEngawa())
function drawEngawa(): [HTMLCanvasElement, HTMLCanvasElement] {
  const PX = 1.28, w = Math.round(TILE[0] * PX), h = Math.round(TILE[1] * PX), ph = PLANK * PX, n = Math.round(TILE[1] / PLANK)
  const col = Object.assign(document.createElement('canvas'), { width: w, height: h }), bump = Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ci = new ImageData(w, h), bi = new ImageData(w, h), r = rng(31)
  const P = Array.from({ length: n }, () => ({
    tone: 0.86 + 0.22 * r(), silver: 0.35 + 0.4 * r(), joint: r() * w, f: [r() * 0.004, r() * 0.011, 0.02 + r() * 0.02], ph: [r() * 9, r() * 9, r() * 9], rings: 0.12 + 0.12 * r(), k: r() * 50,
  }))
  const hash = (i: number) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s) }
  const vn = (u: number) => { const i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f); return hash(i) * (1 - s) + hash(i + 1) * s }
  for (let y = 0; y < h; y++) {
    const p = Math.min(n - 1, Math.floor(y / ph)), q = P[p], v = (y - p * ph) / ph
    for (let x = 0; x < w; x++) {
      const wob = 1.2 * Math.sin(x * q.f[0] * 0.5 + q.ph[0]) + 0.5 * Math.sin(x * q.f[1] * 0.5 + q.ph[1]) + 7 * vn(x * 0.0016 + p * 7.3)
      const gy = (y + wob) * q.rings + q.k + 0.6 * vn(x * 0.004 + y * 0.3), ring = gy - Math.floor(gy), late = 0.8 * Math.pow(1 - Math.abs(ring * 2 - 1), 10) // latewood lines
      const mot = vn(x * 0.004 + p * 13.7) * 0.6 + vn(x * 0.02 + y * 0.01 + p * 5) * 0.4 // weathering, along the grain
      const edge = Math.min(v, 1 - v) * ph, gap = edge < 1.1 ? 0.35 : edge < 2.2 ? 0.75 : 1, dj = Math.abs(((x - q.joint + w * 1.5) % w) - w / 2) // gap to the next plank
      const joint = dj < 1.3 ? 0.35 : 1
      const sil = q.silver * (0.7 + 0.6 * mot) // cedar silvers as it weathers; the latewood keeps some red-brown
      const R = (160 - 42 * late) * (1 - sil) + (148 - 30 * late) * sil, G = (124 - 36 * late) * (1 - sil) + (141 - 30 * late) * sil, B = (84 - 28 * late) * (1 - sil) + (126 - 26 * late) * sil
      const k = q.tone * gap * joint * (0.9 + 0.12 * mot), o = (y * w + x) * 4
      ci.data[o] = Math.min(255, R * k); ci.data[o + 1] = Math.min(255, G * k); ci.data[o + 2] = Math.min(255, B * k); ci.data[o + 3] = 255
      const hb = Math.max(0, Math.min(255, 150 + 70 * late - 25 * mot - (1 - gap * joint) * 200)) // raised latewood, sunk joints
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = hb; bi.data[o + 3] = 255
    }
  }
  col.getContext('2d')!.putImageData(ci, 0, 0); bump.getContext('2d')!.putImageData(bi, 0, 0)
  return [col, bump]
}

/* ---------- culms between the veranda and the garden (seen when the eyes rise) ---------- */
function culmMap() {
  const cv = Object.assign(document.createElement('canvas'), { width: 64, height: 256 }), x = cv.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 0, 256) // one internode: greener in the middle, a pale waxy band under the node
  g.addColorStop(0, '#6f8a3a'); g.addColorStop(0.08, '#b8c08e'); g.addColorStop(0.16, '#7a9640'); g.addColorStop(0.9, '#6a8636'); g.addColorStop(0.97, '#4f6a2a'); g.addColorStop(1, '#3d5222')
  x.fillStyle = g; x.fillRect(0, 0, 64, 256)
  const r = rng(5); x.globalAlpha = 0.12
  for (let i = 0; i < 40; i++) { x.fillStyle = r() < 0.5 ? '#2f4318' : '#c9cf9a'; x.fillRect(r() * 64, 0, 1 + r() * 2, 256) } // fine streaks
  return cv
}

export function make(c: Canopy = CANOPY) {
  return (): Scene => {
    const own: { dispose(): void }[] = []
    let komorebi: ReturnType<typeof cookie> | null = null, dust: ReturnType<typeof particles> | null = null
    let culmU: { uT: { value: number } } | null = null
    return {
      animated: true,
      build(ctx) {
        const { BW, BD } = ctx.board, aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
        // the light through the leaves; still at fx 1 (update() only runs while animated)
        komorebi = cookie(canopy(c), S, 15); ctx.setCookie(komorebi.texture)
        // the veranda's planks, running across the view
        const [cm, bm] = engawa(), tile = (cv: HTMLCanvasElement, srgb: boolean) => {
          const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3200 / TILE[0], 3200 / TILE[1])
          t.offset.set(0.37, 0.5 - ((0.5 * 3200 / TILE[1]) % 1) + PLANK / TILE[1] / 2) // a joint between planks under the board's centre
          t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
        }
        ctx.setGround({ map: tile(cm, true), bumpMap: tile(bm, false), roughness: 0.86, tint: 1 })
        // motes glinting in the light over the board (none at fx 1); gone 30 mm above the wood
        if (ctx.fx === 2) { dust = particles({ ...PARTICLES_DUST }, [-520, 40, -520, 520, 460, 380], 70, 70, 3); ctx.root.add(dust.mesh); own.push(dust) }
        // fallen leaves on the planks, near the frame's edges, never on the board nor the bowls
        const lc = Object.assign(document.createElement('canvas'), { width: 128, height: 32 }), lx = lc.getContext('2d')!
        const lg = lx.createLinearGradient(0, 0, 128, 0); lg.addColorStop(0, '#6e5530'); lg.addColorStop(0.5, '#8f7744'); lg.addColorStop(1, '#857a48')
        lx.fillStyle = lg; lx.translate(2, 16); leafPath(lx, 124, 22); lx.strokeStyle = 'rgba(90,64,30,0.5)'; lx.lineWidth = 1; lx.beginPath(); lx.moveTo(0, 0); lx.lineTo(118, 0); lx.stroke()
        const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace; lt.anisotropy = aniso
        const lm = new THREE.MeshStandardMaterial({ map: lt, alphaTest: 0.5, roughness: 0.75, side: THREE.DoubleSide })
        const lgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0)
        const fallen: [number, number, number, number][] = [[-BW / 2 - 70, BD / 2 + 75, 0.5, 150], [BW / 2 + 95, -BD / 2 - 55, 2.6, 135], [BW / 2 - 40, BD / 2 + 110, -0.3, 120]]
        const leaves = new THREE.InstancedMesh(lgeo, lm, fallen.length), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion()
        fallen.forEach(([x, z, a, L], i) => leaves.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -BT + 0.4, z), qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(L, 1, L * 0.17))))
        leaves.receiveShadow = true; ctx.root.add(leaves); own.push(leaves, lt, lm, lgeo) // the instanced mesh frees its own instance buffers
        // green culms past the veranda's edge, in the camera's reach (its far plane is ~2.5 m behind the board)
        const ct = new THREE.CanvasTexture(culmMap()); ct.colorSpace = THREE.SRGBColorSpace; ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.repeat.set(1, 20)
        const cmat = new THREE.MeshStandardMaterial({ map: ct, roughness: 0.45, metalness: 0, transparent: true })
        culmU = { uT: { value: 0 } }
        cmat.onBeforeCompile = sh => { // a slow lean with the wind, more at the top
          Object.assign(sh.uniforms, culmU)
          sh.vertexShader = 'uniform float uT;\nvarying float vHk;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            float hk = position.y + 0.5; vHk = hk; float id = float(gl_InstanceID), rad = length(instanceMatrix[0].xyz);
            transformed.x += (14.0 * sin(uT * 0.8 + id * 1.7) + 6.0 * sin(uT * 1.9 + id)) * hk * hk / rad;`)
            .replace('#include <uv_vertex>', '#include <uv_vertex>\n vMapUv.y += fract(float(gl_InstanceID) * 0.37);') // nodes at each culm's own heights
          // the foot rises out of the garden's haze: no hard end hovering past the veranda's faded edge
          sh.fragmentShader = 'varying float vHk;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n diffuseColor.a *= smoothstep(0.0, 0.11, vHk);')
        }
        cmat.customProgramCacheKey = () => 'bambous-culm'
        const cgeo = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true)
        const r = rng(11), culms: [number, number, number][] = []
        for (let i = 0; culms.length < 40 && i < 400; i++) {
          const x = (r() - 0.5) * 5200, z = -1750 - r() * 450
          if (Math.hypot(x, z - 1200) < 3300 && culms.every(([cx, cz]) => Math.hypot(cx - x, cz - z) > 150)) culms.push([x, z, 28 + r() * 22])
        }
        const cm2 = new THREE.InstancedMesh(cgeo, cmat, culms.length), col = new THREE.Color()
        culms.forEach(([x, z, rad], i) => {
          cm2.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -700 + 3000, z), qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), new THREE.Vector3(rad, 6000, rad)))
          const far = (-z - 1750) / 450 // the farther, the paler (air between)
          cm2.setColorAt(i, col.setRGB(1, 1, 1).lerp(new THREE.Color(0.86, 0.92, 0.8), far).multiplyScalar(0.78 + 0.3 * ((i * 0.618) % 1)))
        })
        cm2.renderOrder = -2 // before the table, which blends its faded edge over them
        ctx.root.add(cm2); own.push(cm2, ct, cmat, cgeo)
      },
      update(_dt, t) { komorebi?.update(t); dust?.update(t); if (culmU) culmU.uT.value = t },
      dispose() { komorebi?.dispose(); for (const o of own) o.dispose() },
    }
  }
}

/** Motes: few, fine, warm, slow; they only catch the eye where the sun is. */
const PARTICLES_DUST = { fall: 2, drift: [3, 1] as [number, number], sway: 9, size: 1.1, stretch: 0, grow: 0, spin: 0, shape: 'disc' as const, color: 0xfff3dc, opacity: 0.55 }

export default make()
