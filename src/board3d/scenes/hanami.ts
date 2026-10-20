// Hanami: a veranda under cherry blossom. The light falls through blossoming branches (round clusters, thin dark
// twigs, swaying very slowly: the key's cookie), a few pale petals drift and turn in the garden and beside the board
// (never over it), a handful rest on the planks by the frame's edges, and cherry trees stand before the blurred spring park.
import * as THREE from 'three'
import type { Scene } from '.'
import { cookie, particles, PARTICLES, skyDome, type ParticleLook } from '../fx'
import { BT } from '../logic'
import { engawa } from './bambous'

/** The blossom canopy's character (variants A/B/C were rendered from these). */
export interface Bloom {
  /** Blossom clusters on the twigs' tips. */
  clusters: number
  /** Light left under a cluster and under a branch (cookie value, linear): the readability floor. */
  floor: number; branchFloor: number
  /** Sway (cookie px at 512) and the slowest/fastest sway periods (s). */
  sway: number; tMin: number; tMax: number
  /** 0 = soft round clusters, 1 = each flower's disc distinct. */
  crisp: number
  /** The park backdrop's turn (rad): where its low pink sun glows behind the trees. */
  parkRot: number
}
// measured (cookie vs open window, 99th percentile over the free intersections, worst of five moments): 18–21 % (cap 25 %)
export const BLOOM: Bloom = { clusters: 170, floor: 0.46, branchFloor: 0.4, sway: 2.5, tMin: 14, tMax: 22, crisp: 1, parkRot: 1.9 }

const S = 512 // the cookie spans the shoji spot's 3200 mm across the light (6.25 mm a pixel; ~10 mm on the board, seen obliquely)
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const canvas = (w: number, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h })
const grey = (v: number, a = 1) => { const c = Math.round(255 * v); return `rgba(${c},${c},${c},${a})` }

/** A soft blossom cluster: a dozen overlapping round flowers, soft by construction (radial gradients, no canvas filter). */
function clusterSprite(v: number, crisp: number, r: () => number) {
  const cv = canvas(32), x = cv.getContext('2d')!
  for (let i = 0; i < 9; i++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * 8, cx = 16 + Math.cos(a) * d, cy = 16 + Math.sin(a) * d * 0.8, rad = 3.5 + r() * 3.5
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad)
    const al = 0.5 + 0.35 * crisp
    g.addColorStop(0, grey(v, al)); g.addColorStop(0.55 + 0.35 * crisp, grey(v, al * (0.7 + 0.25 * crisp))); g.addColorStop(1, grey(v, 0))
    x.fillStyle = g; x.fillRect(cx - rad, cy - rad, 2 * rad, 2 * rad)
  }
  return cv
}

