// "Atelier vivant": the real-time 3D goban (three.js, WebGL2). Same contract as the Canvas2D BoardView
// (constructor(canvas, onPlay), update(state), drop(v, c), resize(size), destroy()), so the app can swap renderers.
// resize(width, height, frame) may also give the board's frame inside the canvas: the scene runs full-bleed, the board
// is framed in that rectangle (a view offset on both cameras).
// Units are millimetres. Only MeshPhysicalMaterial / MeshBasicMaterial / ShadowMaterial + PMREM, so a WebGPURenderer
// port stays possible; the onBeforeCompile GLSL snippets (grid ink, shell stripes, slate micro-roughness, AO alpha) are
// the parts that would need a TSL rewrite.

import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import type { Sign, Vertex } from '@sabaki/go-board'
import { paintMarks, type BoardState } from '../board/BoardView'
import { rng } from '../board/noise'
import type { Decor } from './decors'
import type { StoneSet } from './stoneSets'
import { centreShift } from '../board/frame'
import { ambientOn, AMBIENT_FPS, bowlHeap, BT, clampOrbit, dims, DROP_MS, dropPose, dropStones, FOV, Governor, gx, gz, HOME, hoshiStep, jitter, LOOKS, orbitEye, panBy, pickPoint, qualityLadder, seatHeight, settle, SLIDE_MM, stepOrbit, SX, SZ, TGT_Y, TOD, seasonTod, wheelIntent, zoomAt, type Ground, type Look, type Orbit, type Placed, type Quality, type Rest, type TimeName, type Tod, type WheelIntent, ZOOM_MM, skipPinchWheel } from './logic'
import { StoneSound } from './sound3d'
import { SCENES, type Scene, type SceneCtx, type SceneGround } from './scenes'
import { disposeKit, ghostOf, markerGeo, pendingOf, seeded, stoneKit, stoneLayer, type StoneKit } from './stones'
import { cropRect, postcardCanvas, signatureFonts, toPng } from '../postcard'

export interface Board3DState extends BoardState {
  /** Prisoners shown on each lid in Contemplation (black = white stones taken by Black). Optional: without it the view counts the captures it animates. */
  captures?: { black: number; white: number }
}
export type CameraMode = 'study' | 'contemplation'
export type TimeMode = TimeName | 'auto'
export interface Board3DOptions {
  camera: CameraMode; time: TimeMode; highContrast: boolean; decor: Decor; stones: StoneSet
  /** Depth of field in Contemplation (wave 3): accepted, not used yet. */
  dof?: boolean
  /** The Heirloom stones' age (0 new … 1 fully aged), shared by every set's materials as StoneCtx.patina. */
  patina?: number
}
export type FallbackReason = 'webgl2' | 'context-lost' | 'slow'
export interface Board3DInit {
  /** The app should switch to the 2D BoardView (WebGL2 missing, context lost, or still too slow at the lowest quality). */
  onFallback?: (reason: FallbackReason) => void
  options?: Partial<Board3DOptions>
  /** Where kaya_*.jpg, *.mp3 and the HDRI live (default: `${BASE_URL}assets/board3d/`). */
  assetBase?: string
  /** The board moved right of its frame's centre by this many CSS px (centred on the window beside the card). */
  onShift?: (px: number) => void
}

// Nothing moves but the stone being placed: view, décor and light changes crossfade (FADE_MS) instead of travelling
// dev only: ?clock=2026-01-15T17:00 pins "Auto"'s clock (season captures); builds always read the real time
const now = () => {
  const pin = import.meta.env.DEV ? new URLSearchParams(location.search).get('clock') : null
  return pin ? new Date(pin) : new Date()
}
const FADE_MS = 230, OMBRE_MS = 900, AUTO_MS = 15_000, SHAKE_MS = 650 // SHAKE_MS: a refused stone trembles, then fades away
const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'
const AO_K = 1.4 // contact-shadow quad half size, in stone radii
// contact shadow: darkest right at the silhouette (peak per colour), a gaussian gone (≈2 %) AO_REACH radii out on the
// shadow side (plus the lean), AO_REACH_LIT on the lit side, where its strength is only AO_LIT of the peak
const AO_PEAK_WHITE = 0.35, AO_PEAK_BLACK = 0.25, AO_REACH = 0.2, AO_REACH_LIT = 0.08, AO_LIT = 0.12
// a thin soft line all round the silhouette, so a white stone's lit side still has an edge (0 = none)
const AO_LINE_WHITE = 0.4, AO_LINE_BLACK = 0, AO_LINE_W = 0.03
// the shadow side reaches further by AO_LEAN·(half the stone's height)/tan(el) mm, clamped
const AO_LEAN = 0.1, AO_LEAN_MIN = 0.3, AO_LEAN_MAX = 1.5
const CAST_STUDY = 0.95, CAST_ROOM = 0.8 // cast-shadow strength (× the décor's shade)
// Study + linen: the board's shadow on the linen stays within this share of the frame margin (true direction, never cut)
const FLOOR_MARGIN = 0.8
// realism, kept subtle and only in Contemplation (Study stays as tuned for readability; debug.tune() sets them live):
// the urushi lines' dome (edge slope), width wobble (±share) and gloss; the kaya's patina (roughness × (1 − patina) at
// the centre, gone 80→220 mm out, where hands polish the board); the shoji's bars (light level left behind a bar; the share of light is LOOKS.shoji, shoji ≥ 0 overrides it);
// Contemplation's vignette (darkening in the frame's corners)
const FX = { relief: 0.45, wobble: 0.08, inkRough: 0.28, patina: 0.1, shojiBar: 0.15, shoji: -1, vignette: 0.22 }
const SHOJI_MM = 4000, SHOJI_R = 1600 // the shoji light's distance and its cookie's half width there
const KAYA_MM = [502, 424.5] // the kaya scan's physical size (along, across the grain), at 2K and 4K alike
const easeIO = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const lerp = THREE.MathUtils.lerp
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const freeGround = (g: SceneGround) => { g.map.dispose(); g.bumpMap?.dispose() }
const mkCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })

interface Mounted { s: Scene; g: THREE.Group; cookie: THREE.Texture | null; ground: SceneGround | null; lampColor: THREE.Color | null; lampPose: { pos: THREE.Vector3; target: THREE.Vector3 } | null; env: THREE.WebGLRenderTarget | null }

interface Stone extends Placed {
  p: number; c: Sign; seed: number; rotY: number
  t0: number; landed: boolean; captured: Stone[]
  /** Landed at once (navigation interrupted its drop): no slide. */
  still?: boolean
}

function kelvin(K: number) {
  const t = K / 100, c = (v: number) => Math.min(255, Math.max(0, v)) / 255
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace)
}

/* ---------- shaders ---------- */
const GLSL_GRID = /* glsl */`
uniform vec3 uInk; uniform float uLim, uStep, uFive, uHalf, uRelief, uWobble, uInkRough, uPatina;
varying vec3 vLoc;
// ink coverage across a line; g: the slope of its lacquer dome (urushi stands proud of the wood), only where the line is
// wide enough on screen to show it. a = the coordinate along the line: brush-drawn, its width wanders slowly.
float lineAA(float c, float a, float sp, float h, float lim, out float g) {
  float n = clamp(floor(c / sp + 0.5), -lim, lim);
  h *= 1.0 + uWobble * (0.6 * sin(a * 0.045 + n * 2.1) + 0.4 * sin(a * 0.011 - n * 1.3));
  float d = c - n * sp, dd = abs(d), w = max(fwidth(c), 1e-4);
  float hw = max(h, 0.55 * w);                         // never thinner than ~1px; fade instead
  g = -uRelief * clamp(d / max(h, 1e-3), -1.0, 1.0) * (1.0 - smoothstep(0.25, 0.6, w / max(h, 1e-3)));
  return clamp((hw - dd) / w + 0.5, 0.0, 1.0) * sqrt(h / hw);
}
float span(float c, float ext, float h) { float w = max(fwidth(c), 1e-4); return clamp((ext + h - abs(c)) / w + 0.5, 0.0, 1.0); }
float gridInk(vec3 p, out vec2 g) {
  g = vec2(0.0);
  if (p.y < ${(BT / 2 - 0.01).toFixed(2)}) return 0.0;
  // odd N: lines sit on multiples of the spacing; even N would need a half offset (only 9/13/19 are played)
  float gx, gz;
  float lx = lineAA(p.x, p.z, ${SX.toFixed(2)}, uHalf, uLim, gx) * span(p.z, uLim * ${SZ.toFixed(2)}, uHalf);
  float lz = lineAA(p.z, p.x, ${SZ.toFixed(2)}, uHalf, uLim, gz) * span(p.x, uLim * ${SX.toFixed(2)}, uHalf);
  g = vec2(gx * lx, gz * lz);
  float ho = 0.0;
  if (uStep > 0.0) {
    vec2 k = clamp(floor(p.xz / (uStep * vec2(${SX.toFixed(2)}, ${SZ.toFixed(2)})) + 0.5), -1.0, 1.0);
    vec2 h = k * uStep * vec2(${SX.toFixed(2)}, ${SZ.toFixed(2)});
    float hd = length(p.xz - h), hwid = max(fwidth(hd), 1e-4);
    ho = clamp((2.0 - hd) / hwid + 0.5, 0.0, 1.0);
    if (uFive > 0.5 && ((k.x == 0.0) != (k.y == 0.0))) ho = 0.0; // 9×9 and 13×13: corners + centre only
    g = mix(g, -uRelief * (p.xz - h) / 2.0 * (1.0 - smoothstep(0.25, 0.6, hwid / 2.0)), ho); // a radial dome
  }
  return max(max(lx, lz), ho) * 0.94;
}`
/** Mulberry go-ke: outer wall up to the lip, then down the inside (closed profile, mm). */
const BOWL_PROFILE = [[0, 0], [44, 0], [47, 3], [58, 18], [64, 40], [61, 62], [52, 74], [49, 75], [47, 72], [55, 58], [57, 40], [50, 20], [36, 12], [0, 11]]
const LID_PROFILE = [[0, 0], [30, 0], [33, 2], [52, 9], [63, 16], [65, 19], [62, 20], [50, 13], [31, 6], [0, 5]] // inverted lid = shallow dish
function lathe(prof: number[][], seg: number) {
  const g = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), seg), uv = g.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.8, uv.getY(i) * 0.35) // grain wraps around the bowl
  return g
}

/* ---------- procedural grounds (tile seamlessly) ---------- */
const TATAMI_MM = 900, PAPER_MM = 640

/**
 * One tatami mat's width (900 mm, heri to heri) by 900 mm of its 1.8 m length, 1024 px square: igusa rushes run across
 * the mat (along u), ~3.3 mm each, straw-green to gold, pinched by the warp threads every ~18 mm; dark cloth heri on
 * both long edges. Returns colour + height (bump) canvases.
 */
function tatamiMaps() {
  const S = 1024, px = S / TATAMI_MM, r = rng(31), col = mkCanvas(S, S), hgt = mkCanvas(S, S)
  const ci = col.getContext('2d')!.createImageData(S, S), hi = hgt.getContext('2d')!.createImageData(S, S)
  // rush boundaries along v, summing exactly to S so the texture tiles
  const n = Math.round(TATAMI_MM / 3.3), w = Array.from({ length: n }, () => 0.8 + 0.4 * r()), sum = w.reduce((a, b) => a + b)
  const rows: { y0: number; h: number; c: number[]; ph: number; amp: number; k: number }[] = []
  const green = [170, 168, 108], gold = [205, 186, 122]
  let acc = 0
  for (const wi of w) {
    const t = 0.3 + 0.4 * r(), l = 0.97 + 0.06 * r()
    rows.push({ y0: acc, h: (wi / sum) * S, c: green.map((g, i) => (g + (gold[i] - g) * t) * l), ph: r() * 6.283, amp: 0.015 + 0.03 * r(), k: 1 + Math.floor(r() * 4) })
    acc += (wi / sum) * S
  }
  const heri = 22 * px, warp = S / Math.round(TATAMI_MM / 18)
  let ri = 0
  for (let y = 0; y < S; y++) {
    while (ri < rows.length - 1 && y + 0.5 >= rows[ri].y0 + rows[ri].h) ri++
    const R = rows[ri], t = (y + 0.5 - R.y0) / R.h, prof = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.5)
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4
      let c: number[], h: number
      if (x < heri || x >= S - heri) { // heri: dark woven cloth, a fine twill, a pale stitch line at its inner edge
        const tw = ((x + y) % 4 < 2 ? 1 : 0.9) * (0.96 + 0.04 * Math.sin(y * 0.9))
        const edge = Math.abs(x < heri ? x - heri : x - (S - heri)) < 1.2
        c = edge ? [92, 84, 70] : [40 * tw, 36 * tw, 33 * tw]; h = 0.55 + 0.05 * tw
      } else {
        const wp = (x % warp) / warp, pinch = Math.exp(-(((wp - 0.5) * 14) ** 2)) // warp thread under the rush
        const along = 1 + R.amp * Math.sin((x / S) * 6.283 * R.k + R.ph) // tiles: whole cycles across S
        const v = (0.86 + 0.14 * prof) * along * (1 - 0.04 * pinch)
        c = R.c.map(ch => ch * v); h = prof * (1 - 0.15 * pinch)
      }
      ci.data[o] = c[0]; ci.data[o + 1] = c[1]; ci.data[o + 2] = c[2]; ci.data[o + 3] = 255
      hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = h * 255; hi.data[o + 3] = 255
    }
  }
  col.getContext('2d')!.putImageData(ci, 0, 0); hgt.getContext('2d')!.putImageData(hi, 0, 0)
  return [col, hgt]
}

