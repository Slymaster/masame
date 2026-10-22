// Stone sets for the 3D goban: each set is two files, sets/<id>.ts (shape, sound, 2D skin: no three.js) and sets/<id>.gl.ts
// (its black and white material factories), joined here into STONES.
// Everything else a set needs (dying stones, hover ghost, the mentor's stopped stone) is derived here from its two materials.
// See docs/adding-stones-and-scenes.md.

import * as THREE from 'three'
import type { Sign } from '@sabaki/go-board'
import { lensBot, lensTop, type StoneShape } from './logic'
import { isReadySet, STONE_DATA, STONE_SETS, type StoneData, type StoneSet } from './stoneSets'

/** What a material factory gets: the high-contrast uniform (0..1, shared, live), the stone's radius (mm), the ambient clock
 *  (s, shared; it advances only while ambient animation may run: see StoneGL.animated) and the Heirloom patina (0..1, shared,
 *  from Board3DOptions.patina). */
export interface StoneCtx { hc: { value: number }; R: number; time: { value: number }; patina: { value: number } }
/** A set's materials: sets/<id>.gl.ts default-exports it. */
export interface StoneGL {
  black: (ctx: StoneCtx) => THREE.MeshPhysicalMaterial
  white: (ctx: StoneCtx) => THREE.MeshPhysicalMaterial
  /** true if a material moves with ctx.time (glowing cracks): the view then renders continuously when allowed (≤ 30 fps). */
  animated?: boolean
}
/** A whole set: its three-free data (sets/<id>.ts, stoneSets.ts) and its materials. */
export interface StoneSpec extends StoneData, StoneGL {}

/* ---------- the table: one entry per sets/<id>.gl.ts ---------- */
const GL = import.meta.glob<{ default: StoneGL }>('./sets/*.gl.ts', { eager: true })
const gl = Object.fromEntries(Object.entries(GL).map(([f, m]) => [f.slice(7, -6), m.default])) as Partial<Record<string, StoneGL>>
const JAPONAISE: StoneSpec = { ...STONE_DATA.japonaise, ...gl.japonaise! }
/** Every set; a pending one (no data or no materials yet) is the Japanese set itself. */
const specOf = (s: StoneSet): StoneSpec => { const g = gl[s]; return isReadySet(s) && g && g !== gl.japonaise ? { ...STONE_DATA[s], ...g } : JAPONAISE }
export const STONES = Object.fromEntries(STONE_SETS.map(s => [s, specOf(s)])) as Record<StoneSet, StoneSpec>

/* ---------- derived materials ---------- */
const srgb = (c: THREE.Color) => { const h = c.getHex(); return [h >> 16 & 255, h >> 8 & 255, h & 255] }
const fromSrgb = (c: number[]) => new THREE.Color().setHex((c[0] << 16) | (c[1] << 8) | c[2])
/** Per channel: mix(c, DIM_GREY, DIM_MIX), in sRGB bytes. Fitted so the Japanese set keeps its v0.5 dying stones exactly. */
const DIM_GREY = [132.73, 130.26, 129.8], DIM_MIX = [139 / 229, 141 / 227, 147 / 219]

/**
 * A dying stone (counting, or KataGo expects it captured): the same shader, faded towards a neutral grey, duller, no sheen.
 * Faded but clearly present, like the 2D board's grey stones.
 */
export function dimOf(m: THREE.MeshPhysicalMaterial) {
  const d = m.clone()
  d.onBeforeCompile = m.onBeforeCompile; d.customProgramCacheKey = m.customProgramCacheKey // clone() drops both
  d.color = fromSrgb(srgb(m.color).map((v, i) => Math.round(v + (DIM_GREY[i] - v) * DIM_MIX[i])))
  d.roughness = 0.25 + m.roughness * 5 / 6
  d.sheen = 0
  return d
}

/** The hover ghost (half transparent, unshaded by any stone shader). A white ghost sits a shade warmer and darker than its
 *  stone so it still shows on pale wood. */
