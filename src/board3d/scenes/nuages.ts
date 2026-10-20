// Au-dessus des nuages: a mountain temple's terrace at dawn. Dark weathered planks under the board, ending in a sill; past
// it, far below, a sea of cloud banks lit pink and gold by the low sun, a ridge or two standing out of it, and the dawn sky
// above (kloppenheim_06_puresky, pre-blurred). A few wisps drift slowly past the terrace's edge (fx 2).
import * as THREE from 'three'
import type { Scene } from '.'
import { skyDome } from '../fx'
import { BT } from '../logic'
import look from '../looks/nuages'
import { engawa } from './bambous'

/** The cloud sea's character (variants A/B/C were rendered from these). */
export interface Sea {
  /** Cloud cover (0..1) and the banks' height (share of the terrace's height above the sea). */
  cover: number; amp: number
  /** Feature size (1 = banks about a terrace's height across). */
  scale: number
  /** Warmth of the sunlit tops (0 = white, 1 = pink-gold). */
  warm: number
  /** Drift (sea units a second): slow. */
  drift: number
  /** Ridges above the sea (0 = none). */
  ridges: number
}
// variant B of the grid (rolling banks, one ridge); with the Look's 9° sun the board reads like the Atelier's (measured)
export const SEA: Sea = { cover: 0.6, amp: 0.3, scale: 1, warm: 0.8, drift: 0.004, ridges: 1 }

// The sky: the backdrop JPEG above the horizon (it holds 90° down to -5.625°), the cloud sea below, ridges on the horizon.
const SKY = /* glsl */`
uniform sampler2D uMap; uniform float uRot, uGain, uCover, uAmp, uScale, uWarm, uDrift, uRidges; uniform vec2 uSun;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; } return s; }
vec3 back(float az, float el) { return texture2D(uMap, vec2(fract((az + uRot) / 6.28318 + 0.5), clamp((el + 0.09817) / 1.66897, 0.0, 1.0))).rgb * uGain; }
// The sea's tops as a height field under the terrace (1 unit below, uAmp high), marched from the eye: banks rise, catch the
// low sun on the faces turned to it and hide the ones behind; the folds and the far side stay in the sky's blue.
float tops(vec2 p) {
  vec2 q = p * 0.55 / uScale + vec2(uT * uDrift, uT * uDrift * 0.3);
  q += 0.9 * vec2(vn(q * 0.35 + 2.0), vn(q * 0.35 + 9.0));
  float n = 0.55 * vn(q) + 0.28 * vn(q * 2.1 + 5.0) + 0.12 * vn(q * 4.3 + 1.0);
  return sqrt(smoothstep(1.0 - uCover - 0.25, 0.95, n)); // rounded caps and sharp folds: cloud, not waves (the reverse)
}
vec3 sky(vec3 d) {
  float az = atan(d.z, d.x), el = asin(clamp(d.y, -1.0, 1.0));
  vec3 horizon = (back(az, 0.02) + back(az, 0.04) + back(az, 0.07)) / 3.0; // a few rows up: the file's horizon line is streaky
  float toSun = dot(normalize(d.xz + 1e-5), uSun), glow = pow(max(toSun, 0.0), 6.0), side = toSun * 0.5 + 0.5;
  // the ridges: blue-grey, lighter with distance, only in a few bearings
  float rmask = uRidges * smoothstep(0.3, 0.65, vn(vec2(az * 1.3 + 4.0, 2.0)));
  float k1 = 1.0 - abs(2.0 * fbm(vec2(az * 4.0, 1.0)) - 1.0), k2 = 1.0 - abs(2.0 * fbm(vec2(az * 7.0 + 3.0, 5.0)) - 1.0); // ridged: peaks
  float r1 = rmask * 0.03 * k1 * k1 - 0.006, r2 = rmask * 0.018 * k2 * k2 - 0.004;
  if (el >= 0.0) {
    vec3 c = back(az, el);
    if (el < r1) c = mix(horizon * vec3(0.6, 0.64, 0.8), horizon, 0.5 + 0.3 * glow);
    if (el < r2) c = mix(horizon * vec3(0.46, 0.5, 0.68), horizon, 0.35 + 0.35 * glow);
    return mix(c, horizon * vec3(0.9, 0.84, 0.88), 1.0 - smoothstep(0.0, 0.025, el)); // a haze line on the sea's horizon
  }
  float dy = max(-d.y, 0.004), tA = (1.0 - uAmp) / dy, tB = min(1.0 / dy, 160.0), dt = max((tB - tA) / 28.0, 0.06);
  float t = tA + dt * 0.5 * (h21(d.xz * 4096.0) - 1.0), tp = t, hit = 0.0; // dithered start: no banding on the banks' edges
  for (int i = 0; i < 28; i++) {
    t += dt; if (t > tB) { t = tB; break; }
    vec3 p = d * t;
    if (p.y + 1.0 - uAmp * tops(p.xz) < 0.0) { hit = 1.0; break; }
    tp = t;
  }
  if (hit > 0.0) for (int i = 0; i < 6; i++) { float m = 0.5 * (tp + t); vec3 p = d * m; if (p.y + 1.0 - uAmp * tops(p.xz) < 0.0) t = m; else tp = m; }
  vec3 p = d * t;
  float e = 0.08, h0 = tops(p.xz), hx = tops(p.xz + vec2(e, 0.0)), hz = tops(p.xz + vec2(0.0, e));
  vec3 n = normalize(vec3(-uAmp * (hx - h0) / e, 1.0, -uAmp * (hz - h0) / e));
  vec3 L = normalize(vec3(uSun.x, 0.16, uSun.y));
  float sun = clamp(dot(n, L) * 0.7 + 0.35, 0.0, 1.0), up = n.y * 0.5 + 0.5;
  vec3 warm = mix(vec3(1.0, 0.72, 0.58), vec3(1.0, 0.82, 0.6), glow);
  vec3 lit = mix(vec3(0.95, 0.93, 1.0), warm, uWarm);
  vec3 shade = vec3(0.26, 0.3, 0.48);
  vec3 c = shade * (0.4 + 0.4 * up) * (0.5 + 0.6 * h0) + lit * sun * sun * (0.35 + 1.1 * h0) * (0.5 + 1.0 * side);
  c *= length(horizon) / 1.2; // in step with the sky's own brightness
  c = mix(c, c * warm * 1.2, uWarm * side * side * 0.7); // the sun's side of the sea, pink-gold
  float far = max(1.0 - exp(-t * 0.008), smoothstep(-0.035, -0.006, el)); // aerial haze towards the horizon
  return mix(c, horizon * vec3(0.9, 0.84, 0.88), far);
}`