type Twig = { x: number; y: number; T: number; ph: number; amp: number; k: number; spr: number }
/** The blossom light's painter: white = full sun; clusters and branches take it down to their floors, never below (min blending). */
export function blossoms(c: Bloom = BLOOM) {
  const r = rng(17)
  // the branches, drawn once at a quarter of the size with round caps, then scaled up: a soft edge without a canvas filter
  const Q = S / 4, br = canvas(Q), bx = br.getContext('2d')!, tips: [number, number][] = []
  bx.strokeStyle = grey(c.branchFloor); bx.lineCap = 'round'
  const limb = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len
    bx.lineWidth = w; bx.beginPath(); bx.moveTo(x, y); bx.quadraticCurveTo((x + x1) / 2 + (r() - 0.5) * len * 0.3, (y + y1) / 2 + (r() - 0.5) * len * 0.3, x1, y1); bx.stroke()
    if (depth <= 3) for (const f of [0.33, 0.66, 1]) tips.push([(x + (x1 - x) * f) * 4, (y + (y1 - y) * f) * 4]) // blossoms crowd the young twigs
    if (depth === 0) return
    for (let k = 0, n = depth > 3 ? 1 + Math.floor(r() * 2) : 2; k < n; k++) limb(x1, y1, a + (r() - 0.5) * 1.4, len * (0.62 + 0.2 * r()), w * 0.66, depth - 1)
  }
  // limbs reaching in from beyond the frame (the trees stand beside the veranda) across the seated view's ±0.2 of the cookie
  limb(-4, Q * 0.42, 0.18, Q * 0.22, 2.6, 5); limb(Q + 4, Q * 0.6, 3.25, Q * 0.2, 2.2, 5); limb(Q * 0.3, Q + 4, -1.2, Q * 0.18, 1.8, 4)
  // clusters on the tips first, the rest scattered round them; each its own slow pendulum
  const sprites = [0, 1, 2].map(() => clusterSprite(c.floor, c.crisp, r))
  // clumps of 2–5 clusters on short spurs, around the board (the cookie's centre; a low sun stretches it along its bearing), sun between
  const twigs: Twig[] = [], clumps: [number, number][] = []
  for (let i = 0; i < 4000 && twigs.length < c.clusters; i++) {
    const ang = r() * 6.283, d = Math.sqrt(r()) * S * 0.24, x = S * 0.5 + Math.cos(ang) * d, y = S * 0.5 + Math.sin(ang) * d
    if (r() > 0.25 + 0.75 * (1 - Math.hypot(x - S * 0.46, y - S * 0.48) / (S * 0.3)) || clumps.some(([u, v]) => Math.hypot(u - x, v - y) < 22)) continue
    clumps.push([x, y])
    for (let k = 0, n = 2 + Math.floor(r() * 4); k < n; k++) {
      const a2 = r() * 6.283, d2 = 3 + r() * 7
      twigs.push({ x: x + Math.cos(a2) * d2, y: y + Math.sin(a2) * d2, T: c.tMin + r() * (c.tMax - c.tMin), ph: r() * 6.283, amp: c.sway * (0.6 + 0.8 * r()), k: (0.6 + 0.6 * r()) * 0.5, spr: (i + k) % 3 })
    }
  }
  bx.lineWidth = 0.7 // each clump on its spur, from the nearest branch
  for (const [x, y] of clumps) {
    let best = tips[0], bd = Infinity
    for (const p of tips) { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; best = p } }
    if (bd < S * 0.2) { bx.beginPath(); bx.moveTo(best[0] / 4, best[1] / 4); bx.quadraticCurveTo((best[0] + x) / 8 + 2, (best[1] + y) / 8 - 2, x / 4, y / 4); bx.stroke() }
  }
  return (x: CanvasRenderingContext2D, t: number) => {
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, S, S)
    x.globalCompositeOperation = 'darken'; x.imageSmoothingEnabled = true
    const bs = Math.sin(t * 6.283 / 19) * c.sway * 0.6 // the branches barely move; the blossoms a little more
    x.drawImage(br, bs, bs * 0.4, S, S)
    for (const w of twigs) {
      const s = Math.sin(t * 6.283 / w.T + w.ph) * w.amp
      x.setTransform(w.k, 0, 0, w.k, w.x + bs + s, w.y + bs * 0.4 + s * 0.5); x.drawImage(sprites[w.spr], -16, -16)
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'
  }
}

/** A cherry petal (pointing +y): an oval with the small notch at its tip, pale pink, a little deeper at the base. */
function petalMap() {
  const cv = canvas(64), x = cv.getContext('2d')!
  x.beginPath(); x.moveTo(32, 60)
  x.bezierCurveTo(8, 50, 6, 18, 24, 6); x.lineTo(32, 13); x.lineTo(40, 6); x.bezierCurveTo(58, 18, 56, 50, 32, 60); x.closePath()
  const g = x.createLinearGradient(0, 60, 0, 4); g.addColorStop(0, '#e9a9b6'); g.addColorStop(0.35, '#f6d3da'); g.addColorStop(1, '#fbe9ec')
  x.fillStyle = g; x.fill()
  return cv
}