/** Warm off-white washi: soft mottling and faint long kozo fibres, drawn wrapped so it tiles (PAPER_MM square). */
function paperMap() {
  const S = 1024, r = rng(57), cv = mkCanvas(S, S), x = cv.getContext('2d')!
  x.fillStyle = 'rgb(242,237,227)'; x.fillRect(0, 0, S, S)
  const wrapped = (draw: (ox: number, oy: number) => void) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) draw(ox, oy) }
  for (let k = 0; k < 40; k++) { // clouds of denser and thinner pulp
    const cx = r() * S, cy = r() * S, rad = 60 + r() * 180, dark = r() < 0.5
    wrapped((ox, oy) => {
      const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad)
      g.addColorStop(0, dark ? 'rgba(170,150,120,0.05)' : 'rgba(255,253,248,0.07)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      x.fillStyle = g; x.fillRect(cx + ox - rad, cy + oy - rad, 2 * rad, 2 * rad)
    })
  }
  x.lineCap = 'round'
  for (let k = 0; k < 1400; k++) { // fibres: long, thin, gently curved
    const x0 = r() * S, y0 = r() * S, a = r() * Math.PI * 2, len = 20 + r() * 90, bend = (r() - 0.5) * len * 0.6
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len, mx = (x0 + x1) / 2 - Math.sin(a) * bend, my = (y0 + y1) / 2 + Math.cos(a) * bend
    x.strokeStyle = r() < 0.6 ? `rgba(255,252,244,${0.18 + r() * 0.2})` : `rgba(150,128,96,${0.05 + r() * 0.07})`
    x.lineWidth = 0.6 + r() * 1.1
    wrapped((ox, oy) => { x.beginPath(); x.moveTo(x0 + ox, y0 + oy); x.quadraticCurveTo(mx + ox, my + oy, x1 + ox, y1 + oy); x.stroke() })
  }
  return cv
}

export class Board3D {
  /** WebGL2 without a major performance caveat (software rendering counts as unsupported). */
  static supported(): boolean {
    try {
      const gl = mkCanvas(1, 1).getContext('webgl2', { failIfMajorPerformanceCaveat: true })
      if (!gl) return false
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      return true
    } catch { return false }
  }

