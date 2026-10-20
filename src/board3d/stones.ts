// Stone sets for the 3D goban: each set is one STONES row (shape, black and white material factories, sound, 2D skin).
// Everything else a set needs (dying stones, hover ghost, the mentor's stopped stone) is derived here from its two materials.
// See docs/adding-stones-and-scenes.md.

import * as THREE from 'three'
import type { Sign } from '@sabaki/go-board'
import { lens, type StoneShape } from './logic'
import type { StoneSet } from './stoneSets'

/** What a material factory gets: the high-contrast uniform (0..1, shared, live) and the stone's radius (mm). */
export interface StoneCtx { hc: { value: number }; R: number }
/** The 2D board's version of a set (drawn by BoardView.stone()): radial gradient stops (sRGB, centre → rim) and its marks. */
export interface Skin2D { black: number[][]; white: number[][]; marks: { black: 'none' | 'veins' | 'bands' | 'bubbles'; white: 'none' | 'growth' | 'veins' | 'bands' | 'bubbles' } }
/** A milestone that unlocks a rare set (wave 3 defines the ids and unlocked()). */
export type Unlock = string
export interface StoneSpec extends StoneShape {
  black: (ctx: StoneCtx) => THREE.MeshPhysicalMaterial
  white: (ctx: StoneCtx) => THREE.MeshPhysicalMaterial
  /** Multipliers on the stone sounds' playback rate, low-pass cutoff and gain (1, 1, 1 = the recorded slate and shell). */
  snd: { rate: number; lowpass: number; gain: number }
  skin2d: Skin2D
  rare?: Unlock
}

/* ---------- shader helpers any set may reuse ---------- */
export const GLSL_NOISE = /* glsl */`
varying vec3 vObj; varying float vSeed;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`
type Shader = THREE.WebGLProgramParametersWithUniforms
/** vObj (object-space position, mm) and vSeed (per stone, 0..1) for the fragment shader, plus GLSL_NOISE. */
export function stoneVS(sh: Shader) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying vec3 vObj; varying float vSeed;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vSeed = aSeed;')
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
}

/* ---------- the Japanese set: Nachiguro slate and Hyuga clamshell ---------- */
// shell growth bands: pitch = BAND_PITCH + BAND_PITCH_VAR·fract per stone, in cycles/mm (2.5–4 mm periods); a raised
// cosine^BAND_SHARP (soft edges), cooler than the body; the fine lines run through them, stronger inside a band
const BAND_PITCH = 0.25, BAND_PITCH_VAR = 0.15, BAND_SHARP = 2, BAND_DARK = 0.13, BAND_WARP = 0.15
const FINE_STRIPES = 0.7, FINE_OUTSIDE = 0.5, STRIPE_ROUGH = 0.12