/** A blossom cloud, seen from the veranda: many small flowers in a lumpy crown, paler where the light falls. */
function cloudMap(seed: number) {
  const N = 256, cv = canvas(N), x = cv.getContext('2d')!, r = rng(seed)
  const lobes = Array.from({ length: 7 }, () => [N / 2 + (r() - 0.5) * N * 0.45, N / 2 + (r() - 0.5) * N * 0.3, N * (0.16 + 0.1 * r())])
  for (let i = 0; i < 2600; i++) {
    const [lx, ly, lr] = lobes[i % lobes.length], a = r() * 6.283, d = Math.sqrt(r()) * lr, px = lx + Math.cos(a) * d, py = ly + Math.sin(a) * d
    const top = 1 - py / N, tone = 0.6 + 0.4 * top + 0.15 * (r() - 0.5) // lit from above, shaded under the crown
    const pr = 2 + r() * 3.5, g = x.createRadialGradient(px, py, 0, px, py, pr)
    const c = r() < 0.2 ? [244, 176, 194] : [255, 226, 232]
    g.addColorStop(0, `rgba(${c.map(v => Math.round(v * tone)).join(',')},0.95)`); g.addColorStop(1, `rgba(${c.map(v => Math.round(v * tone)).join(',')},0)`)
    x.fillStyle = g; x.fillRect(px - pr, py - pr, 2 * pr, 2 * pr)
  }
  return cv
}

// the park behind the trees: the 2K HDRI, pre-blurred (backdrop_2k.jpg), turned so its sun glows off to the side
const PARK = /* glsl */`
uniform sampler2D uMap; uniform float uRot, uGain;
vec3 sky(vec3 d) {
  float a = atan(d.z, d.x) + uRot;
  return texture2D(uMap, vec2(fract(a / 6.28318 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5)).rgb * uGain;
}`
/** Petals: few, pale, slow, turning. */
const PETALS: ParticleLook = { ...PARTICLES.petals, fall: 26, drift: [24, 9], sway: 46, size: 9, spin: 0.9, color: 0xf0bcc8, opacity: 0.85 }

const PLANK = 120, TILE: [number, number] = [1600, 960] // bambous' engawa tile (mm)

