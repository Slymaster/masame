// Décor effects for Contemplation (no dependency): instanced particles, an animated light cookie, a procedural sky.
// A scene (scenes/<décor>.ts) builds them into its root group; Board3D shows that group only in Contemplation at fx ≥ 1
// and animates it only at fx 2. The blurred-HDRI backdrop is a Look field (Look.backdrop), drawn by Board3D.
// See docs/adding-stones-and-scenes.md.

import * as THREE from 'three'

/* ---------- particles ---------- */
export type ParticleKind = 'snow' | 'petals' | 'rain' | 'smoke' | 'dust'
export interface ParticleLook {
  /** mm/s down (negative: rising, like smoke). */
  fall: number
  /** Wind (mm/s, x and z). */
  drift: [number, number]
  /** Side-to-side wander (mm). */
  sway: number
  /** Sprite size (mm), ×0.6–1.4 per particle. */
  size: number
  /** Rain: streak length in sizes, along the fall as seen on screen (0 = round sprites). */
  stretch: number
  /** Smoke: grows by this share of its size over its life. */
  grow: number
  /** Turns (rad/s, petals). */
  spin: number
  shape: 'disc' | 'petal' | 'streak'
  color: number
  opacity: number
}
export const PARTICLES: Record<ParticleKind, ParticleLook> = {
  snow: { fall: 60, drift: [8, 0], sway: 14, size: 5, stretch: 0, grow: 0, spin: 0, shape: 'disc', color: 0xf4f7ff, opacity: 0.85 },
  petals: { fall: 35, drift: [22, 6], sway: 30, size: 7, stretch: 0, grow: 0, spin: 1.3, shape: 'petal', color: 0xf6c9d2, opacity: 0.9 },
  rain: { fall: 2600, drift: [60, 0], sway: 0, size: 0.8, stretch: 40, grow: 0, spin: 0, shape: 'streak', color: 0xc8d2dc, opacity: 0.35 },
  smoke: { fall: -18, drift: [3, 1], sway: 9, size: 16, stretch: 0, grow: 2.5, spin: 0.15, shape: 'disc', color: 0xd8d2c8, opacity: 0.12 },
  dust: { fall: 1.5, drift: [2, 1], sway: 6, size: 0.9, stretch: 0, grow: 0, spin: 0, shape: 'disc', color: 0xfff1d8, opacity: 0.5 },
}

const PARTICLE_VS = /* glsl */`
attribute vec4 aRnd;
uniform float uT, uFall, uSway, uSize, uStretch, uGrow, uSpin, uFadeY;
uniform vec3 uMin, uBox; uniform vec2 uDrift;
varying vec2 vUv; varying float vA;
void main() {
  vUv = uv;
  // each particle loops through the box height; age 0 where it appears (the top, or the bottom when rising)
  float age = fract(uT * abs(uFall) / uBox.y + aRnd.y);
  vec3 p = vec3(aRnd.x, 0.0, aRnd.z) * uBox;
  p.xz = mod(p.xz + uDrift * uT, uBox.xz);
  float ph = aRnd.w * 6.2832;
  p.x += uSway * sin(uT * 0.9 + ph); p.z += uSway * cos(uT * 0.7 + ph * 1.3);
  p.y = uFall >= 0.0 ? uBox.y * (1.0 - age) : uBox.y * age;
  p += uMin;
  float s = uSize * (0.6 + 0.8 * fract(aRnd.w * 7.13)) * (1.0 + uGrow * age);
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  vec2 q = position.xy * s;
  if (uStretch > 0.0) { // a streak along the fall as the camera sees it
    vec3 dn = mat3(viewMatrix) * vec3(0.0, -1.0, 0.0);
    vec2 d = normalize(dn.xy + vec2(1e-4, 0.0));
    q = vec2(-d.y, d.x) * q.x + d * q.y * uStretch;
  } else { float a = uSpin * uT + ph; q = mat2(cos(a), sin(a), -sin(a), cos(a)) * q; }
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  // fade in, fade out, and gone before reaching uFadeY (the board never gets a flake)
  vA = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.85, 1.0, age)) * smoothstep(uFadeY, uFadeY + 0.15 * uBox.y, p.y);
}`
const PARTICLE_FS = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform int uShape;
varying vec2 vUv; varying float vA;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float a;
  if (uShape == 1) { vec2 e = c * vec2(1.7, 1.0); a = (1.0 - smoothstep(0.6, 1.0, length(e))) * (0.75 + 0.25 * c.y); } // a petal
  else if (uShape == 2) a = (1.0 - abs(c.x)) * (1.0 - c.y * c.y);                                                  // a streak
  else { float r = length(c); a = (1.0 - smoothstep(0.0, 1.0, r)); a *= a; }                                           // a soft disc
  gl_FragColor = vec4(uColor, a * vA * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

export interface Particles { mesh: THREE.Mesh; material: THREE.ShaderMaterial; update(t: number): void; dispose(): void }
/**
 * count particles of a kind (or a custom look) looping through a box [x0, y0, z0, x1, y1, z1] (mm, world), all moved on
 * the GPU from one time uniform: update(t) only sets it. They fade out by fadeY (default: the box's floor).
 */
export function particles(kind: ParticleKind | ParticleLook, box: number[], count: number, fadeY = box[1], seed = 1): Particles {
  const L = typeof kind === 'string' ? PARTICLES[kind] : kind
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry)
  geo.instanceCount = count
  const rnd = new Float32Array(count * 4)
  let s = seed * 2654435761 >>> 0
  for (let i = 0; i < rnd.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; rnd[i] = s / 4294967296 }
  geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4))
  const material = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS, transparent: true, depthWrite: false,
    uniforms: {
      uT: { value: 0 }, uFall: { value: L.fall }, uSway: { value: L.sway }, uSize: { value: L.size }, uStretch: { value: L.stretch },
      uGrow: { value: L.grow }, uSpin: { value: L.spin }, uFadeY: { value: fadeY }, uDrift: { value: new THREE.Vector2(...L.drift) },
      uMin: { value: new THREE.Vector3(box[0], box[1], box[2]) }, uBox: { value: new THREE.Vector3(box[3] - box[0], box[4] - box[1], box[5] - box[2]) },
      uColor: { value: new THREE.Color(L.color) }, uOpacity: { value: L.opacity }, uShape: { value: ['disc', 'petal', 'streak'].indexOf(L.shape) },
    },
  })
  const mesh = Object.assign(new THREE.Mesh(geo, material), { frustumCulled: false, renderOrder: 5 })
  return { mesh, material, update(t) { material.uniforms.uT.value = t }, dispose() { geo.dispose(); material.dispose() } }
}

