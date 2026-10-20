// Cosmos: deep space all around the floating board. One procedural sky (stars + a faint nebula) is drawn twice: on the
// sky dome, seen when the eyes rise, and once into an equirectangular target given to setEnvironment, so the stones and
// the board's lacquer reflect the same stars. The table is gone (an empty ground); a few dust motes drift at fx 2.
import * as THREE from 'three'
import { particles, PARTICLES, skyDome, type ParticleLook } from '../fx'
import LOOK from '../looks/cosmos'
import type { Scene } from '.'

/** The sky's tunables (the variants differ only here). */
export interface CosmosLook {
  /** Nebula colours (linear) and strength. */
  nebA: [number, number, number]; nebB: [number, number, number]; neb: number
  /** Star brightness and share of cells holding a star. */
  stars: number; density: number
  /** A faint lit mist under the board (alpha, 0 = none): it catches the board's shadow. */
  veil: number
  /** Stars are wider than a pixel of the 2048 environment and dimmed for it: this gives their light back in reflections. */
  envStars: number
}
export const COSMOS: CosmosLook = { nebA: [0.05, 0.07, 0.16], nebB: [0.11, 0.06, 0.12], neb: 1.4, stars: 1, density: 0.7, veil: 0, envStars: 300 }

// Stars sit on a grid on each cube face, one per lit cell, away from the cell's edges so no star is ever cut (no seam, no
// equirect pole); each is a Gaussian at least a pixel wide, dimmed by its spread so sub-pixel stars never sparkle.
const SKY = /* glsl */`
uniform vec3 uStar, uNebA, uNebB; uniform float uNeb, uStars, uDensity, uGain;
float h31(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float vn(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
vec3 starLayer(vec3 d, float pw, float N, float dens, float seed) {
  vec3 a = abs(d); float m = max(a.x, max(a.y, a.z));
  vec2 uv; float face;
  if (m == a.x) { uv = d.yz / a.x; face = sign(d.x); } else if (m == a.y) { uv = d.xz / a.y; face = 2.0 + sign(d.y); } else { uv = d.xy / a.z; face = 4.0 + sign(d.z); }
  vec2 g = (uv * 0.5 + 0.5) * N, c = floor(g);
  vec3 id = vec3(c, face * 17.0 + seed);
  if (h31(id) > dens * uDensity) return vec3(0.0);
  vec3 r = h33(id + 3.7);
  if (uGain > 1.0 && (N > 100.0 || r.z < 0.8)) return vec3(0.0); // the environment keeps only the brightest stars: points, not grain
  float k = 0.5 * N / m, px = max(pw * k, 1e-5); // cells per radian; one pixel, in cells
  float s0 = (0.00008 + 0.00014 * r.z * r.z) * k, s = max(s0, 0.5 * px), dist = length(g - c - 0.22 - 0.56 * r.xy);
  float b = (pow(r.z, 8.0) * 5.0 + 0.3 * r.y) * uGain;           // a few bright, many faint
  vec3 col = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.86, 0.68), smoothstep(0.55, 1.0, fract(r.x * 13.1)));
  return col * b * (s0 * s0) / (s * s) * exp(-0.5 * dist * dist / (s * s));
}
vec3 sky(vec3 d) {
  vec3 q = d * 2.2 + vec3(0.0, 0.0, uT * 0.0015);
  float n = fbm(q + 1.3 * vec3(fbm(q + 4.0), fbm(q + 9.0), 0.0));
  float band = exp(-pow(dot(d, normalize(vec3(0.35, 0.8, -0.45))) / 0.42, 2.0)); // a soft, tilted band, like a galaxy's
  float cloud = band * smoothstep(0.35, 0.85, n), lane = smoothstep(0.55, 0.75, fbm(q * 2.3 + 2.0)) * band;
  vec3 c = uNeb * (mix(uNebA, uNebB, smoothstep(0.4, 0.8, fbm(q * 0.7 + 5.0))) * cloud * 1.6 + uNebA * 0.08);
  float pw = length(fwidth(d)); // the pixel's footprint (rad), taken here in uniform control flow
  vec3 st = starLayer(d, pw, 70.0, 0.5, 1.0) + starLayer(d, pw, 160.0, 0.55, 2.0) * 0.6 + starLayer(d, pw, 340.0, 0.6 + 0.3 * band, 3.0) * 0.35;
  c += st * uStars * 0.5 * (1.0 - 0.7 * lane);
  // the small key star: a hard white-blue point and a faint halo
  float k = max(1.0 - dot(d, uStar), 0.0);
  c += vec3(0.85, 0.92, 1.0) * (exp(-k * 9e4) * 40.0 + exp(-k * 900.0) * 0.12 + exp(-k * 40.0) * 0.02);
  return c;
}`
// the same sky into an equirectangular target (three's mapping: u from atan(z, x), v from asin(y)), linear, for setEnvironment
const ENV_FS = /* glsl */`
varying vec2 vUv; uniform float uT;
${SKY}
void main() {
  float ph = (vUv.x - 0.5) * 6.2831853, th = (vUv.y - 0.5) * 3.1415927;
  gl_FragColor = vec4(sky(vec3(cos(th) * cos(ph), sin(th), cos(th) * sin(ph))), 1.0);
}`
const MOTES: ParticleLook = { ...PARTICLES.dust, fall: 0.6, drift: [1.6, -0.8], sway: 10, size: 1.6, color: 0xd6e0ff, opacity: 0.4 }