export function make(c: Bloom = BLOOM) {
  return (): Scene => {
    const own: { dispose(): void }[] = []
    let light: ReturnType<typeof cookie> | null = null, falling: ReturnType<typeof particles>[] = []
    return {
      animated: true,
      async build(ctx) {
        const { BW, BD } = ctx.board, aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
        const tex = await new THREE.TextureLoader().loadAsync(`${ctx.base}hanami/backdrop_2k.jpg`)
        tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter // pre-blurred, no mip seam at the wrap
        const park = skyDome(PARK, { uMap: { value: tex }, uRot: { value: c.parkRot }, uGain: { value: 1 } })
        ctx.root.add(park.mesh); own.push(park, tex)
        // the light through the blossoms (still at fx 1)
        light = cookie(blossoms(c), S, 15); ctx.setCookie(light.texture); own.push(light)
        // bambous' weathered cedar engawa
        const [cm, bm] = engawa(), tile = (cv: HTMLCanvasElement, srgb: boolean) => {
          const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3200 / TILE[0], 3200 / TILE[1])
          t.offset.set(0.37, 0.5 - ((0.5 * 3200 / TILE[1]) % 1) + PLANK / TILE[1] / 2)
          t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
        }
        ctx.setGround({ map: tile(cm, true), bumpMap: tile(bm, false), roughness: 0.86, tint: 1 })
        // petals: the garden beyond the veranda, and a few beside the board (never over it), gone above the planks
        if (ctx.fx === 2) {
          const side = BW / 2 + 160
          falling = [particles(PETALS, [-2400, -60, -2600, 2400, 1300, -600], 260, -60, 4),
            particles(PETALS, [-side - 380, 60, -520, -side, 620, 420], 14, 110, 5), particles(PETALS, [side, 60, -520, side + 380, 620, 420], 14, 110, 6)]
          for (const p of falling) { ctx.root.add(p.mesh); own.push(p) }
        }
        // petals resting on the planks near the frame's edges (never on the board nor the bowls)
        const pt = new THREE.CanvasTexture(petalMap()); pt.colorSpace = THREE.SRGBColorSpace; pt.anisotropy = aniso
        const pm = new THREE.MeshStandardMaterial({ map: pt, alphaTest: 0.5, roughness: 0.6, side: THREE.DoubleSide })
        const pgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
        const r = rng(23), rest: [number, number][] = []
        for (const [cx, cz, n] of [[-BW / 2 - 90, BD / 2 + 70, 5], [BW / 2 + 110, -BD / 2 - 60, 4], [BW / 2 - 60, BD / 2 + 120, 3], [-BW / 2 - 40, -BD / 2 - 90, 3]] as const)
          for (let i = 0; i < n; i++) rest.push([cx + (r() - 0.5) * 120, cz + (r() - 0.5) * 80])
        const petals = new THREE.InstancedMesh(pgeo, pm, rest.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
        rest.forEach(([x, z], i) => { const s = 10 + 4 * r(); petals.setMatrixAt(i, m4.compose(new THREE.Vector3(x, -BT + 0.5 + i * 0.01, z), q.setFromAxisAngle(up, r() * 6.283), new THREE.Vector3(s * 0.8, 1, s))) })
        petals.receiveShadow = true; ctx.root.add(petals); own.push(petals, pt, pm, pgeo)
        // cherry trees past the veranda, in the camera's reach when the eyes rise: dark trunks, limbs, soft pink crowns
        const bark = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.9 })
        const cyl = new THREE.CylinderGeometry(0.62, 1, 1, 10, 1, true).translate(0, 0.5, 0) // its foot at the origin
        const trees = [[-1750, -1950, 1.0], [-500, -2300, 0.9], [800, -2050, 1.05], [2000, -2300, 0.95], [-2900, -2250, 0.9], [3000, -1900, 1]] as const // within the far plane (~2.5 m past the board)
        const wood: THREE.Matrix4[] = [], crowns: [THREE.Vector3, number][] = []
        const v = new THREE.Vector3(), e = new THREE.Euler()
        for (const [tx, tz, k] of trees) {
          // a short trunk from the garden's ground, limbs spreading
          // low from it, the crowns hanging at eye height (the lifted view sees about 0 to 500 mm up at this depth)
          const H = 900 * k, R = 45 * k, foot = new THREE.Vector3(tx, -400, tz), fork = new THREE.Vector3(tx, -400 + 520 * k, tz)
          wood.push(new THREE.Matrix4().compose(foot, q.setFromEuler(e.set(0, 0, (r() - 0.5) * 0.12)), new THREE.Vector3(R, H, R)))
          for (let b = 0; b < 3; b++) {
            const a = (b / 3) * 6.283 + r(), lean = 0.95 + 0.3 * r(), L = (450 + 200 * r()) * k
            q.setFromEuler(e.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean)); v.set(0, L, 0).applyQuaternion(q)
            wood.push(new THREE.Matrix4().compose(fork.clone(), q.clone(), new THREE.Vector3(R * 0.45, L, R * 0.45)))
            crowns.push([fork.clone().add(v), (650 + 300 * r()) * k])
          }
          crowns.push([new THREE.Vector3(tx, -400 + H + 100, tz), 1000 * k])
        }
        const trunks = new THREE.InstancedMesh(cyl, bark, wood.length); wood.forEach((m, i) => trunks.setMatrixAt(i, m))
        trunks.renderOrder = -2; ctx.root.add(trunks); own.push(trunks, bark, cyl)
        const cloudTex = [3, 9].map(s => { const t = new THREE.CanvasTexture(cloudMap(s)); t.colorSpace = THREE.SRGBColorSpace; return t })
        const cgeo = new THREE.PlaneGeometry(1, 1)
        crowns.forEach(([p], i) => p.z += 30 * (i % 3)) // crowns overlap without z-fighting
        for (const [ti, t] of cloudTex.entries()) {
          // the petals glow a little where the light comes through them (backlit crowns would otherwise go dull)
          const mat = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.3, transparent: true, depthWrite: false, roughness: 0.9, side: THREE.DoubleSide })
          const mine = crowns.filter((_, i) => i % 2 === ti), m = new THREE.InstancedMesh(cgeo, mat, mine.length), col = new THREE.Color()
          mine.forEach(([p, s], i) => { m.setMatrixAt(i, m4.compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (r() - 0.5) * 0.6), new THREE.Vector3(s, s * 0.8, 1))); m.setColorAt(i, col.setScalar(0.85 + 0.25 * r())) })
          m.renderOrder = -1.5; ctx.root.add(m); own.push(m, mat, t)
        }
        own.push(cgeo)
      },
      update(_dt, t) { light?.update(t); for (const p of falling) p.update(t) },
      dispose() { for (const o of own) o.dispose(); own.length = 0; falling = []; light = null },
    }
  }
}

export default make()