const WISP_VS = /* glsl */`
uniform float uT; attribute vec4 aRnd; varying vec2 vUv; varying vec4 vR; varying float vA, vD;
void main() {
  vUv = uv; vR = aRnd;
  vec4 w = instanceMatrix * vec4(position, 1.0);
  // drift sideways across a 5 m span, the whole wisp wrapping at once; faded in and out at the ends so the wrap never shows
  float span = 5000.0, x0 = instanceMatrix[3].x, x = mod(x0 + 2500.0 + uT * (5.0 + 5.0 * aRnd.x), span);
  vA = smoothstep(0.0, 0.2, x / span) * smoothstep(1.0, 0.8, x / span);
  w.x += x - 2500.0 - x0; w.y += 30.0 * sin(uT * 0.05 + aRnd.y * 6.28);
  vec4 v = viewMatrix * modelMatrix * w; vD = -v.z;
  gl_Position = projectionMatrix * v;
}`
const WISP_FS = /* glsl */`
uniform float uT, uOpacity, uFar; uniform vec3 uColor; varying vec2 vUv; varying vec4 vR; varying float vA, vD;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 p = vUv * vec2(4.0, 1.4) + vR.zw * 20.0 + vec2(uT * 0.01, 0.0);
  float n = 0.5 * vn(p) + 0.25 * vn(p * 2.1 + 3.0) + 0.125 * vn(p * 4.3 + 7.0);
  vec2 q = vUv * 2.0 - 1.0;
  float a = smoothstep(0.35, 0.75, n) * (1.0 - smoothstep(0.3, 1.0, length(q * vec2(1.0, 1.15)))) * uOpacity * vA * (1.0 - smoothstep(uFar - 800.0, uFar - 150.0, vD)); // gone before the camera's far plane cuts them
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/* the terrace: the bambous engawa's weathered planks (engawa() draws them once per session) */
const PLANK = 120, TILE: [number, number] = [1600, 960] // as engawa() draws them (mm)

export function make(s: Sea = SEA) {
  return (): Scene => {
    const own: { dispose(): void }[] = []
    let dome: ReturnType<typeof skyDome> | null = null, wispU: { uT: { value: number } } | null = null
    return {
      animated: true,
      async build(ctx) {
        const tex = await new THREE.TextureLoader().loadAsync(`${ctx.base}nuages/backdrop_2k.jpg`)
        tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; tex.wrapS = THREE.RepeatWrapping // pre-blurred, no mip seam at the wrap
        const az = THREE.MathUtils.degToRad(look.tod.az)
        dome = skyDome(SKY, {
          uMap: { value: tex }, uRot: { value: look.skyAz - az }, uGain: { value: 0.8 }, uSun: { value: new THREE.Vector2(Math.cos(az), Math.sin(az)) },
          uCover: { value: s.cover }, uAmp: { value: s.amp }, uScale: { value: s.scale }, uWarm: { value: s.warm }, uDrift: { value: s.drift }, uRidges: { value: s.ridges },
        })
        dome.mesh.renderOrder = 1000 // the last opaque: only the sky left visible is shaded
        // the terrace hides the sky below it: a depth-only plane just under the table (which writes no depth), so the
        // sea's march never runs under the planks; it also hides the wisps where they pass under the terrace
        const occGeo = new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), occMat = new THREE.MeshBasicMaterial({ colorWrite: false })
        const occ = new THREE.Mesh(occGeo, occMat); occ.position.y = -BT - 1; occ.renderOrder = 999
        ctx.root.add(dome.mesh, occ); own.push(dome, tex, occGeo, occMat)
        // dark temple planks: the engawa darkened, a joint under the board's centre
        const [cm, bm] = engawa(), aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
        const tile = (cv: HTMLCanvasElement, srgb: boolean) => {
          const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3200 / TILE[0], 3200 / TILE[1])
          t.offset.set(0.37, 0.5 - ((0.5 * 3200 / TILE[1]) % 1) + PLANK / TILE[1] / 2); t.anisotropy = aniso
          if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
        }
        ctx.setGround({ map: tile(cm, true), bumpMap: tile(bm, false), roughness: 0.82, tint: 0.4 })
        // the terrace's edge: a dark sill along the far side and both flanks, so the planks end in timber, not in a line
        const sillMat = new THREE.MeshStandardMaterial({ color: 0x6a4a36, roughness: 0.75 })
        const along = new THREE.BoxGeometry(3300, 36, 120), side = new THREE.BoxGeometry(120, 36, 3200)
        for (const [g, x, z] of [[along, 0, -1600], [side, -1600, 0], [side, 1600, 0]] as const) {
          const m = new THREE.Mesh(g, sillMat); m.position.set(x, -BT + 6, z); m.castShadow = m.receiveShadow = true; ctx.root.add(m)
        }
        own.push(sillMat, along, side)
        // wisps rising past the edge, below the terrace, drifting sideways (fx 2 only)
        if (ctx.fx === 2) {
          const n = 9, geo = new THREE.PlaneGeometry(1, 1), rnd = new Float32Array(n * 4)
          let seed = 23; for (let i = 0; i < n * 4; i++) rnd[i] = (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
          geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4))
          wispU = { uT: { value: 0 } }
          const mat = new THREE.ShaderMaterial({
            uniforms: { ...wispU, uFar: { value: 3000 }, uOpacity: { value: 0.8 }, uColor: { value: new THREE.Color(1.25, 1.02, 0.9) } },
            vertexShader: WISP_VS, fragmentShader: WISP_FS, transparent: true, depthWrite: false,
          })
          const wisps = new THREE.InstancedMesh(geo, mat, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3()
          for (let i = 0; i < n; i++) {
            const r = rnd.subarray(i * 4, i * 4 + 4), w = 900 + 700 * r[2]
            wisps.setMatrixAt(i, m4.compose(v.set(-2500 + 5000 * (i + r[0] * 0.6) / n, -BT - 60 + 100 * r[1], -1700 - 300 * r[3]), q, sc.set(w * 1.4, w * 0.22, 1)))
          }
          wisps.frustumCulled = false // they move in the vertex shader
          wisps.onBeforeRender = (_r, _s, cam) => { mat.uniforms.uFar.value = (cam as THREE.PerspectiveCamera).far }
          ctx.root.add(wisps); own.push(wisps, geo, mat)
        }
      },
      update(_dt, t) { dome?.update(t); if (wispU) wispU.uT.value = t },
      dispose() { for (const o of own) o.dispose() },
    }
  }
}

export default make()