  private renderer!: THREE.WebGLRenderer
  private composer!: EffectComposer
  private scene = new THREE.Scene()
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 100, 6000)
  private persp = new THREE.PerspectiveCamera(FOV, 1, 10, 5000)
  private key = new THREE.DirectionalLight(0xffffff, 3)
  private spot = new THREE.SpotLight(0xffe2b8, 0, 0, Math.atan(430 / 1500), 0, 0)
  /** Lanterne: a warm lamp hanging over the board, soft-edged, pooling on the board and bowls. */
  private lamp = new THREE.SpotLight(0xffffff, 0, 0, 0.62, 0.95, 2)
  /** Washitsu: part of the window's light comes through a shoji, the lattice's soft shadow drawn by a cookie. */
  private shoji = new THREE.SpotLight(0xffffff, 0, 0, Math.atan(SHOJI_R / SHOJI_MM), 0.25, 0)
  private shojiTex = new THREE.CanvasTexture(mkCanvas(1024, 1024))
  private vigU = { uVig: { value: 0 }, uVigC: { value: new THREE.Vector2() }, uVigS: { value: new THREE.Vector2(1, 1) } }
  private vignette!: THREE.Mesh
  private fx = { ...FX }
  private hc = { value: 0 }
  /** The stones' ambient clock and the Heirloom patina, shared by every set's materials (stones.ts StoneCtx). */
  private stoneTime = { value: 0 }; private patinaU = { value: 0 }
  /** The stone set's geometry and materials (stones.ts); swapped whole by applyStones(). */
  private kit: StoneKit = stoneKit('japonaise', this.hc, this.stoneTime, this.patinaU)
  private layerB = stoneLayer(this.kit.geoB, this.kit.black, 400)
  private layerW = stoneLayer(this.kit.geoW, this.kit.white, 400)
  private dimB = stoneLayer(this.kit.geoB, this.kit.blackDim, 400)
  private dimW = stoneLayer(this.kit.geoW, this.kit.whiteDim, 400)
  private decorB = stoneLayer(this.kit.geoB, this.kit.black, 120)
  private decorW = stoneLayer(this.kit.geoW, this.kit.white, 120)
  private ao!: THREE.InstancedMesh
  private aoU = { uAoDir: { value: new THREE.Vector2(1, 0) }, uAoLean: { value: 0 } }
  private terr!: { 1: THREE.InstancedMesh; [-1]: THREE.InstancedMesh }
  private ghost!: THREE.Mesh
  private ghostMats!: { 1: THREE.MeshPhysicalMaterial; [-1]: THREE.MeshPhysicalMaterial }
  private pendingMats!: { 1: THREE.MeshPhysicalMaterial; [-1]: THREE.MeshPhysicalMaterial }
  private trem!: THREE.Mesh // the refused stone (shake)
  private tremMats!: { 1: THREE.MeshPhysicalMaterial; [-1]: THREE.MeshPhysicalMaterial }
  private shook: { v: Vertex; c: Sign; t0: number } | null = null
  private markers!: { 1: THREE.Mesh; [-1]: THREE.Mesh }
  private boardMat!: THREE.MeshPhysicalMaterial
  /** Pale golden kaya (the scan, barely graded): readability comes from the stones' contact shadow and rim, not dark wood. */
  private woodTone = new THREE.Color(0.47, 0.442, 0.395)
  private boardU = { uInk: { value: new THREE.Color(0x120c07) }, uLim: { value: 9 }, uStep: { value: 6 }, uFive: { value: 0 }, uHalf: { value: 0.5 }, uRelief: { value: 0 }, uWobble: { value: 0 }, uInkRough: { value: 0.45 }, uPatina: { value: 0 } }
  private board: THREE.Mesh | null = null
  private labels: THREE.Mesh | null = null
  private marks: THREE.Mesh | null = null
  private marksKey = ''
  private bowlMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0.26, 0.15, 0.09), roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.16 })
  private decor = new THREE.Group()
  private bowls: THREE.Mesh[] = []
  private sets: { c: Sign; bowl: [number, number]; lid: [number, number]; heap: Rest[]; lidRest: Rest[] }[] = []
  private ground!: THREE.Group
  private shadowFloor = new THREE.ShadowMaterial({ color: 0x2a1606, opacity: 0.24 })
  private tableMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.72, transparent: true, depthWrite: false })
  private roomColor = new THREE.Color()
  private owCanvas = mkCanvas(512, 512)
  private owTex = new THREE.CanvasTexture(this.owCanvas)
  private maps: { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture } | null = null
  private base: string
  /** Décor resources, built on demand; a décor switch frees the GPU side of what the new one doesn't use. */
  private grounds: Partial<Record<Ground, { map: THREE.Texture; bump?: THREE.Texture }>> = {}
  private envs = new Map<string, Promise<THREE.WebGLRenderTarget>>() // dispose the target: its texture alone won't free it
  private decorOn: Decor | null = null
  private decorJob = 0
  /** Crossfade: the previous frame, drawn over the new one with a fading constant alpha. */
  private fade: { tex: THREE.FramebufferTexture; t0: number; ms: number } | null = null
  private fadeMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } }, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.ConstantAlphaFactor, blendDst: THREE.OneMinusConstantAlphaFactor,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { gl_FragColor = texture2D(map, vUv); }', // raw bytes: no colour management
  })
  private fadeScene = new THREE.Scene().add(Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMat), { frustumCulled: false }))
  private holding = false // compiling the next look's shaders: the canvas keeps showing the last frame
  /** The décor's scene (scenes/<décor>.ts) under sceneRoot, with the light cookie it asked for. */
  private sceneRoot!: THREE.Group
  private sceneOn: Mounted | null = null
  private decorEnv: THREE.Texture | null = null // the Look's environment, under a scene's own (setEnvironment)
  private ambT = 0; private ambLast = 0; private ambWait = false // ambient animation clock (s), last ambient frame, waiting for the next one

  private state: Board3DState | null = null
  private N = 0
  private coords = false
  private D = dims(19, false)
  private stones = new Map<number, Stone>()
  /** A move whose update() came before its drop(): its captures, so the drop can hold them until it lands. */
  private recent: { p: number; c: Sign; list: Stone[]; at: number } | null = null
  private pendingDrop: { p: number; c: Sign; at: number } | null = null
  private moveNo = 0
  private capCount = { 1: 0, [-1]: 0 } as Record<number, number> // internal count when the app doesn't pass captures
  private decorKey = ''
  private own: number[] | null = null
  private hover: Vertex | null = null

  private opts: Board3DOptions = { camera: 'study', time: 'afternoon', highContrast: false, decor: 'atelier', stones: 'japonaise' }
  private camE = 0 // 0 Study, 1 Contemplation
  /** Contemplation's camera: shown (cur) and wanted (goal, what the mouse moves); seatH = its visible height at home. */
  private orbit: Orbit = { ...HOME }
  private orbitGoal: Orbit = { ...HOME }
  private seatH = 1
  private clock = new Date()
  private ombreK = 0; private ombreFrom = 0; private ombreOn = false; private ombreT0 = -1e9
  private hcK = 0
  private noGrid = false // measurements only: the ink lines would pass for stone edges

  private W = 1; private H = 1
  private box = { x: 0, y: 0, w: 1, h: 1 } // .board-wrap's rectangle in the canvas, CSS px
  private fr = { ...this.box } // the board's frame: box, shifted right to centre the board on the window (placeFrame)
  private shift = 0
  private raf = 0
  private lastFrame = 0
  private ready = false
  private dead = false
  private ladder = qualityLadder(window.devicePixelRatio || 1)
  private governor = new Governor(this.ladder.length)
  private q: Quality = this.ladder[0]
  private pendingQ = false // the governor stepped down: applied at the next scene change, never on a still board
  private resizeTimer = 0
  private benchedPx = 0 // canvas area at the last warm-up
  private sound: StoneSound
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  private autoTimer = 0
  private cleanup: () => void = () => {}
  private onFallback: (r: FallbackReason) => void
  private onShift: (px: number) => void
  private fellBack = false
  private ray = new THREE.Raycaster()

  constructor(private canvas: HTMLCanvasElement, private onPlay: (v: Vertex) => boolean, init: Board3DInit = {}) {
    this.onFallback = init.onFallback ?? (() => {})
    this.onShift = init.onShift ?? (() => {})
    const base = this.base = init.assetBase ?? `${import.meta.env.BASE_URL}assets/board3d/`
    this.sound = new StoneSound(base)
    Object.assign(this.opts, init.options)
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true })
    } catch {
      this.dead = true
      queueMicrotask(() => this.fallback('webgl2'))
      return
    }
    this.sound.preload()
    canvas.style.opacity = '0'
    canvas.style.transition = this.reducedMotion.matches ? '' : 'opacity .6s ease'
    this.setup()
    if (this.opts.stones !== 'japonaise') this.applyStones()
    this.bind()
    this.applyOptions()
    void this.boot(base)
  }

  /* ---------- public API ---------- */

  /** Camera, light, contrast and décor. Nothing travels: view, light and décor changes crossfade (instant under reduced motion). */
  setOptions(o: Partial<Board3DOptions>) {
    const prev = { ...this.opts }
    Object.assign(this.opts, o)
    if (prev.camera !== this.opts.camera || prev.time !== this.opts.time) void this.transition(() => this.applyOptions())
    else if (prev.highContrast !== this.opts.highContrast) this.applyOptions()
    if (prev.decor !== this.opts.decor) void this.switchDecor()
    if (prev.stones !== this.opts.stones) void this.transition(() => this.applyStones())
    if (prev.patina !== this.opts.patina) { this.patinaU.value = this.opts.patina ?? 0; this.invalidate() }
  }
  get options(): Readonly<Board3DOptions> { return this.opts }

  /** Contemplation: back to the seat (crossfade). */
  resetCamera() {
    const g = this.orbitGoal
    if (this.camE && (Object.keys(HOME) as (keyof Orbit)[]).some(k => g[k] !== HOME[k])) void this.transition(() => this.homeCamera())
  }
  private homeCamera() { this.orbit = { ...HOME }; this.orbitGoal = { ...HOME } }

  /** The quiet "stones stirred in the bowl" loop while the AI thinks. */
  setThinking(on: boolean) { this.sound.setThinking(on) }

  /** The bot passed: a soft tap from its bowl, nothing moves. */
  pass(c: Sign) { this.sound.tap(c) }

  /** Animates and sounds a stone landing (the player's click, or the bot's move). */
  drop(v: Vertex, c: Sign) {
    if (this.dead) return
    this.hover = null
    const N = this.N, p = v[1] * N + v[0], s = this.stones.get(p)
    const now = performance.now()
    if (s && s.c === c && s.landed && now - s.t0 > 400) { // update() came first: put back the captures it just removed
      const R = this.recent, back = R && R.p === p && R.c === c && now - R.at < 60 ? R.list : []
      this.recent = null
      if (!this.state?.captures) this.capCount[c] -= back.length
      s.captured = back
      for (const r of back) this.stones.set(-1 - r.p, r)
      this.animateDrop(s, now)
    } else this.pendingDrop = { p, c, at: now }
    this.invalidate()
  }

  /** A refused stone (replaying from memory): it trembles and disappears; the position doesn't change. */
  shake(v: Vertex, c: Sign) {
    if (this.dead) return
    this.hover = null
    this.shook = { v, c, t0: performance.now() }
    this.sound.tap(c)
    this.invalidate()
  }

  update(state: Board3DState) {
    if (this.dead) return
    if (!state.interactive || state.counting) this.hover = null
    this.sound.setEnabled(state.sound)
    const N = state.signMap.length
    if (N !== this.N || state.coords !== this.coords) {
      const sizeChanged = N !== this.N
      this.N = N; this.coords = state.coords; this.D = dims(N, state.coords)
      if (sizeChanged) { this.stones.clear(); this.capCount = { 1: 0, [-1]: 0 }; this.homeCamera() }
      this.placeFrame()
      this.buildBoard()
    }
    this.state = state
    this.reconcile(state)
    this.buildMarks()
    const own = state.ownership?.length === N * N ? state.ownership : null
    if (own !== this.own) {
      this.own = own
      if (own) this.paintOwnership(own)
      if (!!own !== this.ombreOn) { this.ombreFrom = this.ombreK; this.ombreOn = !!own; this.ombreT0 = this.instant() ? -1e9 : performance.now() }
    }
    this.invalidate()
  }

  /** Canvas size in CSS pixels; height defaults to width (the 2D view's square contract). `frame` (canvas CSS px,
   *  default the whole canvas) is where the board is framed; a frame-only change re-frames without re-measuring quality. */
  resize(width: number, height = width, frame?: { left: number; top: number; width: number; height: number }) {
    if (this.dead) return
    const W = Math.max(200, Math.floor(width)), H = Math.max(200, Math.floor(height))
    const f = frame ?? { left: 0, top: 0, width: W, height: H }
    const fr = { x: Math.round(f.left), y: Math.round(f.top), w: Math.max(1, Math.round(f.width)), h: Math.max(1, Math.round(f.height)) }
    const sized = W !== this.W || H !== this.H, o = this.box
    if (!sized && fr.x === o.x && fr.y === o.y && fr.w === o.w && fr.h === o.h) return
    this.box = fr
    if (sized) {
      this.W = W; this.H = H
      this.canvas.style.width = `${W}px`; this.canvas.style.height = `${H}px`
      this.renderer.setSize(W, H, false)
      this.composer.setSize(W, H)
      // quality is re-decided once the size settles (steps down only, unless the canvas shrank a lot)
      clearTimeout(this.resizeTimer)
      this.resizeTimer = window.setTimeout(() => {
        if (!this.ready || this.dead) return
        // a much smaller canvas (window un-maximized) may afford a better level: re-decide from the top
        if (this.W * this.H < 0.7 * this.benchedPx) { this.governor.restart(); this.pendingQ = true }
        this.applyPendingQuality(); this.warmUp(); this.invalidate()
      }, 300)
    }
    this.placeFrame()
    this.endFade()
    if (this.ready) this.frame(performance.now()) // synchronous: no blank frame while the window is being dragged
  }

  destroy() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    clearInterval(this.autoTimer); clearTimeout(this.resizeTimer)
    this.cleanup()
    this.sound.destroy()
    this.sceneOn?.s.dispose(); this.sceneOn?.env?.dispose()
    if (!this.renderer) return
    this.scene.traverse(o => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      for (const mat of ([] as THREE.Material[]).concat(m.material ?? [])) mat.dispose()
    })
    for (const t of Object.values(this.maps ?? {})) t.dispose()
    for (const g of Object.values(this.grounds)) { g.map.dispose(); g.bump?.dispose() }
    this.tableMat.alphaMap?.dispose()
    this.owTex.dispose(); this.shojiTex.dispose()
    for (const l of [this.key, this.lamp, this.shoji, this.spot]) l.shadow.map?.dispose() // render targets the renderer doesn't free
    for (const e of this.envs.values()) void e.then(t => t.dispose(), () => {})
    this.endFade(); this.fadeMat.dispose(); (this.fadeScene.children[0] as THREE.Mesh).geometry.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }

  /* ---------- setup ---------- */

  private setup() {
    const r = this.renderer, scene = this.scene
    r.setClearColor(0x000000, 0)
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap // PCF + radius (Vogel disk) = soft penumbra
    r.setPixelRatio(this.q.dpr)
    const float = r.extensions.has('EXT_color_buffer_float')
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: float ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: this.q.msaa })
    this.composer = new EffectComposer(r, rt)
    this.composer.setPixelRatio(this.q.dpr)
    this.composer.addPass(new RenderPass(scene, this.ortho))
    const out = new OutputPass(); out.needsSwap = false // last pass, on screen: swapping would alternate (and allocate) a second MSAA target
    this.composer.addPass(out)

    this.ortho.position.set(0, 3000, 0); this.ortho.up.set(0, 0, -1); this.ortho.lookAt(0, 0, 0)
    this.persp.up.set(0, 0, -1)

    scene.add(this.layerB, this.layerW, this.dimB, this.dimW)
    for (const m of [this.dimB, this.dimW]) { m.renderOrder = 2; m.castShadow = false }

    // contact AO, per instance: instanceColor.r = shadow strength, .g = edge line strength. The quad spans 2 × AO_K radii;
    // vAo is the world xz offset from the stone's axis in radii. Asymmetric: almost nothing on the lit side.
    const aoMat = new THREE.MeshBasicMaterial({ color: 0x0c0603, transparent: true, depthWrite: false })
    aoMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.aoU)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vAo;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAo = vec2(uv.x - 0.5, 0.5 - uv.y) * ${(2 * AO_K).toFixed(3)};`)
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vAo; uniform vec2 uAoDir; uniform float uAoLean;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_COLOR
        { float r = length(vAo), d = max(r - 1.0, 0.0), t = 0.5 + 0.5 * dot(vAo / max(r, 1e-3), uAoDir);
          float reach = mix(${AO_REACH_LIT.toFixed(3)}, ${AO_REACH.toFixed(3)} + uAoLean, t), k = d / reach, l = d / ${AO_LINE_W.toFixed(3)};
          diffuseColor.a *= min(1.0, max(mix(${AO_LIT.toFixed(3)}, 1.0, t * t) * exp(-4.0 * k * k) * vColor.r, exp(-l * l) * vColor.g)); }
        #endif`)
    }
    this.ao = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), aoMat, 420)
    this.ao.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(420 * 3), 3)
    this.ao.count = 0; this.ao.frustumCulled = false; this.ao.renderOrder = 1; this.ao.position.y = 0.06
    scene.add(this.ao)

    // counting: small slate / shell tiles on counted points
    const tile = new THREE.BoxGeometry(7, 1.2, 7)
    const tileMat = (c: number, rough: number) => new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, clearcoat: 0.3 })
    this.terr = { 1: new THREE.InstancedMesh(tile, tileMat(0x1c1c20, 0.5), 361), [-1]: new THREE.InstancedMesh(tile, tileMat(0xf2ede2, 0.35), 361) }
    for (const m of Object.values(this.terr)) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m) }

    // hover ghost + last-move marker
    this.hintMats()
    this.ghost = new THREE.Mesh(this.kit.geoB, this.ghostMats[1]); this.ghost.visible = false; this.ghost.renderOrder = 3
    scene.add(this.ghost)
    this.trem = new THREE.Mesh(this.kit.geoB, this.tremMats[1]); this.trem.visible = false; this.trem.renderOrder = 3
    scene.add(this.trem)
    const mm = (c: number) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.markers = { 1: new THREE.Mesh(markerGeo(this.kit.geoB.userData.prof), mm(0xe9dcc4)), [-1]: new THREE.Mesh(markerGeo(this.kit.geoW.userData.prof), mm(0x2a201a)) }
    for (const m of Object.values(this.markers)) { m.matrixAutoUpdate = false; m.visible = false; scene.add(m) }

    // the table. Study: shadows only (the app's linen shows through). Contemplation: a dark wooden table fading into a
    // warm dark room (the canvas clears to the room colour), lit by the window
    this.ground = new THREE.Group()
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), this.shadowFloor)
    floor.receiveShadow = true
    const fade = mkCanvas(256, 256), fx = fade.getContext('2d')!, fg = fx.createRadialGradient(128, 128, 0, 128, 128, 128)
    fg.addColorStop(0, '#fff'); fg.addColorStop(0.2, '#fff'); fg.addColorStop(0.36, '#999'); fg.addColorStop(0.55, '#000'); fg.addColorStop(1, '#000')
    fx.fillStyle = fg; fx.fillRect(0, 0, 256, 256)
    this.tableMat.alphaMap = new THREE.CanvasTexture(fade)
    const table = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200).rotateX(-Math.PI / 2), this.tableMat)
    table.receiveShadow = true; table.renderOrder = -1; table.position.y = -0.2
    const ug = mkCanvas(256, 256), ux = ug.getContext('2d')!, grad = ux.createRadialGradient(128, 128, 60, 128, 128, 128)
    grad.addColorStop(0, '#fff'); grad.addColorStop(1, '#000'); ux.fillStyle = grad; ux.fillRect(0, 0, 256, 256)
    const under = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x1a0e04, alphaMap: new THREE.CanvasTexture(ug), transparent: true, opacity: 0.5, depthWrite: false }))
    under.name = 'under'; under.position.y = 0.3; under.renderOrder = 0
    this.ground.add(table, floor, under)
    scene.add(this.ground)

    // board material: kaya scan + lacquered ink grid
    this.boardMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.62, 0.6, 0.57), roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(0.6, 0.6), clearcoat: 0.18, clearcoatRoughness: 0.4, specularIntensity: 0.5,
    })
    this.boardMat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.boardU)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_GRID)
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec2 inkG; float ink = gridInk(vLoc, inkG);\ndiffuseColor.rgb = mix(diffuseColor.rgb, uInk, ink);')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          #ifdef USE_ROUGHNESSMAP
          { float d = length((vRoughnessMapUv - 0.5) * vec2(${KAYA_MM[0]}, ${KAYA_MM[1]})); roughnessFactor *= 1.0 - uPatina * (1.0 - smoothstep(80.0, 220.0, d)); }
          #endif
          roughnessFactor = mix(roughnessFactor, uInkRough, ink);`)
        // the dome tilts both the wood's normal and the clear coat's (the board is only translated: object xz = world xz)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 inkN = mat3(viewMatrix) * vec3(inkG.x, 0.0, inkG.y);\nif (uRelief > 0.0) normal = normalize(normal - inkN);')
        .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n#ifdef USE_CLEARCOAT\nif (uRelief > 0.0) clearcoatNormal = normalize(clearcoatNormal - inkN);\n#endif')
    }
    this.boardMat.customProgramCacheKey = () => 'kaya'

    // go-ke (Contemplation only): bowls with inverted lids; prisoners collect on the capturer's lid
    this.decor.visible = false
    this.decor.add(this.decorB, this.decorW)
    scene.add(this.decor)

    // lights: the window (key, follows the time of day) and "Ombre et lumière", the ownership field as a light cookie
    this.key.castShadow = true
    this.key.shadow.mapSize.set(this.q.shadow, this.q.shadow)
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.25; this.key.shadow.radius = 6
    scene.add(this.key, this.key.target)
    this.owTex.colorSpace = THREE.SRGBColorSpace
    // oblique, like a high window: its mirror highlight never lands in the top-down camera
    this.spot.position.set(-420, 1400, -320); this.spot.target.position.set(0, 0, 0); this.spot.map = this.owTex
    // the cookie only applies inside the light's projection depth range (default far = 500 would miss the board)
    this.spot.shadow.camera.near = 1000; this.spot.shadow.camera.far = 2200
    scene.add(this.spot, this.spot.target)
    // Lanterne's lamp (only in the scene's lights while that décor is on: no cost elsewhere)
    this.lamp.visible = false
    this.lamp.shadow.mapSize.set(this.q.shadow, this.q.shadow)
    this.lamp.shadow.bias = -0.0004; this.lamp.shadow.normalBias = 0.25
    this.lamp.shadow.camera.near = 500; this.lamp.shadow.camera.far = 2600
    scene.add(this.lamp, this.lamp.target)
    this.shoji.visible = false; this.shoji.map = this.shojiTex
    this.shoji.shadow.mapSize.set(this.q.shadow / 2, this.q.shadow / 2)
    this.shoji.shadow.bias = -0.0004; this.shoji.shadow.normalBias = 0.25
    this.shoji.shadow.camera.near = SHOJI_MM - 900; this.shoji.shadow.camera.far = SHOJI_MM + 900
    this.paintShoji()
    scene.add(this.shoji, this.shoji.target)

    // Contemplation's vignette: a full-frame quad drawn last, darkening towards the frame's corners (no extra pass)
    const vm = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false })
    vm.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, this.vigU)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vNdc;')
        .replace('#include <project_vertex>', 'vec4 mvPosition = vec4(transformed, 1.0); gl_Position = vec4(transformed.xy, 0.0, 1.0); vNdc = transformed.xy;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vNdc; uniform float uVig; uniform vec2 uVigC, uVigS;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a = uVig * smoothstep(0.55, 1.5, length((vNdc - uVigC) / uVigS));')
    }
    vm.customProgramCacheKey = () => 'vignette'
    this.vignette = Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), vm), { frustumCulled: false, renderOrder: 999, visible: false })
    scene.add(this.vignette)

    // the décor's scene (Contemplation only)
    this.sceneRoot = new THREE.Group(); this.sceneRoot.visible = false
    scene.add(this.sceneRoot)
  }

  private bind() {
    const c = this.canvas
    // Contemplation's camera: right-drag turns, middle- or Shift+right-drag pans, the wheel or a pinch zooms about the
    // cursor, a trackpad swipe turns (pans with Shift)
    let drag: { x: number; y: number; pan: boolean } | null = null, wheelAt = 0, wheelWas: WheelIntent | null = null, gesture = 0
    const turn = (dYaw: number, dTilt: number) => { const g = this.orbitGoal; this.orbitGoal = { ...g, yaw: g.yaw + dYaw, tilt: g.tilt + dTilt }; this.invalidate() }
    const planeAt = (x: number, y: number, o: Orbit) => { // the point of y = TGT_Y at client (x, y), as the camera o sees it
      this.placePersp(o)
      const r = c.getBoundingClientRect()
      this.ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.persp)
      const P = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TGT_Y), new THREE.Vector3())
      this.placePersp(this.orbit)
      return P
    }
    const zoom = (e: MouseEvent, k: number) => { // about the cursor's point as the goal camera sees it
      const g = this.orbitGoal, zMin = Math.min(1, ZOOM_MM / this.seatH)
      k = Math.min(1, Math.max(zMin, g.zoom * k)) / g.zoom
      const P = planeAt(e.clientX, e.clientY, g)
      if (P) { this.orbitGoal = zoomAt(g, k, P.x, P.z); this.invalidate() }
    }
    const pan = (x0: number, y0: number, x1: number, y1: number) => { // the board point at (x0, y0) moves to (x1, y1)
      const g = this.orbitGoal, A = planeAt(x0, y0, g), B = planeAt(x1, y1, g)
      if (A && B) { this.orbitGoal = panBy(g, A.x, A.z, B.x, B.z); this.invalidate() }
    }
    const move = (e: PointerEvent) => {
      if (drag) {
        if (drag.pan) pan(drag.x, drag.y, e.clientX, e.clientY)
        else if (e.buttons & 2) turn(-(e.clientX - drag.x) * 0.005, -(e.clientY - drag.y) * 0.005)
        drag.x = e.clientX; drag.y = e.clientY
        return
      }
      const v = this.pick(e), s = this.state
      if (s?.counting) { // only stones are clickable while counting; no ghost stone
        c.style.cursor = v && s.interactive && s.signMap[v[1]][v[0]] ? 'pointer' : 'default'
        if (this.hover) { this.hover = null; this.invalidate() }
        return
      }
      const nh = v && s?.interactive && !s.signMap[v[1]][v[0]] ? v : null
      c.style.cursor = nh ? 'pointer' : 'default'
      if (nh?.[0] === this.hover?.[0] && nh?.[1] === this.hover?.[1]) return
      this.hover = nh; this.invalidate()
    }
    const leave = () => { this.hover = null; this.invalidate() }
    const down = (e: PointerEvent) => {
      this.sound.prime()
      if ((e.button !== 2 && e.button !== 1) || !this.camE) return
      e.preventDefault() // no middle-click autoscroll
      c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.shiftKey }
      if (this.hover) { this.hover = null; this.invalidate() }
    }
    const up = () => { drag = null }
    const menu = (e: Event) => e.preventDefault()
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault() // a pinch must never zoom the UI
      if (!this.camE || skipPinchWheel(e.ctrlKey, 'GestureEvent' in window)) return
      e.preventDefault()
      const now = performance.now(), how = wheelWas = wheelIntent(e, wheelWas, now - wheelAt), px = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1
      wheelAt = now
      if (how === 'orbit') turn(e.deltaX * 0.003, e.deltaY * 0.003)
      else if (how === 'pan') pan(e.clientX, e.clientY, e.clientX - e.deltaX * px, e.clientY - e.deltaY * px) // the board follows the fingers
      // a pinch sends small steps; a wheel notch zooms at least as much as a 40 px one (macOS sends 4 px notches)
      else zoom(e, Math.exp(e.ctrlKey ? e.deltaY * 0.01 : Math.sign(e.deltaY) * Math.min(200, Math.max(40, Math.abs(e.deltaY * px))) * 0.0015))
    }
    // WebKit (the macOS app): a pinch is a gesture event, e.scale since its start
    const gStart = (e: Event) => { e.preventDefault(); gesture = 1 }
    const gChange = (e: Event) => { e.preventDefault(); const sc = (e as Event & { scale: number }).scale; if (this.camE && sc > 0) zoom(e as MouseEvent, gesture / sc); gesture = sc }
    const dbl = (e: MouseEvent) => { if (this.camE && !this.pick(e)) this.resetCamera() }
    const click = (e: MouseEvent) => {
      const v = this.pick(e), s = this.state
      if (!v || !s?.interactive) return
      if (s.counting) { this.onPlay(v); return }
      const col = s.toPlay
      if (this.onPlay(v)) this.drop(v, col)
    }
    const lost = (e: Event) => { e.preventDefault(); this.fallback('context-lost') }
    const motion = () => this.invalidate() // also: the window shown or focused again resumes a décor's animation
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerleave', leave)
    c.addEventListener('pointerdown', down)
    c.addEventListener('click', click)
    c.addEventListener('pointerup', up)
    c.addEventListener('lostpointercapture', up)
    c.addEventListener('contextmenu', menu)
    c.addEventListener('wheel', wheel, { passive: false })
    c.addEventListener('gesturestart', gStart)
    c.addEventListener('gesturechange', gChange)
    c.addEventListener('dblclick', dbl)
    c.addEventListener('webglcontextlost', lost)
    this.reducedMotion.addEventListener('change', motion)
    document.addEventListener('visibilitychange', motion); window.addEventListener('focus', motion)
    // labels need the bundled font actually loaded
    void document.fonts?.load('500 12px Manrope').then(() => { if (this.coords && !this.dead) { this.buildLabels(); this.invalidate() } })
    // devicePixelRatio changes (window moved to another display): the query only fires once, so re-arm it
    let mq: MediaQueryList, onDpr: () => void
    const arm = () => { mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); mq.addEventListener('change', onDpr) }
    onDpr = () => {
      mq.removeEventListener('change', onDpr); arm()
      this.ladder = qualityLadder(devicePixelRatio || 1); this.applyQuality(this.ladder[this.governor.level])
    }
    arm()
    this.cleanup = () => {
      mq.removeEventListener('change', onDpr)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerleave', leave)
      c.removeEventListener('pointerdown', down)
      c.removeEventListener('click', click)
      c.removeEventListener('pointerup', up)
      c.removeEventListener('lostpointercapture', up)
      c.removeEventListener('contextmenu', menu)
      c.removeEventListener('wheel', wheel)
      c.removeEventListener('gesturestart', gStart)
      c.removeEventListener('gesturechange', gChange)
      c.removeEventListener('dblclick', dbl)
      c.removeEventListener('webglcontextlost', lost)
      this.reducedMotion.removeEventListener('change', motion)
      document.removeEventListener('visibilitychange', motion); window.removeEventListener('focus', motion)
    }
  }

  private async boot(base: string) {
    try {
      const tl = new THREE.TextureLoader(), decor = this.opts.decor, aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      const kaya = async (sfx: string) => {
        const [diff, nor, rough] = await Promise.all(['diff', 'nor', 'rough'].map(m => tl.loadAsync(`${base}kaya_${m}${sfx}.jpg`)))
        diff.colorSpace = THREE.SRGBColorSpace
        // mirrored: seamless, and the walnut ground's clone of the diffuse (same wrap) shares its GPU upload
        for (const t of [diff, nor, rough]) { t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping }
        return { diff, nor, rough }
      }
      const setMaps = (m: { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture }) => {
        this.maps = m
        Object.assign(this.boardMat, { map: m.diff, normalMap: m.nor, roughnessMap: m.rough }); this.boardMat.needsUpdate = true
        this.bowlMat.map = m.diff; this.bowlMat.needsUpdate = true
      }
      const [maps, env] = await Promise.all([kaya(''), this.envFor(LOOKS[decor].sky).then(t => t.texture)])
      if (this.dead) return
      setMaps(maps)
      if (!this.N) { this.N = 19; this.D = dims(19, false); this.buildBoard() }
      const sc = await this.loadScene(decor)
      if (this.dead) { sc?.s.dispose(); return }
      this.applyDecor(decor, env)
      this.mountScene(sc)
      this.updateScene(performance.now())
      // hide the first-frame shader compile: compile both cameras for the off-screen target, then fade in
      this.renderer.setRenderTarget(this.composer.readBuffer)
      this.decor.visible = true
      await this.renderer.compileAsync(this.scene, this.ortho)
      await this.renderer.compileAsync(this.scene, this.persp)
      this.renderer.setRenderTarget(null)
      if (this.dead) return
      this.warmUp() // still invisible: quality is decided here, once
      // sharp close-ups on capable GPUs: swap in the 4K scan, uploaded before the fade-in (decided once, here)
      const big = this.q.kaya4k && this.renderer.capabilities.maxTextureSize >= 4096 ? await kaya('_4k').catch(() => null) : null
      if (this.dead) return
      if (big) {
        for (const t of Object.values(maps)) t.dispose()
        setMaps(big)
        if (this.grounds.walnut) { this.grounds.walnut.map.dispose(); delete this.grounds.walnut }
        if (LOOKS[decor].ground === 'walnut') this.applyGround()
        for (const t of Object.values(big)) this.renderer.initTexture(t)
      }
      this.ready = true
      this.frame(performance.now())
      requestAnimationFrame(() => { this.canvas.style.opacity = '1' })
      if (this.opts.decor !== decor) void this.switchDecor()
    } catch (e) {
      console.error('Board3D: failed to start', e)
      this.fallback('webgl2')
    }
  }

  private fallback(r: FallbackReason) {
    if (this.fellBack) return
    this.fellBack = true
    this.onFallback(r)
  }

  private instant() { return this.reducedMotion.matches }

  /** The hour's light for a décor: "Auto" follows the clock and the season, the presets are fixed. */
  private todFor(decor: Decor): Tod {
    return this.opts.time === 'auto' ? seasonTod(this.clock, decor) : TOD[this.opts.time]
  }

  private applyOptions() {
    const cam = this.opts.camera === 'contemplation' ? 1 : 0
    if (cam !== this.camE) { this.camE = cam; this.hover = null; this.homeCamera(); this.placeFrame() }
    this.extrasOn()
    this.clock = now()
    clearInterval(this.autoTimer)
    // "Auto" follows the clock in steps too small to see (a fraction of a degree, a few kelvin), applied at once
    if (this.opts.time === 'auto') this.autoTimer = window.setInterval(() => { this.clock = now(); this.invalidate() }, AUTO_MS)
    this.hcK = this.opts.highContrast ? 1 : 0
    this.invalidate()
  }

  /**
   * Swaps the look under a crossfade: the current frame is kept, the change applied, its shaders compiled while the canvas
   * still shows the old frame, then the old frame fades out over the new one. Instant under reduced motion or before boot.
   */
  private async transition(change: () => void, ms = FADE_MS) {
    if (!this.ready || this.dead) { change(); return }
    const snap = this.instant() ? null : this.grabFrame()
    change()
    this.applyPendingQuality() // a step down the governor asked for lands under the fade, never on a still board
    this.holding = true
    const vis = this.decor.visible
    this.decor.visible = true
    try { await this.renderer.compileAsync(this.scene, this.camE ? this.persp : this.ortho) } finally { this.decor.visible = vis; this.holding = false }
    if (this.dead) { snap?.dispose(); return }
    this.endFade()
    if (snap) this.fade = { tex: snap, t0: performance.now(), ms }
    this.invalidate()
  }

  /** The current look, rendered now and copied off the canvas. */
  private grabFrame() {
    const r = this.renderer, size = r.getDrawingBufferSize(new THREE.Vector2()), tex = new THREE.FramebufferTexture(size.x, size.y)
    this.updateScene(performance.now()); this.render(); this.drawFade(performance.now())
    r.setRenderTarget(null)
    r.copyFramebufferToTexture(tex)
    return tex
  }

  private endFade() { this.fade?.tex.dispose(); this.fade = null }

  /** Draws the fading previous frame over the canvas; false once it has gone. */
  private drawFade(now: number) {
    const f = this.fade
    if (!f) return false
    const t = (now - f.t0) / f.ms
    if (t >= 1) { this.endFade(); return false }
    const r = this.renderer
    this.fadeMat.uniforms.map.value = f.tex; this.fadeMat.blendAlpha = 1 - t * t * (3 - 2 * t)
    r.setRenderTarget(null); r.autoClear = false
    r.render(this.fadeScene, this.ortho)
    r.autoClear = true
    return true
  }

  /** force: rebuild the scene of the same décor (the fx level changed). */
  private async switchDecor(force = false) {
    if (!this.ready) return // boot picks up opts.decor
    const job = ++this.decorJob, d = this.opts.decor
    const [env, sc] = await Promise.all([this.envFor(LOOKS[d].sky).then(t => t.texture), this.loadScene(d)])
    if (job !== this.decorJob || this.dead || (d === this.decorOn && !force)) { sc?.s.dispose(); return }
    await this.transition(() => { this.applyDecor(d, env); this.mountScene(sc) })
  }

  /** Builds the décor's scene off-screen (null: none, or fx 0); a failing scene leaves the décor without it. */
  private async loadScene(d: Decor, make?: () => Scene): Promise<Mounted | null> {
    const f = SCENES[d], fx = this.q.fx
    if ((!f && !make) || fx < 1) return null
    try {
      const s = make ? make() : (await f!()).default(), rec: Mounted = { s, g: new THREE.Group(), cookie: null, ground: null, lampColor: null, lampPose: null, env: null }
      const ctx: SceneCtx = {
        root: rec.g, renderer: this.renderer, key: this.key, base: this.base, fx: fx as 1 | 2, board: { BW: this.D.BW, BD: this.D.BD },
        setCookie: t => { rec.cookie = t; if (this.sceneOn === rec) this.shoji.map = t ?? this.shojiTex },
        setGround: g => { const old = rec.ground; rec.ground = g; if (this.sceneOn === rec) this.applyGround(); if (old && old !== g) freeGround(old) },
        lamp: this.lamp,
        setLampColor: c => { rec.lampColor = c; this.invalidate() },
        setEnvironment: tex => {
          rec.env?.dispose(); rec.env = null
          if (tex) { const pm = new THREE.PMREMGenerator(this.renderer); tex.mapping = THREE.EquirectangularReflectionMapping; rec.env = pm.fromEquirectangular(tex); pm.dispose() }
          if (this.sceneOn === rec) this.scene.environment = rec.env?.texture ?? this.decorEnv
        },
        setLampPose: (pos, target) => { rec.lampPose = pos ? { pos: pos.clone(), target: (target ?? new THREE.Vector3()).clone() } : null; this.invalidate() },
      }
      await s.build(ctx)
      return rec
    } catch (e) { console.error(`Board3D: the ${d} scene failed`, e); return null }
  }

  /** Swaps the mounted scene (inside transition()), freeing the previous one. */
  private mountScene(rec: Mounted | null) {
    const old = this.sceneOn
    this.scene.environment = rec?.env?.texture ?? this.decorEnv // a scene's own sky (a starfield) or the Look's
    if (old) { this.sceneRoot.remove(old.g); old.s.dispose(); if (old.ground) freeGround(old.ground); old.env?.dispose() }
    this.sceneOn = rec; this.ambT = 0; this.ambLast = 0
    if (rec) this.sceneRoot.add(rec.g)
    this.shoji.map = rec?.cookie ?? this.shojiTex
    this.applyGround()
  }

  /** A décor's ambient animation runs this frame (logic.ts ambientOn). */
  private ambient(busy: boolean) {
    return !!(this.sceneOn?.s.animated || this.kit.spec.animated) && ambientOn({
      animated: true, contemplation: this.camE > 0, fx: this.q.fx, visible: document.visibilityState === 'visible',
      focused: document.hasFocus(), reducedMotion: this.instant(), busy,
    })
  }

  /** PMREM environment for an HDRI (or three's RoomEnvironment), cached until a décor switch drops it. */
  private envFor(sky: string | null) {
    const k = sky ?? 'room'
    let e = this.envs.get(k)
    if (!e) {
      e = (async () => {
        const pm = new THREE.PMREMGenerator(this.renderer)
        try {
          if (!sky) { const room = new RoomEnvironment(), t = pm.fromScene(room, 0.04); room.dispose(); return t }
          const hdr = await new HDRLoader().loadAsync(`${this.base}${sky}_1k.hdr`)
          hdr.mapping = THREE.EquirectangularReflectionMapping
          const t = pm.fromEquirectangular(hdr)
          hdr.dispose()
          return t
        } finally { pm.dispose() }
      })()
      e.catch(() => this.envs.delete(k))
      this.envs.set(k, e)
    }
    return e
  }

  /** Ground maps, built on first use; after dispose() three re-uploads them from their canvas/image when needed again. */
  private groundMaps(g: Ground) {
    let m = this.grounds[g]
    if (m) return m
    const plane = 3200, tile = (t: THREE.Texture, mm: number, srgb = true) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(plane / mm, plane / mm)
      t.offset.x = 0.5 - ((0.5 * plane / mm) % 1) // a mat (or tile) centred under the board
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy())
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    if (g === 'walnut') { // the board's own scan, tiled across the table, grain running side to side
      const t = this.maps!.diff.clone()
      t.repeat.set(plane / KAYA_MM[0], plane / KAYA_MM[1]); t.rotation = Math.PI / 2
      m = { map: t }
    } else if (g === 'tatami') {
      const [c, h] = tatamiMaps()
      m = { map: tile(new THREE.CanvasTexture(c), TATAMI_MM), bump: tile(new THREE.CanvasTexture(h), TATAMI_MM, false) }
    } else m = { map: tile(new THREE.CanvasTexture(paperMap()), PAPER_MM) }
    return (this.grounds[g] = m)
  }

  /** The shoji's light cookie (linear): panes 1, kumiko bars fx.shojiBar, softened by the sun's size and the paper. */
  private paintShoji() {
    const cv = this.shojiTex.image as HTMLCanvasElement, S = cv.width, k = S / (2 * SHOJI_R), x = cv.getContext('2d')!
    const v = Math.round(255 * this.fx.shojiBar), bar = 16 * k, tmp = mkCanvas(S, S), t = tmp.getContext('2d')!
    t.fillStyle = '#fff'; t.fillRect(0, 0, S, S); t.fillStyle = `rgb(${v},${v},${v})`
    // yokoshige: wide panes, the horizontal kumiko close together; offset so bars cross the board off-centre
    for (let u = S / 2 + 70 * k; u > -bar; u -= 260 * k) t.fillRect(u - bar / 2, 0, bar, S)
    for (let u = S / 2 + 70 * k; u < S + bar; u += 260 * k) t.fillRect(u - bar / 2, 0, bar, S)
    for (let w = S / 2 + 45 * k; w > -bar; w -= 150 * k) t.fillRect(0, w - bar / 2, S, bar)
    for (let w = S / 2 + 45 * k; w < S + bar; w += 150 * k) t.fillRect(0, w - bar / 2, S, bar)
    x.filter = `blur(${(3 * k).toFixed(1)}px)`; x.drawImage(tmp, 0, 0); x.filter = 'none'
    this.shojiTex.needsUpdate = true
  }

  /** The share of the key coming through the shoji (Washitsu, Contemplation); a décor's own cookie needs its scene. */
  private shojiShare() {
    const L = LOOKS[this.decorOn ?? this.opts.decor]
    return !this.camE ? 0 : this.fx.shoji >= 0 ? this.fx.shoji : L.ownCookie && !this.sceneOn ? 0 : L.shoji
  }
  /** Contemplation's extras exist only while used; set inside transition() so their shaders compile before the fade. */
  private extrasOn() {
    this.vignette.visible = this.camE > 0 && this.fx.vignette > 0
    const on = this.shojiShare() > 0 && LOOKS[this.decorOn ?? this.opts.decor].lamp === 0
    const cast = on && this.governor.level < this.ladder.length - 2 // the two lowest levels skip its shadow pass
    if (this.shoji.visible !== on || this.shoji.castShadow !== cast) { this.shoji.visible = on; this.shoji.castShadow = cast; this.shoji.shadow.map?.dispose(); this.shoji.shadow.map = null }
  }

  /** The table's surface: the mounted scene's own ground (SceneCtx.setGround), or the Look's. */
  private applyGround() {
    const L = LOOKS[this.decorOn ?? this.opts.decor], sg = this.sceneOn?.ground, g = sg ? null : this.groundMaps(L.ground)
    Object.assign(this.tableMat, sg ? { map: sg.map, bumpMap: sg.bumpMap ?? null, bumpScale: 0.8, roughness: sg.roughness ?? L.rough } : { map: g!.map, bumpMap: g!.bump ?? null, bumpScale: 0.8, roughness: L.rough })
    this.tableMat.needsUpdate = true
  }

  private applyDecor(d: Decor, env: THREE.Texture) {
    const L = LOOKS[d]
    this.decorOn = d
    this.decorEnv = env; this.scene.environment = env
    this.applyGround()
    const lamp = L.lamp > 0
    if (this.key.castShadow === lamp) { this.key.castShadow = !lamp; this.key.shadow.map?.dispose(); this.key.shadow.map = null }
    if (this.lamp.castShadow !== lamp) { this.lamp.castShadow = this.lamp.visible = lamp; this.lamp.shadow.map?.dispose(); this.lamp.shadow.map = null }
    this.extrasOn()
    // free what the previous décor held on the GPU
    for (const [k, m] of Object.entries(this.grounds)) if (k !== L.ground) { m.map.dispose(); m.bump?.dispose() }
    const keep = L.sky ?? 'room'
    for (const [k, e] of this.envs) if (k !== keep) { this.envs.delete(k); void e.then(t => t.dispose(), () => {}) }
    this.invalidate()
  }

  /** Forced full renders, GPU-synchronised by a 1-pixel read-back: ms per frame. */
  private benchMs(n: number) {
    const gl = this.renderer.getContext(), px = new Uint8Array(4)
    this.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const t0 = performance.now()
    for (let k = 0; k < n; k++) { this.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px) }
    return (performance.now() - t0) / n
  }

  /** Startup and after a resize: measure, step down while over budget. Never steps up. */
  private warmUp() {
    this.updateScene(performance.now())
    while (this.governor.measured(this.benchMs(8))) this.applyQuality(this.ladder[this.governor.level])
    this.benchedPx = this.W * this.H
  }

  private applyPendingQuality() {
    if (!this.pendingQ) return
    this.pendingQ = false
    this.applyQuality(this.ladder[this.governor.level])
  }

  private applyQuality(q: Quality) {
    const prev = this.q
    this.q = q
    if (q.dpr !== prev.dpr) { this.renderer.setPixelRatio(q.dpr); this.composer.setPixelRatio(q.dpr); this.endFade() }
    if (q.shadow !== prev.shadow) for (const l of [this.key, this.lamp, this.shoji]) { const n = l === this.shoji ? q.shadow / 2 : q.shadow; l.shadow.mapSize.set(n, n); l.shadow.map?.dispose(); l.shadow.map = null }
    if (q.msaa !== prev.msaa) for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { rt.samples = q.msaa; rt.dispose() }
    if (q.bowlSegments !== prev.bowlSegments && this.N) this.buildBowls()
    if (q.fx !== prev.fx && (this.sceneOn || SCENES[this.opts.decor])) void this.switchDecor(true) // particles or not: the scene is built for its level
    this.extrasOn()
    this.invalidate()
  }

  /** Ghost, stopped and refused stones' materials, from the set's two materials. */
  private hintMats() {
    const { black, white } = this.kit
    this.ghostMats = { 1: ghostOf(black, 1), [-1]: ghostOf(white, -1) }
    this.pendingMats = { 1: pendingOf(black, 1), [-1]: pendingOf(white, -1) }
    this.tremMats = { 1: this.ghostMats[1].clone(), [-1]: this.ghostMats[-1].clone() }
  }

  /**
   * Swaps the stone set (opts.stones): new geometry and materials on the same layers, the old set's freed (its programs
   * go with its materials). Stones already down are fitted again with the new radii, in the order they were placed.
   * Called under transition(), so the new programs compile while the last frame is still shown.
   */
  private applyStones() {
    const old = this.kit, k = this.kit = stoneKit(this.opts.stones, this.hc, this.stoneTime, this.patinaU)
    if (k.spec === old.spec) { disposeKit(k); this.kit = old; return }
    const swap = (L: THREE.InstancedMesh, geo: THREE.BufferGeometry, mat: THREE.Material) => { L.geometry.dispose(); L.geometry = seeded(geo, L.instanceMatrix.count); L.material = mat }
    swap(this.layerB, k.geoB, k.black); swap(this.layerW, k.geoW, k.white)
    swap(this.dimB, k.geoB, k.blackDim); swap(this.dimW, k.geoW, k.whiteDim)
    swap(this.decorB, k.geoB, k.black); swap(this.decorW, k.geoW, k.white)
    for (const m of [...Object.values(this.ghostMats), ...Object.values(this.pendingMats), ...Object.values(this.tremMats)]) m.dispose()
    this.hintMats()
    for (const c of [1, -1] as const) { const m = this.markers[c]; m.geometry.dispose(); m.geometry = markerGeo((c === 1 ? k.geoB : k.geoW).userData.prof) }
    this.ghost.geometry = this.trem.geometry = k.geoB
    disposeKit(old)
    const N = this.N, placed = [...this.stones.entries()]
    this.stones.clear()
    for (const [p, s] of placed) {
      s.R = s.c === 1 ? k.spec.rB : k.spec.rW
      this.stones.set(p, s)
      if (p >= 0) settle(s, this.stones, N, gx(N, s.x), gz(N, s.y))
    }
    this.sound.tone = k.spec.snd
    if (this.N) this.buildBowls()
    this.buildLabels()
  }

  /* ---------- board, labels, bowls ---------- */

  private buildBoard() {
    this.applyPendingQuality() // a new board is a scene change
    const { BW, BD, N } = this.D
    if (this.board) { this.scene.remove(this.board); this.board.geometry.dispose() }
    const geo = new RoundedBoxGeometry(BW, BT, BD, 4, 2.2)
    // planar UVs at the scan's real density; the grain runs along the board's depth (player to player)
    const P = geo.attributes.position, Nn = geo.attributes.normal, uv = geo.attributes.uv
    const [U, V] = KAYA_MM
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = Math.abs(Nn.getX(i)), ny = Math.abs(Nn.getY(i))
      if (ny > 0.6) uv.setXY(i, 0.5 + z / U, 0.5 + x / V)                // top: fibres along z
      else if (nx > 0.6) uv.setXY(i, 0.5 + z / U, 0.5 + (y + 80) / V)     // long sides: fibres continue
      else uv.setXY(i, 0.5 + (y * 3) / U, 0.5 + x / V)                    // ends: end grain reads as fine vertical lines
    }
    this.board = new THREE.Mesh(geo, this.boardMat)
    this.board.position.y = -BT / 2; this.board.castShadow = true; this.board.receiveShadow = true
    this.scene.add(this.board)
    this.boardU.uLim.value = (N - 1) / 2
    this.boardU.uStep.value = hoshiStep(N)
    this.boardU.uFive.value = N < 19 ? 1 : 0
    // shadow frustum covers board + bowls
    const ext = BW / 2 + 260
    Object.assign(this.key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 600, far: 2800 })
    this.key.shadow.camera.updateProjectionMatrix()
    this.buildLabels()
    this.marksKey = ''; this.buildMarks()
    this.buildBowls()
    if (this.own) this.paintOwnership(this.own)
  }

  /** Coordinates, drawn in the board margin (only when enabled): small lacquered letters, readable from the player's side. */
  private buildLabels() {
    if (this.labels) { this.scene.remove(this.labels); this.labels.geometry.dispose(); (this.labels.material as THREE.MeshPhysicalMaterial).alphaMap?.dispose(); (this.labels.material as THREE.Material).dispose(); this.labels = null }
    if (!this.coords) return
    const { BW, BD, N } = this.D, k = 2048 / Math.max(BW, BD), cv = mkCanvas(Math.round(BW * k), Math.round(BD * k)), x = cv.getContext('2d')!
    x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height)
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'
    x.font = `600 ${(6.2 * k).toFixed(1)}px Manrope, system-ui, sans-serif`
    const px = (wx: number) => (wx + BW / 2) * k, pz = (wz: number) => (wz + BD / 2) * k
    const off = (this.kit.spec.rB + this.D.margin) / 2 + 0.6, dy = 6.2 * k * 0.06
    for (let i = 0; i < N; i++) {
      const col = COLS[i], row = String(N - i)
      x.fillText(col, px(gx(N, i)), pz(gz(N, 0) - off * (SZ / SX)) + dy)
      x.fillText(col, px(gx(N, i)), pz(gz(N, N - 1) + off * (SZ / SX)) + dy)
      x.fillText(row, px(gx(N, 0) - off), pz(gz(N, i)) + dy)
      x.fillText(row, px(gx(N, N - 1) + off), pz(gz(N, i)) + dy)
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.anisotropy = 4
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x1e1206, alphaMap: tex, transparent: true, opacity: 0.92, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
    this.labels = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD).rotateX(-Math.PI / 2), mat)
    this.labels.position.y = 0.02; this.labels.receiveShadow = true; this.labels.renderOrder = 1
    this.scene.add(this.labels)
  }

  /** The trainer's veil and lettered markers: one unlit plane over the board, repainted only when they change. */
  private buildMarks() {
    const s = this.state, key = s?.marks?.length || s?.focus || s?.frame ? JSON.stringify([s.marks, s.focus, s.frame, this.N, this.coords]) : ''
    if (key === this.marksKey) return
    this.marksKey = key
    if (this.marks) { this.scene.remove(this.marks); this.marks.geometry.dispose(); (this.marks.material as THREE.MeshBasicMaterial).map?.dispose(); (this.marks.material as THREE.Material).dispose(); this.marks = null }
    if (!key || !s) return
    const { BW, BD, N } = this.D, k = 2048 / Math.max(BW, BD), cv = mkCanvas(Math.round(BW * k), Math.round(BD * k))
    paintMarks(cv.getContext('2d')!, i => (gx(N, i) + BW / 2) * k, j => (gz(N, j) + BD / 2) * k, SX * k, s.marks, s.focus, cv.width, cv.height, 0.1, s.frame, 0.9) // unlit over a lit board: a lighter veil reads the same; the frame, stronger, holds on warm wood
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    this.marks = new THREE.Mesh(new THREE.PlaneGeometry(BW, BD).rotateX(-Math.PI / 2), mat)
    this.marks.position.y = 0.04; this.marks.renderOrder = 2
    this.scene.add(this.marks)
  }

  private buildBowls() {
    for (const b of this.bowls) { this.decor.remove(b); b.geometry.dispose() }
    this.bowls = []
    const { BW, BD } = this.D, bx = BW / 2 + 112, seg = this.q.bowlSegments
    // the player sits at +z: Black's bowl to the right, White's across the board
    // the stones at rest are dropped once, in order, onto the bowl's fill and the lid's dish: nothing interpenetrates
    const lidY = (d: number) => d < 31 ? 5 + d / 31 : 6 + (d - 31) * 7 / 19
    const sp = this.kit.spec, SH = sp.shBot // a stone resting flat has its girdle this high
    const heap = (c: Sign) => {
      const R = c === 1 ? sp.rB : sp.rW, r = rng(c === 1 ? 11 : 23)
      // a hidden bed first, so the gaps of the visible layer show stones rather than the bottom of the bowl
      return dropStones([...bowlHeap(R, 43, 0, r), ...bowlHeap(R, 40, 6, r)], R, sp, d => 50 + SH + 2.5 * (1 - (d / 43) ** 2), r, 0.12, 50 + 2.5 * (sp.shTop + sp.shBot) + 2)
    }
    const pile = (prisoner: Sign) => {
      const R = prisoner === 1 ? sp.rB : sp.rW, r = rng(prisoner === 1 ? 5 : 17)
      // a loose sunflower inside the flat of the dish; past ~8 stones they start resting on each other
      const pts = Array.from({ length: 60 }, (_, k) => { const a = k * 2.39996 + r(), d = 12.6 * Math.sqrt(k % 8) + r() * 2; return [Math.cos(a) * d, Math.sin(a) * d] })
      return dropStones(pts, R, sp, d => Math.max(lidY(d) + SH, lidY(d + R) + 0.3), r, 0.08)
    }
    this.sets = [
      { c: 1, bowl: [bx, BD * 0.3], lid: [bx - 4, BD * 0.3 - 145], heap: heap(1), lidRest: pile(-1) },
      { c: -1, bowl: [-bx, -BD * 0.3], lid: [-bx + 4, -BD * 0.3 + 145], heap: heap(-1), lidRest: pile(1) },
    ]
    const bowl = lathe(BOWL_PROFILE, seg), lid = lathe(LID_PROFILE, seg)
    for (const S of this.sets) {
      const b = new THREE.Mesh(bowl, this.bowlMat), l = new THREE.Mesh(lid, this.bowlMat)
      b.position.set(S.bowl[0], -BT, S.bowl[1]); l.position.set(S.lid[0], -BT, S.lid[1])
      for (const m of [b, l]) { m.castShadow = m.receiveShadow = true; this.decor.add(m); this.bowls.push(m) }
    }
    this.decorKey = ''
  }

  private prisoners(owner: Sign) {
    const c = this.state?.captures
    let n = c ? (owner === 1 ? c.black : c.white) : this.capCount[owner]
    // the app's count already includes stones still waiting under a falling stone
    if (c) for (const s of this.stones.values()) if (!s.landed && s.c === owner) n -= s.captured.length
    return Math.max(0, n)
  }

  private updateDecor() {
    const nb = this.prisoners(1), nw = this.prisoners(-1), key = `${nb}|${nw}|${this.N}|${this.coords}|${this.q.bowlSegments}`
    if (key === this.decorKey) return
    this.decorKey = key
    let ib = 0, iw = 0
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), v = new THREE.Vector3(), ax = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    const add = (c: Sign, p: Rest, ox: number, oz: number, k: number) => {
      const L = c === 1 ? this.decorB : this.decorW, i = c === 1 ? ib++ : iw++
      if (i >= 120) return
      const h = ((Math.sin((k + 1) * 12.9898 + c * 78.233) * 43758.5453) % 1 + 1) % 1
      // spin, then dip towards p.dir (axis = up × dir)
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, h * 6.283).premultiply(q2.setFromAxisAngle(ax.set(Math.sin(p.dir), 0, -Math.cos(p.dir)), p.tilt))
      m.compose(v.set(ox + p.x, -BT + p.y, oz + p.z), q, one)
      L.setMatrixAt(i, m); (L.geometry.attributes.aSeed.array as Float32Array)[i] = h
    }
    for (const S of this.sets) {
      S.heap.forEach((p, k) => add(S.c, p, S.bowl[0], S.bowl[1], k))
      const n = Math.min(S.c === 1 ? nb : nw, 60)
      for (let k = 0; k < n; k++) add(-S.c as Sign, S.lidRest[k], S.lid[0], S.lid[1], 200 + k) // prisoners on the lid
    }
    this.decorB.count = Math.min(ib, 120); this.decorW.count = Math.min(iw, 120)
    for (const L of [this.decorB, this.decorW]) { L.instanceMatrix.needsUpdate = true; L.geometry.attributes.aSeed.needsUpdate = true }
  }

  /* ---------- stones ---------- */

  private mkStone(p: number, c: Sign): Stone {
    const N = this.N, x = p % N, y = (p / N) | 0, j = jitter(N, x, y, ++this.moveNo)
    const s: Stone = { p, x, y, c, R: c === 1 ? this.kit.spec.rB : this.kit.spec.rW, jx: j.jx, jz: j.jz, tx: j.jx, tz: j.jz, seed: j.seed, rotY: j.rotY, t0: -1e9, landed: true, captured: [] }
    this.stones.set(p, s)
    settle(s, this.stones, N, gx(N, x), gz(N, y)) // around the stones already down, which never move
    return s
  }

  private animateDrop(s: Stone, now: number) {
    if (this.instant()) { this.contact(s); return }
    s.t0 = now; s.landed = false; s.still = false
  }

  /** Diffs the position against the stones on the board: a single new stone with removed opponents is a move with captures. */
  private reconcile(state: Board3DState) {
    const N = this.N, now = performance.now(), added: Stone[] = [], removed: Stone[] = []
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x, cur = this.stones.get(p)
      if (cur && cur.c !== state.signMap[y][x]) { this.stones.delete(p); removed.push(cur) }
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = y * N + x, c = state.signMap[y][x]
      if (c && !this.stones.has(p)) added.push(this.mkStone(p, c))
    }
    if (!added.length && !removed.length) return
    const pd = this.pendingDrop && now - this.pendingDrop.at < 1500 ? this.pendingDrop : null
    const move = added.length === 1 && removed.every(r => r.c === -added[0].c) ? added[0] : null
    if (move && pd && pd.p === move.p && pd.c === move.c) {
      this.pendingDrop = null
      move.captured = removed
      for (const r of removed) this.stones.set(-1 - r.p, r) // still on the board until the new stone lands
      this.animateDrop(move, now)
      return
    }
    // navigation, undo, setup, or a move whose drop() comes later: settle at once (an interrupted drop lands now)
    for (const [k, s] of this.stones) if (k < 0) this.stones.delete(k); else if (!s.landed) { s.landed = true; s.captured = []; s.still = true }
    this.recent = move ? { p: move.p, c: move.c, list: removed, at: now } : null
    if (move && removed.length && !this.state?.captures) this.capCount[move.c] += removed.length
    if (state.signMap.every(r => r.every(c => !c))) this.capCount = { 1: 0, [-1]: 0 }
  }

  /** The stone touches the board: its captures vanish (onto the capturer's lid in Contemplation), with sound. */
  private contact(s: Stone) {
    s.landed = true
    const caps = s.captured
    s.captured = []
    for (const r of caps) this.stones.delete(-1 - r.p)
    if (caps.length && !this.state?.captures) this.capCount[s.c] += caps.length
    if (this.state?.sound) {
      this.sound.stone(this.N, s.x)
      if (caps.length) this.sound.capture(caps.length, this.N, s.c === 1 ? this.N - 1 : 0, 0.09)
    }
  }

  private _m = new THREE.Matrix4(); private _q = new THREE.Quaternion()
  private _v = new THREE.Vector3(); private _s = new THREE.Vector3(1, 1, 1)

  private updateStones(now: number): boolean {
    let busy = false, nb = 0, nw = 0, db = 0, dw = 0, na = 0
    const s0 = this.state, N = this.N, own = this.own, counting = s0?.counting, last = s0?.last, SH = this.kit.spec.shBot, TOP = SH + this.kit.spec.shTop
    const lastP = last ? last[1] * N + last[0] : -1
    this.markers[1].visible = this.markers[-1].visible = false
    const put = (s: Stone, y: number, aoA: number, aoS: number, dim: boolean, sx: number, sz: number) => {
      const { _m, _q, _v, _s } = this
      _m.compose(_v.set(sx, SH + y, sz), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, s.rotY), _s.setScalar(1))
      const L = dim ? (s.c === 1 ? this.dimB : this.dimW) : s.c === 1 ? this.layerB : this.layerW
      const i = dim ? (s.c === 1 ? db++ : dw++) : s.c === 1 ? nb++ : nw++
      if (i >= 400) return
      L.setMatrixAt(i, _m); (L.geometry.attributes.aSeed.array as Float32Array)[i] = s.seed
      if (s.p === lastP && this.stones.get(lastP) === s && s.landed && !dim) {
        const mk = this.markers[s.c as 1 | -1]; mk.matrix.copy(_m); mk.visible = true
      }
      if (aoA > 0 && na < 420) {
        const q = s.R * 2 * AO_K * aoS, black = s.c === 1
        _m.compose(_v.set(sx, 0, sz), _q.identity(), _s.set(q, 1, q))
        this.ao.setMatrixAt(na, _m); this.ao.instanceColor!.setXYZ(na++, aoA * (black ? AO_PEAK_BLACK : AO_PEAK_WHITE), aoA * (black ? AO_LINE_BLACK : AO_LINE_WHITE), 1)
      }
    }
    for (const s of this.stones.values()) {
      // the only motion: the new stone's last 12 mm, its shadow tightening as it comes down, then a 1 mm slide into place
      const P = dropPose(now - s.t0), a = s.seed * 43.98 // a direction of its own per stone
      if (!s.landed && now - s.t0 >= DROP_MS) this.contact(s)
      const y = s.landed ? 0 : P.y, k = s.landed ? 1 : P.k, sl = s.still ? 0 : s.landed ? P.slide * SLIDE_MM : SLIDE_MM
      if (!s.landed || sl > 0) busy = true
      let dim = false
      if (s.p >= 0 && counting?.dead[s.y]?.[s.x]) dim = true
      else if (s.p >= 0 && own && Math.sign(own[s.p]) === -s.c && sstep(0.4, 0.9, Math.abs(own[s.p])) > 0.5) dim = true // KataGo expects it captured
      put(s, y, dim ? 0.6 : 0.25 + 0.75 * k, 1.45 - 0.45 * k, dim, s.tx + sl * Math.cos(a), s.tz + sl * Math.sin(a))
    }
    this.layerB.count = nb; this.layerW.count = nw; this.dimB.count = db; this.dimW.count = dw; this.ao.count = na
    for (const L of [this.layerB, this.layerW, this.dimB, this.dimW]) { L.instanceMatrix.needsUpdate = true; L.geometry.attributes.aSeed.needsUpdate = true }
    this.ao.instanceMatrix.needsUpdate = true; this.ao.instanceColor!.needsUpdate = true

    // counting: territory tiles (on dead stones too, lifted above them)
    const t1 = this.terr[1], t2 = this.terr[-1]
    let n1 = 0, n2 = 0
    if (counting) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = counting.territory[y]?.[x]
      if (!o) continue
      const lift = s0!.signMap[y][x] ? TOP + 0.8 : 0.6
      this._m.makeTranslation(gx(N, x), lift, gz(N, y))
      if (o === 1) t1.setMatrixAt(n1++, this._m); else t2.setMatrixAt(n2++, this._m)
    }
    t1.count = n1; t2.count = n2; t1.instanceMatrix.needsUpdate = t2.instanceMatrix.needsUpdate = true

    // hover ghost, or the half-tone stone the mentor stopped (the board is not interactive then)
    const st = s0, p = st?.pending, h = p?.v ?? this.hover, sign = p?.sign ?? st?.toPlay
    const ok = !!(h && st && (p || st.interactive && !st.counting && !st.signMap[h[1]]?.[h[0]]) && this.ready)
    this.ghost.visible = ok
    if (ok && st && h) {
      this.ghost.geometry = sign === 1 ? this.kit.geoB : this.kit.geoW
      this.ghost.material = (p ? this.pendingMats : this.ghostMats)[sign === 1 ? 1 : -1]
      this.ghost.position.set(gx(N, h[0]), SH, gz(N, h[1]))
    }
    const w = this.shook, wk = w ? (now - w.t0) / SHAKE_MS : 1
    this.trem.visible = !!w && wk < 1 && !st?.signMap[w.v[1]]?.[w.v[0]]
    if (w && this.trem.visible) {
      const m = this.tremMats[w.c === 1 ? 1 : -1], dx = this.instant() ? 0 : Math.sin(wk * Math.PI * 8) * 2.4 * (1 - wk)
      m.opacity = 0.92 * (1 - sstep(0.45, 1, wk))
      this.trem.geometry = w.c === 1 ? this.kit.geoB : this.kit.geoW; this.trem.material = m
      this.trem.position.set(gx(N, w.v[0]) + dx, SH, gz(N, w.v[1]))
      busy = true
    } else this.shook = null
    return busy
  }

  /* ---------- "Ombre et lumière": the ownership cookie ---------- */

  private paintOwnership(own: number[]) {
    const N = this.N, OW = this.owCanvas.width, x = this.owCanvas.getContext('2d')!
    this.spot.updateMatrixWorld(); this.spot.target.updateMatrixWorld(); this.spot.shadow.updateMatrices(this.spot)
    const M = this.spot.shadow.matrix, v = new THREE.Vector4()
    const uv = (wx: number, wz: number): [number, number] => { v.set(wx, 0, wz, 1).applyMatrix4(M); return [v.x / v.w * OW, (1 - v.y / v.w) * OW] }
    const tmp = mkCanvas(OW, OW), t = tmp.getContext('2d')!
    // off-board: neutral level falling off to darkness so the cone never shows a hard edge
    const rg = t.createRadialGradient(OW / 2, OW / 2, OW * 0.3, OW / 2, OW / 2, OW / 2)
    rg.addColorStop(0, 'rgb(77,70,59)'); rg.addColorStop(1, 'rgb(0,0,0)')
    t.fillStyle = rg; t.fillRect(0, 0, OW, OW)
    const hx = SX * 0.52, hz = SZ * 0.52
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = own[j * N + i], s = Math.sign(o) * Math.pow(Math.abs(o), 0.5)
      const l = s > 0 ? 0.3 * (1 - s) : 0.3 + 0.7 * -s // +1 Black => shadow, -1 White => full warm light, 0 => neutral
      t.fillStyle = `rgb(${(255 * l) | 0},${(232 * l) | 0},${(196 * l) | 0})`
      t.beginPath() // the light looks down obliquely, so each cell projects to an arbitrary quad (slightly padded)
      for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) t.lineTo(...uv(gx(N, i) + dx, gz(N, j) + dz))
      t.fill()
    }
    x.clearRect(0, 0, OW, OW)
    x.filter = `blur(${((OW * SX) / (this.D.BW * 1.7) * 0.42).toFixed(1)}px)`
    x.drawImage(tmp, 0, 0); x.filter = 'none'
    this.owTex.needsUpdate = true
  }

  /* ---------- cameras ---------- */

  /** Study is fixed; Contemplation follows its orbit. Both depend on the board and frame sizes (the view offset places the frame in the canvas). */
  private placeCameras() {
    const { BW, BD } = this.D, a = this.fr.w / this.fr.h, hs = Math.max(BD * 1.1, (BW * 1.1) / Math.max(0.4, a)), o = this.ortho
    o.top = hs / 2; o.bottom = -hs / 2; o.left = (-hs / 2) * a; o.right = (hs / 2) * a; o.updateProjectionMatrix()
    this.seatH = seatHeight(BW, BD, a); this.persp.aspect = a
    const tm = LOOKS[this.decorOn ?? this.opts.decor].tiltMax
    this.orbitGoal = clampOrbit(this.orbitGoal, this.seatH, BW, BD, tm)
    this.orbit = clampOrbit(this.orbit, this.seatH, BW, BD, tm)
    this.placePersp(this.orbit)
  }

  /** Frames the board in the box, shifted right so that at the view's home framing it sits on the window's centre
   *  (centreShift). On resize, view and board changes only: turning or zooming the seated camera keeps the frame. */
  private placeFrame() {
    const b = this.box, { BW, BD } = this.D, cam = this.activeCam(), v = new THREE.Vector3()
    const offset = () => {
      const fr = this.fr, W = this.W, H = this.H
      for (const c of [this.ortho, this.persp]) c.setViewOffset(fr.w, fr.h, -fr.x, -fr.y, W, H)
      this.vigU.uVigC.value.set(((fr.x + fr.w / 2) / W) * 2 - 1, 1 - ((fr.y + fr.h / 2) / H) * 2); this.vigU.uVigS.value.set(fr.w / W, fr.h / H)
    }
    this.fr = { ...b }; offset(); this.placeCameras(); this.placePersp(HOME); cam.updateMatrixWorld()
    let l = Infinity, r = -Infinity // the goban's extent on screen (not the bowls)
    for (const x of [-BW / 2, BW / 2]) for (const y of [0, -BT]) for (const z of [-BD / 2, BD / 2]) {
      const px = ((v.set(x, y, z).project(cam).x + 1) / 2) * this.W
      l = Math.min(l, px); r = Math.max(r, px)
    }
    const s = centreShift(l, r, b.x + b.w, this.W / 2)
    this.fr.x = b.x + s; offset(); this.placePersp(this.orbit)
    if (s !== this.shift) { this.shift = s; this.onShift(s) }
  }

  private placePersp(o: Orbit) {
    const p = this.persp, { eye, target, up, dist } = orbitEye(o, this.seatH)
    p.position.fromArray(eye); p.up.fromArray(up)
    p.near = Math.max(5, dist - 1200); p.far = dist + 2500
    p.lookAt(target[0], target[1], target[2]); p.updateProjectionMatrix(); p.updateMatrixWorld() // picking reads it before the next render
  }

  private activeCam() { return this.camE ? this.persp : this.ortho }

  private pick(e: MouseEvent): Vertex | null {
    if (!this.ready || !this.N) return null
    const r = this.canvas.getBoundingClientRect(), ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.ray.setFromCamera(ndc, this.activeCam())
    if (this.camE) { const { origin: o, direction: d } = this.ray.ray; return pickPoint([o.x, o.y, o.z], [d.x, d.y, d.z], this.N, this.stones, this.kit.spec) }
    const hit = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.kit.spec.shBot), new THREE.Vector3())
    if (!hit) return null
    const N = this.N, i = Math.round(hit.x / SX + (N - 1) / 2), j = Math.round(hit.z / SZ + (N - 1) / 2)
    if (i < 0 || j < 0 || i >= N || j >= N) return null
    if (Math.abs(hit.x - gx(N, i)) > SX * 0.5 || Math.abs(hit.z - gz(N, j)) > SZ * 0.5) return null
    return [i, j]
  }

  /* ---------- frame loop (render on demand) ---------- */

  private invalidate() { this.ambWait = false; if (!this.raf && !this.dead) this.raf = requestAnimationFrame(t => this.frame(t)) }

  private updateScene(now: number): boolean {
    let busy = false
    this.placeCameras()
    this.decor.visible = this.camE > 0
    if (this.decor.visible) this.updateDecor()
    // ombre et lumière
    const ot = Math.min(1, (now - this.ombreT0) / OMBRE_MS)
    this.ombreK = lerp(this.ombreFrom, this.ombreOn ? 1 : 0, easeIO(ot))
    if (ot < 1) busy = true
    const dk = this.decorOn ?? this.opts.decor, L = LOOKS[dk], tod = L.tod ?? this.todFor(dk), ok = this.ombreK, ce = this.camE
    const az = THREE.MathUtils.degToRad(tod.az), el0 = THREE.MathUtils.degToRad(tod.el)
    // Study keeps the hour's colour and direction but never lets the sun rake so low that stones shade their neighbours
    const el = lerp(Math.max(el0, THREE.MathUtils.degToRad(22)), el0, ce), lift = lerp(Math.min(1.15, Math.sin(el0) / Math.sin(el) * 1.25), 1, ce)
    this.key.position.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(1600)
    // contact shadow away from the window, reaching further when the sun is low (lean in radii)
    this.aoU.uAoDir.value.set(-Math.cos(az), -Math.sin(az))
    this.aoU.uAoLean.value = THREE.MathUtils.clamp(AO_LEAN * (this.kit.spec.shTop + this.kit.spec.shBot) / 2 / Math.tan(el), AO_LEAN_MIN, AO_LEAN_MAX) / this.kit.spec.rW
    const keyI = tod.I * lift * L.key * lerp(1, 0.2, ok), sj = this.shoji.visible ? this.shojiShare() : 0
    this.key.color.copy(kelvin(tod.K)); this.key.intensity = keyI * (1 - sj)
    if (sj) { // through the shoji, from far out on the key's bearing (it follows the hour): panes as bright as before, bars darker
      this.shoji.position.copy(this.key.position).setLength(SHOJI_MM); this.shoji.color.copy(this.key.color); this.shoji.intensity = keyI * sj
    }
    if (L.lamp) { // Lanterne: the lamp hangs on the same bearing, closer, its cone pooling over board and bowls
      const pose = this.sceneOn?.lampPose, sc = this.lamp.shadow.camera
      if (pose) { this.lamp.position.copy(pose.pos); this.lamp.target.position.copy(pose.target) } // a scene's own lamp (an andon on the floor)
      else { this.lamp.position.copy(this.key.position).setLength(1250); this.lamp.target.position.set(0, 0, 0) }
      const d = this.lamp.position.distanceTo(this.lamp.target.position), near = pose ? Math.max(20, d - 800) : 500, far = pose ? d + 1400 : 2600
      if (sc.near !== near || sc.far !== far) { sc.near = near; sc.far = far; sc.updateProjectionMatrix() }
      this.lamp.color.copy(this.sceneOn?.lampColor ?? kelvin(tod.K))
      this.lamp.intensity = L.lamp * 1e6 * lerp(1, 0.25, ok)
    }
    this.scene.environmentIntensity = lerp(Math.max(tod.env, 0.5), tod.env, ce) * L.ibl * lerp(1, 0.35, ok)
    // three samples the sky at azimuth + rotation: this brings the sky's bright side round to the key's (Lanterne: the lamp's) bearing
    this.scene.environmentRotation.y = L.skyAz - az
    this.renderer.toneMappingExposure = tod.exp * L.exp
    this.spot.intensity = 5.5 * ok; this.spot.color.copy(kelvin(lerp(tod.K, 3600, 0.5)))
    // Study damps reflections for readability; high contrast darkens the wood a little and calms the shell
    const c = ce, hc = this.hcK
    // the room: Study keeps the app's linen; Contemplation clears to a warm dark room, darker in the evening
    // (the clear colour skips tone mapping but is sRGB-encoded twice on its way out: these land near #150d0a in the evening, #32261c by day)
    this.roomColor.setRGB(0.0003 + 0.0022 * tod.room, 0.0002 + 0.0013 * tod.room, 0.00015 + 0.00075 * tod.room)
    // other décors draw their ground in Study too (tatami, paper, the lamp-lit table)
    const linen = L.linen && !c
    this.renderer.setClearColor(this.roomColor, linen ? 0 : 1)
    const sg = this.sceneOn?.ground
    if (sg) { this.tableMat.color.setScalar(sg.tint ?? 1); this.tableMat.envMapIntensity = 1 }
    else if (L.ground === 'walnut') { this.tableMat.color.setRGB(0.1, 0.064, 0.048).multiplyScalar((0.45 + 0.55 * tod.room) * L.tint); this.tableMat.envMapIntensity = 0.2 + 0.4 * tod.room } // no bright grazing sheen in the dark
    else { this.tableMat.color.setScalar(L.tint); this.tableMat.envMapIntensity = 1 }
    this.tableMat.visible = !linen
    // the fade into the room only where it's wanted: otherwise the alpha map is sampled in its opaque middle
    const fa = this.tableMat.alphaMap!, fade = L.fade && c
    fa.repeat.setScalar(fade ? 1 : 0.1); fa.offset.setScalar(fade ? 0 : 0.45)
    this.shadowFloor.visible = linen
    // Study on the linen: the floor rises so the board's shadow keeps the key's true direction yet never reaches the frame edge
    // (a frame narrower than the board, m ≤ 0, keeps the default floor)
    const { BW, BD } = this.D, mx = this.ortho.right - BW / 2, mz = this.ortho.top - BD / 2, m = Math.min(mx, mz), raise = linen && m > 0
    const fh = !raise ? BT : Math.min(BT, FLOOR_MARGIN * Math.tan(el) * Math.min(mx / Math.abs(Math.cos(az)), mz / Math.abs(Math.sin(az))))
    this.ground.position.y = -fh
    this.ground.getObjectByName('under')!.scale.set(raise ? BW + 1.6 * m : BW * 1.3, 1, raise ? BD + 1.6 * m : BD * 1.3)
    // softer, lighter shadows in the room (a window, not a flash)
    for (const l of [this.key, this.lamp, this.shoji]) { l.shadow.radius = lerp(5, 9, c) * L.soft; l.shadow.intensity = lerp(CAST_STUDY, CAST_ROOM, c) * L.shade }
    this.shoji.shadow.radius *= this.key.shadow.camera.right / (2 * SHOJI_R) // radius is in texels: the same penumbra as the key's in mm
    this.hc.value = hc
    // relative to each material's own clear coat (userData.coat): the Japanese set's 0.28 / 0.5 / 0.1 shell and 0.18 / 0.3 / 0.08 slate
    const K = this.kit
    for (const m of [K.white, K.whiteDim]) { const b = m.userData.coat; m.clearcoat = lerp(lerp(b * 0.56, b, c), b * 0.2, hc); m.envMapIntensity = lerp(0.75, 1, c) }
    for (const m of [K.black, K.blackDim]) { const b = m.userData.coat; m.clearcoat = lerp(lerp(b * 0.6, b, c), b * 0.08 / 0.3, hc); m.envMapIntensity = lerp(0.6, 1, c) }
    this.boardMat.color.copy(this.woodTone).multiplyScalar(lerp(1, 0.88, hc))
    this.boardMat.normalScale.setScalar(lerp(0.6, 0.25, hc))
    this.boardU.uHalf.value = this.noGrid ? 0 : lerp(0.5, 0.62, hc)
    this.boardU.uRelief.value = this.fx.relief * c; this.boardU.uWobble.value = this.fx.wobble * c
    this.boardU.uInkRough.value = lerp(0.45, this.fx.inkRough, c); this.boardU.uPatina.value = this.fx.patina * c
    this.vigU.uVig.value = this.fx.vignette
    // Contemplation's décor effects: the scene, and the HDRI behind the room (Look.backdrop)
    const fxOn = ce > 0 && this.q.fx >= 1, bd = fxOn ? L.backdrop : undefined
    this.sceneRoot.visible = fxOn
    this.scene.background = bd ? this.scene.environment : null
    if (bd) { this.scene.backgroundBlurriness = bd.blur; this.scene.backgroundIntensity = bd.intensity; this.scene.backgroundRotation.y = this.scene.environmentRotation.y }
    if (this.updateStones(now)) busy = true
    return busy
  }

  private camOverride: THREE.PerspectiveCamera | null = null // debug close-up
  private render(cam: THREE.Camera = this.camOverride ?? this.activeCam()) {
    ;(this.composer.passes[0] as RenderPass).camera = cam
    this.composer.render()
  }

  private frame(now: number) {
    cancelAnimationFrame(this.raf); this.raf = 0
    if (this.dead || !this.ready || this.holding) return
    // only the décor's animation wants this frame, and its next one isn't due yet (≤ AMBIENT_FPS): wait for a later vsync
    if (this.ambWait && now - this.ambLast < 1000 / AMBIENT_FPS - 4) { this.raf = requestAnimationFrame(t => this.frame(t)); return }
    this.ambWait = false
    const moving = this.camE > 0 && stepOrbit(this.orbit, this.orbitGoal, this.lastFrame ? now - this.lastFrame : 16, this.instant())
    let busy = this.updateScene(now) || moving
    // camera frames are paced by the hand, not the GPU, and the governor never steps back up: they are not sampled
    if (busy && !moving && this.lastFrame && !this.pendingQ) {
      const r = this.governor.sample(now - this.lastFrame)
      if (r === 'down') this.pendingQ = true // applied under the next crossfade, resize or new board
      else if (r === 'fallback') this.fallback('slow')
    }
    // the décor's animation: only on otherwise still frames, which the governor never samples
    const amb = this.ambient(busy || !!this.fade)
    if (amb) { const dt = this.ambLast ? Math.min(now - this.ambLast, 100) / 1000 : 0; this.ambT += dt; this.sceneOn?.s.update(dt, this.ambT); this.stoneTime.value = this.ambT; this.ambLast = now } else this.ambLast = 0
    this.render()
    if (this.drawFade(now)) busy = true
    this.lastFrame = busy ? now : 0
    if (busy) this.invalidate()
    else if (amb) { this.ambWait = true; this.raf = requestAnimationFrame(t => this.frame(t)) }
  }

  /** The board's frame as the camera shows it, animations settled, at a pixel ratio of at least 2, signed; null until ready. */
  async snapshot(): Promise<Blob | null> {
    await signatureFonts()
    if (!this.ready || this.dead || this.holding) return null
    const r0 = this.renderer.getPixelRatio(), r = Math.max(2, r0), up = r !== r0
    if (up) { this.renderer.setPixelRatio(r); this.composer.setPixelRatio(r) }
    this.updateScene(performance.now() + 1e5)
    this.render()
    // the drawing buffer isn't preserved: copy it in the task that drew it; restoring re-renders before the page is composited
    const c = cropRect(this.fr, this.W, this.H, r), out = c && postcardCanvas(this.canvas, c)
    if (up) { this.renderer.setPixelRatio(r0); this.composer.setPixelRatio(r0); this.render() }
    this.invalidate()
    return out ? toPng(out) : null
  }

  /* ---------- dev helpers (demo page, measurements, screenshots) ---------- */

  /** Not part of the app contract: used by board3d.html to measure contrast and frame time. */
  get debug() {
    const self = this
    return {
      get quality() { return { level: self.governor.level, ...self.q } },
      /** CSS-pixel position of an intersection (stone top). */
      project(i: number, j: number, y = self.kit.spec.shBot + self.kit.spec.shTop) {
        const v = new THREE.Vector3(gx(self.N, i), y, gz(self.N, j)).project(self.activeCam())
        return [((v.x + 1) / 2) * self.W, ((1 - v.y) / 2) * self.H]
      },
      /** Stones on the board as drawn: CSS-pixel centre (girdle height) and radius, colour. */
      stones() {
        const cam = self.activeCam(), v = new THREE.Vector3(), css = () => [((v.x + 1) / 2) * self.W, ((1 - v.y) / 2) * self.H]
        return [...self.stones.entries()].filter(([k]) => k >= 0).map(([, s]) => {
          const SH = self.kit.spec.shBot, [x, y] = (v.set(s.tx, SH, s.tz).project(cam), css()), [x2] = (v.set(s.tx + s.R, SH, s.tz).project(cam), css())
          return { x, y, r: x2 - x, c: s.c }
        })
      },
      /** Renders now (all animations settled) and reads back sRGB pixels at CSS coordinates. */
      sample(points: number[][]) {
        self.updateScene(performance.now() + 1e5)
        self.render()
        const gl = self.renderer.getContext(), px = new Uint8Array(4), r = self.renderer.getPixelRatio(), out: number[][] = []
        for (const [x, y] of points) { gl.readPixels(Math.round(x * r), Math.round((self.H - y) * r), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); out.push([...px]) }
        return out
      },
      /** Forced full renders, GPU-synchronised by a 1-pixel read-back. */
      bench(n = 60) {
        const msPerFrame = self.benchMs(n), info = self.renderer.info
        return { msPerFrame, dpr: self.renderer.getPixelRatio(), size: [self.W, self.H], calls: info.render.calls, triangles: info.render.triangles, textures: info.memory.textures, geometries: info.memory.geometries }
      },
      /** Contemplation's camera, at once (null: home). */
      orbit(o: Partial<Orbit> | null) { self.orbitGoal = { ...HOME, ...o }; self.orbit = { ...self.orbitGoal }; self.placeCameras(); self.invalidate() },
      /** The intersection a click at CSS (x, y) of the canvas would play. */
      pickAt(x: number, y: number) { const r = self.canvas.getBoundingClientRect(); return self.pick({ clientX: r.left + x, clientY: r.top + y } as MouseEvent) },
      /** Realism tunables, live (see FX). */
      tune(o: Partial<typeof FX>) { const bar = self.fx.shojiBar; Object.assign(self.fx, o); if (self.fx.shojiBar !== bar) self.paintShoji(); self.extrasOn(); self.invalidate(); return { ...self.fx } },
      hideGrid(on: boolean) { self.noGrid = on; self.invalidate() },
      setQuality(level: number) { self.governor.level = level; self.applyQuality(self.ladder[level]) },
      /** Mounts a scene factory on the current décor (null: back to the décor's own scene, if any), for trying scenes before they have a décor. */
      async scene(make: (() => Scene) | null) {
        const d = self.decorOn ?? self.opts.decor, rec = await self.loadScene(d, make ?? undefined)
        await self.transition(() => self.mountScene(rec))
      },
      /** Changes the current décor's Look live (tuning a new décor in the demo page). */
      look(o: Partial<Look>) { Object.assign(LOOKS[self.decorOn ?? self.opts.decor], o); self.extrasOn(); self.invalidate(); return { ...LOOKS[self.decorOn ?? self.opts.decor] } },
      /** The ambient animation: running now, its clock (s). */
      get ambient() { return { on: self.ambient(false), t: self.ambT, scene: !!self.sceneOn } },
      /** Macro framing for material inspection (null restores the camera). */
      closeUp(at: [number, number] | null, dist = 160, tilt = 50) {
        if (!at) { self.camOverride = null; self.invalidate(); return }
        const p = (self.camOverride ??= new THREE.PerspectiveCamera()), t = THREE.MathUtils.degToRad(tilt)
        p.up.set(0, 0, -1)
        self.updateScene(performance.now() + 1e5)
        p.fov = 24; p.aspect = self.fr.w / self.fr.h; p.setViewOffset(self.fr.w, self.fr.h, -self.fr.x, -self.fr.y, self.W, self.H)
        p.position.set(at[0] - 40, dist * Math.cos(t), at[1] + dist * Math.sin(t)); p.near = 5; p.far = 3000
        p.lookAt(at[0], 0, at[1]); p.updateProjectionMatrix()
        self.render(p)
      },
    }
  }
}