/* ---------- animated light cookie ---------- */
export interface Cookie { texture: THREE.CanvasTexture; update(t: number): void; dispose(): void }
/**
 * A light cookie for the shoji spot (SceneCtx.setCookie), repainted at most fps times a second on a small canvas
 * (size², linear: white = the full light, black = none). paint(x, t, S) draws the frame at time t (s).
 */
export function cookie(paint: (x: CanvasRenderingContext2D, t: number, S: number) => void, size = 256, fps = 15): Cookie {
  const cv = Object.assign(document.createElement('canvas'), { width: size, height: size }), x = cv.getContext('2d')!
  const texture = new THREE.CanvasTexture(cv)
  let last = -Infinity
  const draw = (t: number) => { paint(x, t, size); texture.needsUpdate = true }
  draw(0)
  return { texture, update(t) { if (t - last >= 1 / fps) { last = t; draw(t) } }, dispose() { texture.dispose() } }
}

/* ---------- procedural sky ---------- */
/** The default sky: a vertical gradient from uHorizon to uZenith, the ground below the horizon in uGround. */
export const SKY_GRADIENT = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround;
vec3 sky(vec3 d) { return d.y >= 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.6)) : mix(uHorizon, uGround, pow(-d.y, 0.4)); }`
/**
 * A sky behind everything for décors without an HDRI: a box drawn at the far plane, its colour from `glsl`, which defines
 * `vec3 sky(vec3 dir)` (dir: world direction, unit; linear colour out). `uniforms` are passed through (uT included, for update).
 */
export function skyDome(glsl = SKY_GRADIENT, uniforms: Record<string, THREE.IUniform> = {
  uZenith: { value: new THREE.Color(0x2a3b5c) }, uHorizon: { value: new THREE.Color(0x9aa7b8) }, uGround: { value: new THREE.Color(0x1a1a1e) },
}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, ...uniforms }, depthWrite: false, side: THREE.BackSide,
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }',
    fragmentShader: `varying vec3 vDir; uniform float uT;\n${glsl}\nvoid main() { gl_FragColor = vec4(sky(normalize(vDir)), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
  })
  const geo = new THREE.BoxGeometry(2, 2, 2)
  const mesh = Object.assign(new THREE.Mesh(geo, material), { frustumCulled: false, renderOrder: -1000 })
  return { mesh, material, update(t: number) { material.uniforms.uT.value = t }, dispose() { geo.dispose(); material.dispose() } }
}
