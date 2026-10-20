// Dev-only self-test of the bench page (board3d.html?selftest=1): walks every décor and stone set, captures the canvas
// and POSTs each PNG plus a JSON summary to a local receiver (127.0.0.1:8823). Never imported by the app.
import GoBoard, { type Sign, type Vertex } from '@sabaki/go-board'
import type * as THREE from 'three'
import type { Board3D } from './Board3D'
import { DECORS } from './decors'
import { gx, gz, LOOKS } from './logic'
import { STONE_SETS } from './stoneSets'

const RECEIVER = 'http://127.0.0.1:8823'
const browser = new URLSearchParams(location.search).get('tag') ?? (/Chrome\//.test(navigator.userAgent) ? 'chromium' : /Safari\//.test(navigator.userAgent) ? 'safari' : 'webkit')
const W = 1280, H = 800
export const selftestOn = new URLSearchParams(location.search).get('selftest') === '1'

type Inner = { renderer: THREE.WebGLRenderer; ready: boolean; dead: boolean; decorOn: string | null; fade: unknown; holding: boolean }
const issues: { kind: string; text: string; at: string }[] = []
let step = 'boot'
/** Progress line to the receiver (fire and forget), so a stalled run shows where it stopped. */
const progress = (text: string) => { void fetch(`${RECEIVER}/log`, { method: 'POST', body: `${browser} ${(performance.now() / 1000).toFixed(1)}s ${text}` }).catch(() => {}) }
const note = (kind: string, text: string) => { issues.push({ kind, text: text.slice(0, 4000), at: step }); progress(`${kind} @${step}: ${text.slice(0, 300)}`) }

// installed when this module is evaluated, i.e. before Board3D exists
if (selftestOn) {
  progress(`loaded ${navigator.userAgent}`)
  for (const k of ['error', 'warn'] as const) {
    const orig = console[k].bind(console)
    console[k] = (...a: unknown[]) => { note(k, a.map(x => x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : safe(x)).join(' ')); orig(...a) }
  }
  addEventListener('error', e => note('uncaught', `${e.message} @ ${e.filename}:${e.lineno}`))
  addEventListener('unhandledrejection', e => note('unhandledrejection', String(e.reason?.stack ?? e.reason)))
}
function safe(x: unknown) { try { return JSON.stringify(x) } catch { return String(x) } }

/** Hooks that must be set right after `new Board3D` (before its async boot compiles shaders). */
export function arm(view: Board3D, canvas: HTMLCanvasElement, ro: ResizeObserver) {
  const r = (view as unknown as Inner).renderer
  if (!r) { note('fatal', 'no renderer (WebGL2 unavailable)'); return }
  ro.disconnect() // a fixed canvas size, the same in every browser, before the startup warm-up decides the quality
  view.resize(W, H)
  r.debug.checkShaderErrors = true
  r.debug.onShaderError = (gl, program, vs, fs) => {
    const log = (s: WebGLShader) => gl.getShaderInfoLog(s)?.trim()
    note('shader', `program: ${gl.getProgramInfoLog(program)?.trim()}\nvs: ${log(vs)}\nfs: ${log(fs)}\nfs source head:\n${numbered(gl.getShaderSource(fs) ?? '', gl.getShaderInfoLog(fs) ?? '')}`)
  }
  canvas.addEventListener('webglcontextlost', () => note('contextlost', 'webglcontextlost'))
}
/** The source lines around the first line number the compiler names. */
function numbered(src: string, log: string) {
  const m = /ERROR: \d+:(\d+)/.exec(log), n = m ? +m[1] : 0, L = src.split('\n')
  return L.slice(Math.max(0, n - 6), n + 5).map((l, i) => `${Math.max(0, n - 6) + i + 1}: ${l}`).join('\n')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const frames = (n: number) => new Promise<void>(res => { const f = () => (--n <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f) })
async function until(ok: () => boolean, ms: number, what: string) {
  const t0 = performance.now()
  while (!ok()) { if (performance.now() - t0 > ms) { note('timeout', what); return false } await sleep(50) }
  return true
}

async function post(path: string, body: BodyInit, type: string) {
  try { await fetch(`${RECEIVER}/${path}`, { method: 'POST', body, headers: { 'Content-Type': type } }) } catch (e) { console.info('selftest: receiver unreachable', e) }
}

/** Whether CanvasRenderingContext2D.filter = 'blur()' actually blurs (several scenes and Board3D pre-blur cookies with it). */
function canvasBlurWorks() {
  const c = Object.assign(document.createElement('canvas'), { width: 32, height: 32 }), x = c.getContext('2d')!
  x.fillStyle = '#000'; x.fillRect(0, 0, 32, 32); x.filter = 'blur(4px)'; x.fillStyle = '#fff'; x.fillRect(14, 14, 4, 4); x.filter = 'none'
  return x.getImageData(8, 16, 1, 1).data[0] > 0 // 6 px from the square: lit only if it was blurred
}

/** A fixed dense, legal 19×19 position (about 150 stones) from a seeded walk. */
function densePosition() {
  let b = GoBoard.fromDimensions(19), c: Sign = 1, s = 12345, n = 0
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let k = 0; k < 2000 && n < 150; k++) {
    const v: Vertex = [Math.floor(rnd() * 19), Math.floor(rnd() * 19)]
    try { b = b.makeMove(c, v, { preventSuicide: true, preventOverwrite: true, preventKo: true }); c = -c as Sign; n++ } catch { /* occupied or illegal */ }
  }
  return b
}

export async function run(view: Board3D) {
  const I = view as unknown as Inner, r = I.renderer
  const summary: Record<string, unknown> = { browser, ua: navigator.userAgent, dpr: devicePixelRatio, size: [W, H], captures: [] as string[] }
  const shots = summary.captures as string[]
  if (!r) { summary.issues = issues; await post('summary', JSON.stringify(summary), 'application/json'); return }

  const gl = r.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info'), cap = r.capabilities
  summary.capabilities = {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION), glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: cap.maxTextureSize, maxSamples: cap.maxSamples, maxAnisotropy: cap.getMaxAnisotropy(), precision: cap.precision,
    floatRT: !!gl.getExtension('EXT_color_buffer_float'), halfFloatRT: !!gl.getExtension('EXT_color_buffer_half_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'), anisotropyExt: !!gl.getExtension('EXT_texture_filter_anisotropic'),
    canvasFilterBlur: canvasBlurWorks(),
  }
  summary.focused = document.hasFocus() // ambient animation (leaf cookies, particles) only advances while focused

  step = 'startup'; progress('startup')
  await until(() => I.ready || I.dead, 60000, 'Board3D never became ready')
  summary.governorAtStartup = view.debug.quality
  // every capture at the top level, so both browsers render the same thing (the governor's own pick is reported above)
  view.debug.setQuality(0)

  const settle = async (what: string) => {
    await sleep(300)
    await until(() => !I.fade && !I.holding && (I.decorOn ?? view.options.decor) === view.options.decor, 30000, `${what}: never settled`)
    await frames(3); await sleep(700); await frames(2) // lazily loaded textures (scene grounds, cookies) land
  }
  const shoot = async (name: string, at?: [number, number]) => {
    step = name; progress(name)
    if (at) view.debug.closeUp(at, 120, 45); else view.debug.sample([[0, 0]])
    const url = r.domElement.toDataURL('image/png') // same task as the render: the drawing buffer is still there
    if (at) view.debug.closeUp(null)
    shots.push(name)
    await post(`png/${browser}/${name}`, await (await fetch(url)).blob(), 'image/png')
  }

  const empty = GoBoard.fromDimensions(19), dense = densePosition()
  const show = (b: GoBoard) => view.update({ signMap: b.signMap, last: null, toPlay: 1, coords: false, sound: false, interactive: false, ownership: null, counting: null, captures: { black: b.getCaptures(1), white: b.getCaptures(-1) } })
  show(empty)

  const benchMs: Record<string, number> = {}
  for (const d of DECORS) {
    step = `decor-${d}`
    view.setOptions({ decor: d, camera: 'contemplation', time: 'afternoon', stones: 'japonaise' })
    view.debug.orbit(null)
    await settle(d)
    await shoot(`decor-${d}`)
    benchMs[d] = +view.debug.bench(30).msPerFrame.toFixed(2)
    const tm = LOOKS[d].tiltMax
    if (tm) { view.debug.orbit({ tilt: tm }); await frames(2); await shoot(`decor-${d}-lifted`); view.debug.orbit(null) }
  }
  summary.benchMs = benchMs
  summary.fixedLight = Object.fromEntries(DECORS.filter(d => LOOKS[d].tod).map(d => [d, LOOKS[d].tod]))

  show(dense)
  // a touching black and white pair near the centre for the macro
  let pair: [number, number] = [0, 0], best = 1e9
  dense.signMap.forEach((row, y) => row.forEach((c, x) => {
    if (c === 1 && dense.signMap[y]?.[x + 1] === -1 && (x - 9) ** 2 + (y - 9) ** 2 < best) { best = (x - 9) ** 2 + (y - 9) ** 2; pair = [(gx(19, x) + gx(19, x + 1)) / 2, gz(19, y)] }
  }))
  for (const s of STONE_SETS) {
    step = `stones-${s}`
    view.setOptions({ decor: 'atelier', camera: 'contemplation', time: 'afternoon', stones: s })
    view.debug.orbit(null)
    await settle(s)
    await shoot(`stones-${s}`)
    await shoot(`stones-${s}-macro`, pair)
  }

  step = 'end'
  summary.issues = issues
  summary.rendererInfo = { programs: r.info.programs?.length, textures: r.info.memory.textures, geometries: r.info.memory.geometries }
  await post('summary', JSON.stringify(summary), 'application/json')
  document.title = 'selftest done'
}
