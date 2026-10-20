// Pluie sur la véranda: steady rain on the garden beyond the veranda (never over the board), a line of drips falling from
// the eaves at the frame's far edge, rings spreading on the wet ground beyond, the veranda's outer planks darker and
// glossier where the rain reaches, and the blurred wet garden when the eyes rise.
import * as THREE from 'three'
import { edgeZ, type Scene } from '.'
import { particles, PARTICLES, skyDome, type ParticleLook } from '../fx'
import { engawa } from './bambous'

/** The veranda's outer edge with the table board (mm; edgeZ moves it out over a lower floor; the board's far edge is at about -230): it shows along the seated frame's top (~-440),
 *  the eaves dripping just past it. */
export const EDGE_Z = -370
/** The rain's character (variants A/B/C were rendered from these). */
export interface Rain { count: number; drips: number; opacity: number; wet: number }
export const RAIN: Rain = { count: 2600, drips: 160, opacity: 0.4, wet: 0.6 }

const RAIN_LOOK = (o: number): ParticleLook => ({ ...PARTICLES.rain, fall: 3200, drift: [40, 0], size: 1.5, stretch: 40, color: 0xc6d0da, opacity: o })
const DRIP: ParticleLook = { ...PARTICLES.rain, fall: 2200, drift: [0, 0], sway: 0, size: 2.2, stretch: 18, color: 0xd4dce4, opacity: 0.6 }

// the garden behind: ninomaru_teien's 2K, graded overcast and wet, pre-blurred (backdrop_2k.jpg)
const GARDEN = /* glsl */`
uniform sampler2D uMap; uniform float uRot, uGain;
vec3 sky(vec3 d) {
  float a = atan(d.z, d.x) + uRot;
  return texture2D(uMap, vec2(fract(a / 6.28318 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5)).rgb * uGain;
}`