export function ghostOf(m: THREE.MeshPhysicalMaterial, c: Sign) {
  const color = c === 1 ? m.color.clone() : fromSrgb(srgb(m.color).map((v, i) => Math.round(v * [0.964, 0.952, 0.927][i])))
  return new THREE.MeshPhysicalMaterial({ color, roughness: m.roughness + (c === 1 ? 0.03 : 0.05), transparent: true, opacity: c === 1 ? 0.5 : 0.6, depthWrite: false })
}

/** The stone the mentor stopped: denser than the hover ghost, so it still reads as a black or white stone on the wood. */
export function pendingOf(m: THREE.MeshPhysicalMaterial, c: Sign) {
  return new THREE.MeshPhysicalMaterial({ color: m.color.clone(), roughness: m.roughness, clearcoat: m.clearcoat, transparent: true, opacity: c === 1 ? 0.72 : 0.78, depthWrite: false })
}

/* ---------- geometry ---------- */
/** A lens: a dome over the girdle, another under it (lensTop, lensBot); userData.prof = the top's height at r. */
export function stoneGeo(R: number, shape: StoneShape) {
  const pts: THREE.Vector2[] = [], n = 11, prof = (r: number) => lensTop(r, R, shape), bot = (r: number) => lensBot(r, R, shape)
  for (let k = 0; k <= n; k++) { const r = R * Math.sin((k / n) * Math.PI / 2); pts.push(new THREE.Vector2(r, -bot(r))) }
  for (let k = 1; k <= n; k++) { const r = R * Math.sin(((n - k) / n) * Math.PI / 2); pts.push(new THREE.Vector2(r, prof(r))) }
  const g = new THREE.LatheGeometry(pts, 36) // ~1.5k triangles: a full 19×19 stays near 1M with the shadow pass
  g.userData.prof = prof // the top surface: the last-move ring lies on it
  return g
}

/** The last-move ring (inner, outer radius in mm), lying on the stone's dome. */
export function markerGeo(prof: (r: number) => number, r0 = 1.75, r1 = 2.35) {
  const g = new THREE.RingGeometry(r0, r1, 40, 1).rotateX(-Math.PI / 2), P = g.attributes.position
  for (let i = 0; i < P.count; i++) P.setY(i, prof(Math.hypot(P.getX(i), P.getZ(i))) + 0.04)
  g.computeVertexNormals()
  return g
}

/** n instances of a stone, each with its own aSeed (every stone is unique through the shaders). */
export function stoneLayer(geo: THREE.BufferGeometry, mat: THREE.Material, n: number) {
  const m = new THREE.InstancedMesh(seeded(geo, n), mat, n)
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false
  return m
}
/** A copy of geo with an empty per-instance aSeed for n instances. */
export function seeded(geo: THREE.BufferGeometry, n: number) {
  const g = geo.clone(), seeds = new THREE.InstancedBufferAttribute(new Float32Array(n), 1)
  seeds.setUsage(THREE.DynamicDrawUsage)
  g.setAttribute('aSeed', seeds)
  return g
}

/** Everything the board draws for one set; built when the set is chosen, freed when another one is. */
export interface StoneKit {
  spec: StoneSpec
  geoB: THREE.LatheGeometry; geoW: THREE.LatheGeometry
  black: THREE.MeshPhysicalMaterial; white: THREE.MeshPhysicalMaterial
  blackDim: THREE.MeshPhysicalMaterial; whiteDim: THREE.MeshPhysicalMaterial
}
export function stoneKit(set: StoneSet, hc: { value: number }, time = { value: 0 }, patina = { value: 0 }): StoneKit {
  const spec = STONES[set] ?? STONES.japonaise
  const black = spec.black({ hc, R: spec.rB, time, patina }), white = spec.white({ hc, R: spec.rW, time, patina })
  black.userData.coat = black.clearcoat; white.userData.coat = white.clearcoat // Board3D scales the coat per view from these
  return { spec, black, white, blackDim: dimOf(black), whiteDim: dimOf(white), geoB: stoneGeo(spec.rB, spec), geoW: stoneGeo(spec.rW, spec) }
}
export function disposeKit(k: StoneKit) { for (const o of [k.geoB, k.geoW, k.black, k.white, k.blackDim, k.whiteDim]) o.dispose() }