export function slateMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x18181b, roughness: 0.42, metalness: 0, specularIntensity: 0.7, clearcoat: 0.3, clearcoatRoughness: 0.42 })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0;
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sd * 0.31);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { float n = 0.6 * vnoise(vObj.xz * 1.3 + sd) + 0.4 * vnoise(vObj.xz * 3.7 - sd);
          n = mix(n, 0.5, smoothstep(0.4, 1.2, fwidth(vObj.x * 3.7)));
          roughnessFactor = clamp(roughnessFactor * (0.78 + 0.44 * n), 0.08, 1.0); }`)
  }
  m.customProgramCacheKey = () => 'slate'
  return m
}

export function shellMaterial({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xfdfbf6, roughness: 0.3, metalness: 0, specularIntensity: 0.8,
    clearcoat: 0.5, clearcoatRoughness: 0.14, sheen: 0.3,
    // nacre-free but pearly: a whisper of thin-film colour in the highlight
    iridescence: 0.14, iridescenceIOR: 1.45, iridescenceThicknessRange: [220, 420],
    emissive: new THREE.Color(0.075, 0.072, 0.066), // a little light comes back out of the shell
    sheenColor: new THREE.Color(0xfff1dc), sheenRoughness: 0.55,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        // Hyuga growth lines: concentric arcs around a far centre => parallel, slightly curved, uneven; pitch and depth vary per stone
        vec2 C = vec2(8.0 * (fract(sd * 0.53) - 0.5), -(45.0 + 80.0 * fract(sd * 0.137)));
        float d = length(vObj.xz - C), pitch = 1.0 + 0.6 * fract(sd * 0.29);
        float ph = d * pitch + 1.7 * sin(d * 0.21 + sd) + 0.8 * sin(d * 0.67 + sd * 1.7);
        float tri = 1.0 - abs(fract(ph) - 0.5) * 2.0;
        float aa = 1.0 - smoothstep(0.25, 0.65, fwidth(ph));
        float shellEnv = (0.35 + 0.65 * smoothstep(-0.3, 0.8, sin(d * 0.39 + sd * 2.3))) * (1.0 - 0.6 * uHC);
        // translucent growth bands on the same arcs, regular (barely warped), coarse enough to survive the Study scale
        float pb = ${BAND_PITCH.toFixed(3)} + ${BAND_PITCH_VAR.toFixed(3)} * fract(sd * 0.29);
        float phb = d * pb + ${BAND_WARP.toFixed(3)} * sin(d * 0.21 + sd);
        float band = pow(0.5 + 0.5 * cos(6.2832 * phb), ${BAND_SHARP.toFixed(2)})
          * (1.0 - smoothstep(0.3, 0.55, fwidth(phb))) * shellEnv * (0.7 + 0.3 * fract(sd * 0.71));
        float stripe = smoothstep(0.6, 1.0, tri) * shellEnv * aa * mix(${FINE_OUTSIDE.toFixed(3)}, 1.0, band);
        float broad = 0.5 + 0.5 * sin(d * 1.1 + sd * 3.1 + 1.3 * sin(d * 0.3));
        float depth = 0.55 + 0.45 * fract(sd * 0.71);
        diffuseColor.rgb *= 1.0 - (vec3(0.075, 0.095, 0.13) * ${FINE_STRIPES.toFixed(3)} * stripe + vec3(0.025, 0.032, 0.045) * broad) * depth
          - vec3(1.06, 1.0, 0.94) * ${BAND_DARK.toFixed(3)} * band; // cooler, greyer than the warm white body
        // the girdle: warmer and deeper where the shell is thin (a firm dark rim in high contrast)
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.9, 0.85, 0.76), vec3(0.35, 0.31, 0.27), uHC), smoothstep(0.72 + 0.12 * uHC, 1.0, rr) * (0.55 + 0.45 * uHC));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + ${STRIPE_ROUGH.toFixed(3)} * stripe; // the polish is uniform: the lines are inside the shell`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // cheap translucency: the window's light wraps warm through the thin girdle; the far side of the girdle falls darker
          float rim = smoothstep(0.62, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.45) / 1.45, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.78, 0.55) * diffuseColor.rgb * wrap * rim * 0.16;
          float away = rim * smoothstep(0.15, -0.55, nl);
          reflectedLight.indirectDiffuse *= 1.0 - 0.5 * away;
          reflectedLight.indirectSpecular *= 1.0 - 0.35 * away;
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'shell'
  return m
}

/* ---------- the table: one row per set ---------- */
export const STONES: Record<StoneSet, StoneSpec> = {
  japonaise: {
    rB: 11.1, rW: 10.95, sh: 4.5, lensExp: 0.78, // slate 22.2 mm, shell 21.9 mm across
    black: slateMaterial, white: shellMaterial,
    snd: { rate: 1, lowpass: 1, gain: 1 },
    skin2d: {
      black: [[92, 92, 98], [54, 54, 59], [24, 24, 27], [13, 13, 15]],
      white: [[255, 254, 249], [246, 241, 230], [229, 221, 205], [212, 202, 184]],
      marks: { black: 'none', white: 'growth' },
    },
  },
}

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
/** Biconvex lens: a dome with a rounded girdle; userData.prof = its half thickness at r. */
export function stoneGeo(R: number, shape: StoneShape) {
  const pts: THREE.Vector2[] = [], n = 11, prof = (r: number) => lens(r, R, shape.sh, shape.lensExp)
  for (let k = 0; k <= n; k++) { const r = R * Math.sin((k / n) * Math.PI / 2); pts.push(new THREE.Vector2(r, -prof(r))) }
  for (let k = 1; k <= n; k++) { const r = R * Math.sin(((n - k) / n) * Math.PI / 2); pts.push(new THREE.Vector2(r, prof(r))) }
  const g = new THREE.LatheGeometry(pts, 36) // ~1.5k triangles: a full 19×19 stays near 1M with the shadow pass
  g.userData.prof = prof
  return g
}

/** The last-move ring, lying on the stone's dome. */
export function markerGeo(prof: (r: number) => number) {
  const g = new THREE.RingGeometry(1.75, 2.35, 40, 1).rotateX(-Math.PI / 2), P = g.attributes.position
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
export function stoneKit(set: StoneSet, hc: { value: number }): StoneKit {
  const spec = STONES[set] ?? STONES.japonaise
  const black = spec.black({ hc, R: spec.rB }), white = spec.white({ hc, R: spec.rW })
  black.userData.coat = black.clearcoat; white.userData.coat = white.clearcoat // Board3D scales the coat per view from these
  return { spec, black, white, blackDim: dimOf(black), whiteDim: dimOf(white), geoB: stoneGeo(spec.rB, spec), geoW: stoneGeo(spec.rW, spec) }
}
export function disposeKit(k: StoneKit) { for (const o of [k.geoB, k.geoW, k.black, k.white, k.blackDim, k.whiteDim]) o.dispose() }