/** Rings on the wet ground: one drop per 110 mm cell at its own time, a thin ring spreading and fading; the sky's sheen. */
const RINGS_FS = /* glsl */`
uniform float uT; uniform vec3 uColor; varying vec2 vXZ;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float a = 0.0;
  for (int k = 0; k < 2; k++) { // two offset layers, so drops never line up on the grid
    vec2 p = vXZ / 110.0 + float(k) * vec2(0.5, 0.37), c = floor(p), f = fract(p) - 0.5;
    float r = h21(c + float(k) * 7.0), per = 0.9 + 0.8 * r, age = fract(uT / per + r * 13.0);
    vec2 o = (vec2(h21(c + 3.1), h21(c + 5.7)) - 0.5) * 0.4;
    float d = length(f - o), rad = age * 0.36;
    a += exp(-pow((d - rad) / 0.016, 2.0)) * smoothstep(0.0, 0.12, age) * (1.0 - age) * (1.0 - age);
  }
  gl_FragColor = vec4(uColor, min(a, 1.0) * 0.35);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** Fine wet gravel (colour), tiled: dark grey stones, a few lighter, moss in the gaps. */
function gravelMap() {
  const N = 256, cv = Object.assign(document.createElement('canvas'), { width: N, height: N }), x = cv.getContext('2d')!
  let s = 41; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  x.fillStyle = '#2c2f2a'; x.fillRect(0, 0, N, N)
  for (let i = 0; i < 700; i++) {
    const px = r() * N, py = r() * N, rad = 2.5 + r() * 4, v = 38 + r() * 20, g = r() < 0.12 ? 8 : 0
    x.fillStyle = `rgb(${v},${v + 2 + g},${v + 4})`
    for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { x.beginPath(); x.ellipse(px + ox, py + oy, rad, rad * (0.6 + 0.4 * r()), r() * 3, 0, 6.283); x.fill() }
  }
  return cv
}

const PLANK = 120, TILE: [number, number] = [1600, 960] // bambous' engawa tile (mm)

export function make(c: Rain = RAIN) {
  return (): Scene => {
    const own: { dispose(): void }[] = []
    let rain: ReturnType<typeof particles>[] = [], ringU: { uT: { value: number } } | null = null
    return {
      animated: true,
      async build(ctx) {
        const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()), Y = ctx.board.groundY, E = edgeZ(EDGE_Z, Y)
        const tex = await new THREE.TextureLoader().loadAsync(`${ctx.base}pluie/backdrop_2k.jpg`)
        tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter
        const garden = skyDome(GARDEN, { uMap: { value: tex }, uRot: { value: 1.57 }, uGain: { value: 1 } })
        ctx.root.add(garden.mesh); own.push(garden, tex)
        // the veranda's cedar planks (bambous'), greyer under the rain's light
        const [cm, bm] = engawa(), tile = (cv: HTMLCanvasElement, srgb: boolean) => {
          const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3200 / TILE[0], 3200 / TILE[1])
          t.offset.set(0.37, 0.5 - ((0.5 * 3200 / TILE[1]) % 1) + PLANK / TILE[1] / 2)
          t.anisotropy = aniso; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t
        }
        ctx.setGround({ map: tile(cm, true), bumpMap: tile(bm, false), roughness: 0.86, tint: 0.92 })
        // where the rain reaches: the outer planks wet (darker, a glossy film), fading in towards the board
        const wc = Object.assign(document.createElement('canvas'), { width: 4, height: 64 }), wx = wc.getContext('2d')!, wg = wx.createLinearGradient(0, 0, 0, 64)
        wg.addColorStop(0, '#fff'); wg.addColorStop(0.35, '#bbb'); wg.addColorStop(1, '#000'); wx.fillStyle = wg; wx.fillRect(0, 0, 4, 64)
        const wetA = new THREE.CanvasTexture(wc)
        const wetM = new THREE.MeshStandardMaterial({ color: 0x1c1915, roughness: 0.12, alphaMap: wetA, transparent: true, opacity: c.wet, depthWrite: false })
        const wetG = new THREE.PlaneGeometry(8000, 110).rotateX(-Math.PI / 2).translate(0, Y + 0.3, E + 55)
        // past the edge: the wet garden ground with its rings, fading out far away (over the table's planks, which run on)
        const gt = new THREE.CanvasTexture(gravelMap()); gt.colorSpace = THREE.SRGBColorSpace; gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(8000 / 300, 4000 / 300); gt.anisotropy = aniso
        const fc = Object.assign(document.createElement('canvas'), { width: 4, height: 64 }), fx = fc.getContext('2d')!, fg = fx.createLinearGradient(0, 0, 0, 64)
        fg.addColorStop(0, '#000'); fg.addColorStop(0.7, '#fff'); fx.fillStyle = fg; fx.fillRect(0, 0, 4, 64)
        const fadeT = new THREE.CanvasTexture(fc)
        const groundM = new THREE.MeshStandardMaterial({ map: gt, roughness: 0.2, alphaMap: fadeT, transparent: true, depthWrite: false })
        const GY = Y + 0.4, groundG = new THREE.PlaneGeometry(8000, 4000).rotateX(-Math.PI / 2).translate(0, GY, E - 2000)
        ringU = { uT: { value: 0 } }
        const ringM = new THREE.ShaderMaterial({
          uniforms: { ...ringU, uColor: { value: new THREE.Color(0xb8c2cc) } }, transparent: true, depthWrite: false,
          vertexShader: 'varying vec2 vXZ; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
          fragmentShader: RINGS_FS,
        })
        const ringG = new THREE.PlaneGeometry(8000, 1600).rotateX(-Math.PI / 2).translate(0, GY + 0.5, E - 820)
        const meshes = [new THREE.Mesh(wetG, wetM), new THREE.Mesh(groundG, groundM), new THREE.Mesh(ringG, ringM)]
        meshes[0].renderOrder = 0.5; meshes[1].renderOrder = 0.4; meshes[2].renderOrder = 0.45
        for (const m of meshes.slice(0, 2)) m.receiveShadow = true
        for (const m of meshes) ctx.root.add(m)
        own.push(wetG, wetM, wetA, gt, fadeT, groundG, groundM, ringG, ringM)
        // the rain beyond the edge, and the eaves' drips along it (each drip falls at its own place: no sway, no wind)
        if (ctx.fx === 2) {
          rain = [particles(RAIN_LOOK(c.opacity), [-3000, GY, -2800, 3000, 1800, E - 160], c.count, GY, 7),
            particles(DRIP, [-1600, GY, E - 60, 1600, 520, E - 35], c.drips, GY, 8)]
          for (const p of rain) { ctx.root.add(p.mesh); own.push(p) }
        }
      },
      update(_dt, t) { for (const p of rain) p.update(t); if (ringU) ringU.uT.value = t },
      dispose() { for (const o of own) o.dispose(); own.length = 0; rain = []; ringU = null },
    }
  }
}

export default make()