export function cosmos(v: Partial<CosmosLook> = {}) {
  const L = { ...COSMOS, ...v }
  return (): Scene => {
    const owned: { dispose(): void }[] = []
    let dome: ReturnType<typeof skyDome>, motes: ReturnType<typeof particles>[] = []
    return {
      animated: true,
      build(ctx) {
        const az = THREE.MathUtils.degToRad(LOOK.tod.az), el = THREE.MathUtils.degToRad(LOOK.tod.el)
        const u = {
          uStar: { value: new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)) },
          uNebA: { value: new THREE.Vector3(...L.nebA) }, uNebB: { value: new THREE.Vector3(...L.nebB) },
          uNeb: { value: L.neb }, uStars: { value: L.stars }, uDensity: { value: L.density },
        }
        dome = skyDome(SKY, { ...u, uGain: { value: 1 } }); ctx.root.add(dome.mesh); owned.push(dome)
        // the environment: rendered once at build
        const rt = new THREE.WebGLRenderTarget(2048, 1024, { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false })
        const mat = new THREE.ShaderMaterial({ uniforms: { uT: { value: 0 }, ...u, uGain: { value: L.envStars } }, vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: ENV_FS, depthTest: false })
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat), r = ctx.renderer, prev = r.getRenderTarget()
        r.setRenderTarget(rt); r.render(quad, new THREE.OrthographicCamera()); r.setRenderTarget(prev)
        quad.geometry.dispose(); mat.dispose()
        ctx.setEnvironment(rt.texture); owned.push(rt)
        // no table: the ground is empty (fully transparent), so the board floats over the stars
        const cv = Object.assign(document.createElement('canvas'), { width: 4, height: 4 }), x = cv.getContext('2d')!
        x.fillStyle = `rgba(40, 48, 70, ${L.veil})`; x.fillRect(0, 0, 4, 4)
        const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace
        ctx.setGround({ map, roughness: 1 })
        // dust motes far behind and beside the board, never over it
        const { BW, BD } = ctx.board, sx = BW / 2 + 220
        if (ctx.fx === 2) motes = [particles(MOTES, [-1600, -500, -2400, 1600, 700, -BD / 2 - 250], 140, -500),
          particles(MOTES, [-sx - 500, -400, -BD / 2, -sx, 120, BD / 2 + 300], 30, -400, 2), particles(MOTES, [sx, -400, -BD / 2, sx + 500, 120, BD / 2 + 300], 30, -400, 3)]
        for (const p of motes) ctx.root.add(p.mesh)
      },
      update(_dt, t) { dome.update(t); for (const p of motes) p.update(t) },
      dispose() { for (const p of motes) p.dispose(); for (const o of owned) o.dispose() },
    }
  }
}

export default cosmos()
