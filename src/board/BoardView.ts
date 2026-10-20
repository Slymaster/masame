// Canvas2D goban in the "Atelier" direction (port of design/directions.html).
// Layers: wood (generated once) → base (board, territory fields, grid, coordinates; per size and ownership) →
// stones (per position) → live overlay (drop animation, last-move ring, dead-stone hint, hover ghost) redrawn each frame.

import type { Sign, SignMap, Vertex } from '@sabaki/go-board'
import { clamp01, easeOut, hash, n1, rng, sstep, stoneRng, TAU, vn2 } from './noise'
import { playClack, playTap } from './sound'
import { gx, gz, jitter, settle, type Placed } from '../board3d/logic'
import { postcardCanvas, signatureFonts, toPng } from '../postcard'
import { tap } from './frame'
import { drawBlurred } from './canvasBlur'
import { STONE_DATA, type Mark2D, type Mark2DParams, type Skin2D, type StoneSet } from '../board3d/stoneSets'

export interface BoardState {
  signMap: SignMap
  last: Vertex | null
  toPlay: Sign
  interactive: boolean
  coords: boolean
  sound: boolean
  /** KataGo ownership, row-major from the top-left, +1 = Black; null hides the territory view. */
  ownership: number[] | null
  /** Counting phase: clicks go to stones (toggle dead/alive) instead of placing; territory owner per point. */
  counting: { dead: boolean[][]; territory: Sign[][] } | null
  /** Lettered markers on empty points (the joseki trainer): best and ok filled, a mistake as a ring. */
  marks?: Mark[] | null
  /** Grid rectangle [x0, y0, x1, y1] left clear; a light veil covers the rest of the board. */
  focus?: [number, number, number, number] | null
  /** A stone shown in half-tone on an empty point: the move the mentor stopped. */
  pending?: { v: Vertex; sign: Sign } | null
  /** Grid rectangle [x0, y0, x1, y1] outlined by a soft frame (a tsumego's area); the whole board stays clear. */
  frame?: [number, number, number, number] | null
}
export interface Mark { v: Vertex; label: string; tone: 'best' | 'ok' | 'mistake' }

interface Geom { N: number; bx: number; by: number; bw: number; cell: number; P: number[]; r: number; font: number; labelOff: number }

const HOSHI: Record<number, number[][]> = {
  9: [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]],
  13: [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]],
  19: [3, 9, 15].flatMap(x => [3, 9, 15].map(y => [x, y])),
}
const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ' // no I, by convention
const DROP_MS = 160, SHAKE_MS = 650 // a refused stone trembles, then fades away
const LABEL_FONT = 'Manrope, system-ui, sans-serif'
// one light for the board and the stones: the shadows fall towards the lower right
const SUN: [number, number] = [0.496, 0.868]
const STONE_SHADOW_A = 0.42
// hand placement, laid out like the 3D board's in a square 22 mm grid (stone radius 0.482 cell)
const J_MM = 22, J_R = 0.482 * J_MM, J_AMP = 1.2
type At = (X: number, Y: number) => [number, number]

const mk = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })

/* ---------- wood ---------- */
// Grain is computed once in a fixed "reference" space (an 800px-wide top at 2× density) and scaled to the board,
// so resizing the window never recomputes it and the grain scales like a real board would.
const WOOD_REF = 800, WOOD_PX = 1600
let woodCache: HTMLCanvasElement | null = null
function wood(): HTMLCanvasElement {
  if (woodCache) return woodCache
  const w = WOOD_PX, k = WOOD_REF / WOOD_PX, cv = mk(w, w), x = cv.getContext('2d')!
  const img = x.createImageData(w, w), d = img.data
  const L = [224, 180, 110], D = [176, 120, 58]
  for (let j = 0; j < w; j++) {
    const Y = j * k
    const warp = 3.2 * Math.sin(Y * 0.0045 + 1.3) + 1.1 * Math.sin(Y * 0.019 + 0.4) + 5 * (n1(Y * 0.005 + 50) - 0.5)
    for (let i = 0; i < w; i++) {
      const X = i * k
      const u = X + warp + 0.9 * Math.sin(Y * 0.011 + X * 0.003)
      const g1 = n1(u * 0.62), g2 = n1(u * 0.15 + 100), g3 = n1(u * 0.022 + 300)
      const along = 0.55 + 0.9 * vn2(u * 0.09, Y * 0.0045, 5)
      const v = 0.5 * Math.pow(g1, 6) * along + 0.18 * g2 * along + 0.42 * (g3 - 0.5)
      const lg = 1.035 - 0.07 * ((X + Y) / (2 * WOOD_REF))
      const tt = clamp01(0.36 + v)
      const nz = (hash(i, j, 9) - 0.5) * 5
      const o = (j * w + i) * 4
      d[o] = (L[0] + (D[0] - L[0]) * tt) * lg + nz
      d[o + 1] = (L[1] + (D[1] - L[1]) * tt) * lg + nz
      d[o + 2] = (L[2] + (D[2] - L[2]) * tt) * lg + nz * 0.8
      d[o + 3] = 255
    }
  }
  x.putImageData(img, 0, 0)
  return (woodCache = cv)
}

/* ---------- geometry ---------- */
export function geom(S: number, N: number, coords: boolean, dpr: number): Geom {
  const bx = S * 0.018, by = bx, bw = S * 0.945
  const font = Math.min(13, Math.max(9.5, S * 0.0155))
  // Margin from the outer line to the board edge: 0.75 cell as in the mood board; with coordinates, enough
  // room for a label between an edge stone and the board edge.
  let cell = bw / (N - 1 + 1.5)
  if (coords) cell = Math.min(bw / (N - 1 + 1.56), (bw - 4.6 * font) / N)
  const margin = (bw - (N - 1) * cell) / 2
  const lw = Math.max(1, Math.round(dpr))
  const snap = (v: number) => (Math.round(v * dpr) + (lw % 2 ? 0.5 : 0)) / dpr // crisp 1-device-pixel lines
  const P = Array.from({ length: N }, (_, i) => snap(bx + margin + i * cell))
  return { N, bx, by, bw, cell, P, r: cell * 0.482, font, labelOff: (cell * 0.49 + margin) / 2 }
}

/* ---------- board ---------- */
/** Cast + contact shadow on the linen: colour, blur and offset along SUN, in device px. */
const boardShadows = (S: number, dpr: number) => [['rgba(70,44,18,0.32)', S * 0.03 * dpr, S * 0.0161 * dpr], ['rgba(40,24,8,0.45)', 3 * dpr, 1.8 * dpr]] as const
const shade = (x: CanvasRenderingContext2D, [c, blur, d]: readonly [string, number, number]) => {
  x.shadowColor = c; x.shadowBlur = blur; x.shadowOffsetX = SUN[0] * d; x.shadowOffsetY = SUN[1] * d
}
/** The board's outline (top face, right and front thickness), CSS px. */
function boardPath(x: CanvasRenderingContext2D, { bx, by, bw }: Geom, t: number) {
  x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + bw, by); x.lineTo(bx + bw + t * 0.45, by + t * 0.5); x.lineTo(bx + bw + t * 0.45, by + bw + t); x.lineTo(bx, by + bw + t); x.closePath()
}
function drawBoard(x: CanvasRenderingContext2D, g: Geom, S: number, dpr: number) {
  const { bx, by, bw } = g, t = S * 0.016
  for (const sh of boardShadows(S, dpr)) { x.save(); shade(x, sh); x.fillStyle = '#8a5a28'; x.fillRect(bx, by, bw + t * 0.45, bw + t); x.restore() }
  // thickness: front (bottom) and right side faces
  let gr = x.createLinearGradient(0, by + bw, 0, by + bw + t)
  gr.addColorStop(0, '#A8763A'); gr.addColorStop(1, '#7A4F22')
  x.fillStyle = gr; x.beginPath(); x.moveTo(bx, by + bw); x.lineTo(bx + bw, by + bw); x.lineTo(bx + bw + t * 0.45, by + bw + t); x.lineTo(bx, by + bw + t); x.closePath(); x.fill()
  gr = x.createLinearGradient(bx + bw, 0, bx + bw + t * 0.45, 0)
  gr.addColorStop(0, '#9A6A32'); gr.addColorStop(1, '#6E4520')
  x.fillStyle = gr; x.beginPath(); x.moveTo(bx + bw, by); x.lineTo(bx + bw + t * 0.45, by + t * 0.5); x.lineTo(bx + bw + t * 0.45, by + bw + t); x.lineTo(bx + bw, by + bw); x.closePath(); x.fill()
  // end-grain hint on the front face
  x.save(); x.beginPath(); x.rect(bx, by + bw, bw + t, t); x.clip()
  const R = rng(5)
  for (let i = 0; i < bw; i += 1.5 + R() * 3) {
    x.strokeStyle = `rgba(60,35,12,${0.05 + R() * 0.08})`; x.lineWidth = 0.6
    x.beginPath(); x.moveTo(bx + i, by + bw); x.lineTo(bx + i + t * 0.3, by + bw + t); x.stroke()
  }
  x.restore()
  // top face
  x.imageSmoothingQuality = 'high'
  x.drawImage(wood(), bx, by, bw, bw)
  // warm afternoon light from the upper left
  gr = x.createRadialGradient(bx + bw * 0.15, by + bw * 0.1, 0, bx + bw * 0.15, by + bw * 0.1, bw * 1.25)
  gr.addColorStop(0, 'rgba(255,236,196,0.16)'); gr.addColorStop(1, 'rgba(90,50,10,0.10)')
  x.fillStyle = gr; x.fillRect(bx, by, bw, bw)
  // bevel
  x.fillStyle = 'rgba(255,238,205,0.45)'; x.fillRect(bx, by, bw, 1); x.fillRect(bx, by, 1, bw)
  x.fillStyle = 'rgba(80,46,14,0.35)'; x.fillRect(bx, by + bw - 1, bw, 1); x.fillRect(bx + bw - 1, by, 1, bw)
}

export function drawGrid(x: CanvasRenderingContext2D, g: Geom, coords: boolean) {
  const { N, P } = g
  const ink = 'rgba(43,29,14,0.86)', a = P[0], z = P[N - 1]
  x.strokeStyle = ink; x.lineWidth = 1; x.beginPath()
  for (let i = 1; i < N - 1; i++) { x.moveTo(P[i], a); x.lineTo(P[i], z); x.moveTo(a, P[i]); x.lineTo(z, P[i]) }
  x.stroke()
  x.lineWidth = 1.6; x.strokeRect(a, a, z - a, z - a)
  x.fillStyle = ink
  const hr = Math.min(g.cell * 0.085, 3.6)
  for (const [i, j] of HOSHI[N] ?? []) { x.beginPath(); x.arc(P[i], P[j], hr, 0, TAU); x.fill() }

  if (coords) {
    x.fillStyle = 'rgba(58,36,14,0.62)'
    x.font = `500 ${g.font}px ${LABEL_FONT}`
    x.textAlign = 'center'; x.textBaseline = 'middle'
    const o = g.labelOff, dy = g.font * 0.06 // the UI font sits slightly high on 'middle'
    for (let i = 0; i < N; i++) {
      const col = COLS[i], row = String(N - i)
      x.fillText(col, P[i], a - o + dy); x.fillText(col, P[i], z + o + dy)
      x.fillText(row, a - o, P[i] + dy); x.fillText(row, z + o, P[i] + dy)
    }
  }
}

/* ---------- territory: "ombre et lumière" ---------- */
// Black's area sinks into warm shadow, White's catches warm light. Per-point fields are blurred by about a third of a
// cell: soft enough to read as light, tight enough that the frontier between the two stays a legible line.
const SHADOW = [58, 30, 8], LIGHT = [255, 233, 186]
function drawTerritory(x: CanvasRenderingContext2D, g: Geom, own: number[], signMap: SignMap, dpr: number) {
  const W = x.canvas.width, N = g.N, c = g.cell
  const dark = mk(W, W), light = mk(W, W), d = dark.getContext('2d')!, l = light.getContext('2d')!
  d.setTransform(dpr, 0, 0, dpr, 0, 0); l.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) {
    const v = own[Y * N + X], s = signMap[Y][X]
    if (s !== 0 && Math.sign(v) === s) continue // a living stone covers its own point
    const a = sstep(0.3, 0.85, Math.abs(v)) // contested points stay plain wood
    if (a <= 0) continue
    const [t, k, col] = v > 0 ? [d, 0.72, SHADOW] : [l, 0.85, LIGHT]
    t.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${k * a})`
    t.fillRect(g.P[X] - c / 2, g.P[Y] - c / 2, c, c)
  }
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalCompositeOperation = 'multiply'; drawBlurred(x, dark, c * 0.3 * dpr)
  x.globalCompositeOperation = 'screen'; drawBlurred(x, light, c * 0.3 * dpr)
  x.restore()
}

/** Stones KataGo expects to be captured fade toward the territory they sit in. */
function deadHint(c: CanvasRenderingContext2D, g: Geom, own: number[], signMap: SignMap, at: At) {
  const N = g.N
  signMap.forEach((row, Y) => row.forEach((s, X) => {
    const v = own[Y * N + X]
    if (!s || Math.sign(v) !== -s) return
    const a = sstep(0.4, 0.9, Math.abs(v))
    if (a <= 0) return
    c.fillStyle = s === 1 ? `rgba(246,236,218,${0.42 * a})` : `rgba(52,32,14,${0.38 * a})`
    c.beginPath(); c.arc(...at(X, Y), g.r * 1.01, 0, TAU); c.fill()
  }))
}

/** Counting: dead stones fade into the wood; counted points get a tiny slate or shell square (on dead stones too). */
function countMarks(c: CanvasRenderingContext2D, g: Geom, signMap: SignMap, { dead, territory }: NonNullable<BoardState['counting']>, at: At) {
  const q = Math.max(4, g.cell * 0.28)
  signMap.forEach((row, Y) => row.forEach((s, X) => {
    const [cx, cy] = at(X, Y)
    if (s && dead[Y][X]) {
      c.fillStyle = 'rgba(212,168,104,0.62)'
      c.beginPath(); c.arc(cx, cy, g.r * 1.02, 0, TAU); c.fill()
    }
    const o = territory[Y][X]
    if (!o) return
    c.save()
    c.shadowColor = 'rgba(48,26,6,0.35)'; c.shadowBlur = q * 0.35; c.shadowOffsetX = q * 0.06; c.shadowOffsetY = q * 0.1
    c.fillStyle = o === 1 ? '#2a2a2f' : '#f4efe4'
    c.fillRect(cx - q / 2, cy - q / 2, q, q)
    c.restore()
    c.strokeStyle = o === 1 ? 'rgba(12,12,14,0.9)' : 'rgba(110,84,50,0.75)'; c.lineWidth = 0.75
    c.strokeRect(cx - q / 2, cy - q / 2, q, q)
  }))
}

/* ---------- stones ---------- */
function stoneShadow(c: CanvasRenderingContext2D, g: Geom, cx: number, cy: number, t: number) {
  const r = g.r, e = 1 - easeOut(t), off = r * (0.1 + 0.16 * e), blur = r * (0.22 + 0.35 * e)
  const sx = cx + off * 1.4 * SUN[0], sy = cy + off * 1.4 * SUN[1]
  const gr = c.createRadialGradient(sx, sy, r * 0.6, sx, sy, r + blur)
  gr.addColorStop(0, `rgba(48,26,6,${STONE_SHADOW_A - 0.2 * e})`); gr.addColorStop(1, 'rgba(48,26,6,0)')
  c.fillStyle = gr; c.beginPath(); c.arc(sx, sy, r + blur, 0, TAU); c.fill()
}

// Each colour's defaults are the Japanese stones' (slate, Hyuga shell): any set without a `finish` draws exactly like them.
const SIDE = {
  [1]: { seed: 11, jit: 9, jitRim: false, focus: [-0.38, -0.42, 0.04], stops: [0, 0.32, 0.78, 1], hl: [-0.36, -0.42, 0.5, 0.17, [255, 250, 240]], ink: [215, 215, 225] },
  [-1]: { seed: 23, jit: 6, jitRim: true, focus: [-0.3, -0.36, 0.05], stops: [0, 0.55, 0.88, 1], hl: [-0.34, -0.4, 0.42, 0.55, [255, 255, 255]], ink: [120, 104, 82] },
} as const
const JAPANESE = STONE_DATA.japonaise.skin2d

function stone(c: CanvasRenderingContext2D, g: Geom, X: number, Y: number, col: Sign, t: number, [cx, cy] = [g.P[X], g.P[Y]], sk: Skin2D = JAPANESE) {
  const r = g.r * (1.06 - 0.06 * easeOut(t)) // lands from slightly above: a touch larger, then settles
  const d = SIDE[col as 1 | -1], f = (col === 1 ? sk.finish?.black : sk.finish?.white) ?? {}, cols = col === 1 ? sk.black : sk.white
  // per-stone tone shift and mark angle (this draw order keeps the Japanese stones' random sequence)
  const R = stoneRng(X, Y, d.seed)
  let ang: number, tn: number
  if (col === 1) { tn = (R() - 0.5) * d.jit; ang = R() * TAU } else { ang = R() * TAU; tn = (R() - 0.5) * d.jit }
  c.save(); c.translate(cx, cy)
  const gr = c.createRadialGradient(d.focus[0] * r, d.focus[1] * r, r * d.focus[2], 0, 0, r)
  const at = f.stops ?? (cols.length === 4 ? d.stops : cols.map((_, i) => i / (cols.length - 1)))
  cols.forEach(([a, b, cc], i) => {
    const j = i < cols.length - 1 || d.jitRim ? tn : 0
    gr.addColorStop(at[i], `rgb(${Math.round(a + j)},${Math.round(b + j)},${Math.round(cc + j)})`)
  })
  c.fillStyle = gr; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill()
  const m = col === 1 ? sk.marks.black : sk.marks.white
  if (m !== 'none') { c.save(); c.clip(); mark(c, m, r, R, ang, f.mark ?? {}, d.ink); c.restore() }
  if (f.rim) {
    const rg = c.createRadialGradient(0, 0, r * (1 - (f.rim.width ?? 0.35)), 0, 0, r)
    rg.addColorStop(0, `rgba(${f.rim.color.join(',')},0)`); rg.addColorStop(1, `rgba(${f.rim.color.join(',')},${f.rim.strength})`)
    c.fillStyle = rg; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill()
  }
  const [hx, hy, hs, ha, hc] = d.hl, h = f.highlight, hcol = (h?.color ?? hc).join(',')
  const sp = c.createRadialGradient(hx * r, hy * r, 0, hx * r, hy * r, r * (h?.size ?? hs))
  sp.addColorStop(0, `rgba(${hcol},${h?.strength ?? ha})`); sp.addColorStop(1, `rgba(${hcol},0)`)
  c.fillStyle = sp; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill()
  if (col === 1) { // warm rim bounce from the kaya
    const rim = c.createRadialGradient(r * 0.3, r * 0.35, r * 0.5, 0, 0, r)
    rim.addColorStop(0, 'rgba(255,220,170,0)'); rim.addColorStop(1, 'rgba(255,215,160,0.07)')
    c.fillStyle = rim; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill()
  } else { c.strokeStyle = 'rgba(120,96,62,0.32)'; c.lineWidth = 0.6; c.beginPath(); c.arc(0, 0, r - 0.3, 0, TAU); c.stroke() }
  c.restore()
}

/** A stone's mark, drawn clipped to the stone (centred at 0, 0); R continues the stone's own random sequence. */
function mark(c: CanvasRenderingContext2D, kind: Mark2D, r: number, R: () => number, ang: number, p: Mark2DParams, ink: readonly number[]) {
  const am = p.amount ?? 1, sc = p.scale ?? 1, n = (k: number) => Math.max(1, Math.round(k * (p.count ?? 1)))
  const rgba = (a: number, rgb = p.color ?? ink) => `rgba(${rgb.join(',')},${a})`
  const inside = (k = 0.85): [number, number] => { const q = r * k * Math.sqrt(R()), th = R() * TAU; return [Math.cos(th) * q, Math.sin(th) * q] }
  const dot = (x: number, y: number, rad: number) => { c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill() }
  switch (kind) {
    case 'growth': { // Hyuga clamshell: growth striations from a distant centre, at a random angle per stone
      const Dd = r * 3.4, ccx = Math.cos(ang) * Dd, ccy = Math.sin(ang) * Dd
      for (let rad = Dd - r * 1.1; rad < Dd + r * 1.1;) {
        if (R() < 0.3) { // a translucent growth band, cooler and wider than the fine lines
          c.strokeStyle = rgba((0.07 + R() * 0.05) * am, p.color ?? [140, 128, 110]); c.lineWidth = r * (0.05 + R() * 0.04) * sc
          c.beginPath(); c.arc(ccx, ccy, rad, 0, TAU); c.stroke()
          rad += r * (0.1 + R() * 0.08) * sc
          continue
        }
        c.strokeStyle = rgba((0.025 + R() * 0.055) * am, p.color ?? [150, 126, 92]); c.lineWidth = r * (0.012 + R() * 0.03) * sc
        c.beginPath(); c.arc(ccx, ccy, rad, 0, TAU); c.stroke()
        rad += r * (0.045 + R() * 0.09) * sc
      }
      break
    }
    case 'veins': // fine lines wandering across the stone
      c.lineCap = 'round'
      for (let i = n(3); i--;) {
        const a = ang + (R() - 0.5) * 1.2, [x0, y0] = [-Math.cos(a) * r * 1.1, -Math.sin(a) * r * 1.1], [x1, y1] = inside(0.9), [x2, y2] = inside(0.9)
        c.strokeStyle = rgba((0.14 + R() * 0.14) * am); c.lineWidth = r * (0.012 + R() * 0.022) * sc
        c.beginPath(); c.moveTo(x0, y0); c.bezierCurveTo(x1, y1, x2, y2, Math.cos(a) * r * 1.1 + (R() - 0.5) * r, Math.sin(a) * r * 1.1 + (R() - 0.5) * r); c.stroke()
      }
      break
    case 'bands': { // agate: concentric layers around an off-centre core
      const ox = Math.cos(ang) * r * 0.35, oy = Math.sin(ang) * r * 0.35, e = 0.62 + R() * 0.25
      for (let rad = r * 0.12, i = 0; rad < r * 1.6 && i < n(14); i++) {
        c.strokeStyle = rgba((0.06 + R() * 0.12) * am); c.lineWidth = r * (0.025 + R() * 0.06) * sc
        c.beginPath(); c.ellipse(ox, oy, rad, rad * e, ang, 0, TAU); c.stroke()
        rad += r * (0.07 + R() * 0.1) * sc
      }
      break
    }
    case 'bubbles': // small air trapped in glass or resin: a faint disc, its rim and a glint
      for (let i = n(7); i--;) {
        const [x, y] = inside(), rad = r * (0.025 + R() * 0.05) * sc
        c.fillStyle = rgba(0.12 * am); dot(x, y, rad)
        c.strokeStyle = rgba(0.3 * am); c.lineWidth = Math.max(0.4, rad * 0.25); c.stroke()
        c.fillStyle = `rgba(255,255,255,${0.5 * am})`; dot(x - rad * 0.35, y - rad * 0.35, rad * 0.3)
      }
      break
    case 'speckles': // fine grain
      for (let i = n(60); i--;) { const [x, y] = inside(1); c.fillStyle = rgba((0.12 + R() * 0.3) * am); dot(x, y, r * (0.008 + R() * 0.022) * sc) }
      break
    case 'stars': // tiny glowing points, a soft halo around each
      for (let i = n(14); i--;) {
        const [x, y] = inside(), rad = r * (0.006 + R() * 0.016) * sc, b = 0.5 + R() * 0.5
        c.fillStyle = rgba(0.12 * b * am, p.color ?? [255, 250, 235]); dot(x, y, rad * 3.5)
        c.fillStyle = rgba(0.9 * b * am, p.color ?? [255, 250, 235]); dot(x, y, rad)
      }
      break
    case 'cracks': // jagged lines, a wide faint pass for their glow under a fine bright one
      c.lineCap = c.lineJoin = 'round'
      for (let i = n(3); i--;) {
        const pts: [number, number][] = [inside(0.7)]
        let a = ang + R() * TAU
        for (let k = 4 + Math.floor(R() * 4); k--;) { a += (R() - 0.5) * 1.4; const [x, y] = pts[pts.length - 1]; pts.push([x + Math.cos(a) * r * 0.16, y + Math.sin(a) * r * 0.16]) }
        const w = r * 0.022 * sc, rgb = p.color ?? [255, 140, 50]
        for (const [lw, a2] of [[w * 4, 0.18], [w, 0.75]]) {
          c.strokeStyle = rgba(a2 * am, rgb); c.lineWidth = lw
          c.beginPath(); pts.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke()
        }
      }
      break
    case 'sheen': { // a soft brushed band across the stone
      const nx = Math.cos(ang), ny = Math.sin(ang), w = r * 0.5 * sc, o = (R() - 0.5) * r * 0.6
      const lg = c.createLinearGradient(nx * (o - w), ny * (o - w), nx * (o + w), ny * (o + w)), rgb = p.color ?? [255, 248, 230]
      lg.addColorStop(0, rgba(0, rgb)); lg.addColorStop(0.5, rgba(0.22 * am, rgb)); lg.addColorStop(1, rgba(0, rgb))
      c.fillStyle = lg; c.fillRect(-r, -r, 2 * r, 2 * r)
      break
    }
  }
}

function lastRing(c: CanvasRenderingContext2D, g: Geom, [cx, cy]: [number, number], col: Sign) {
  c.strokeStyle = col === 1 ? 'rgba(238,230,214,0.92)' : 'rgba(26,26,29,0.85)'
  c.lineWidth = Math.max(1.2, g.r * 0.085)
  c.beginPath(); c.arc(cx, cy, g.r * 0.4, 0, TAU); c.stroke()
}

/** Veil and markers, also drawn into the 3D board's overlay texture: px / py map grid indices to canvas units. */
export function paintMarks(c: CanvasRenderingContext2D, px: (i: number) => number, py: (i: number) => number, cell: number,
  marks: Mark[] | null | undefined, focus: BoardState['focus'], w: number, h: number, veil = 0.24, frame: BoardState['frame'] = null, frameAlpha = 0.55) {
  if (frame) {
    const m = cell * 0.5, x0 = px(frame[0]) - m, y0 = py(frame[1]) - m
    c.lineWidth = cell * 0.09; c.strokeStyle = `rgba(138,47,34,${frameAlpha})`
    c.beginPath(); c.roundRect(x0, y0, px(frame[2]) + m - x0, py(frame[3]) + m - y0, cell * 0.3); c.stroke()
  }
  if (focus) {
    const m = cell * 0.5, x0 = px(focus[0]) - m, y0 = py(focus[1]) - m
    c.fillStyle = `rgba(246,240,229,${veil})`
    c.beginPath(); c.rect(0, 0, w, h); c.rect(x0, y0, px(focus[2]) + m - x0, py(focus[3]) + m - y0); c.fill('evenodd')
  }
  const r = cell * 0.34
  c.font = `600 ${(r * 1.15).toFixed(1)}px ${LABEL_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'
  for (const { v, label, tone } of marks ?? []) {
    const x = px(v[0]), y = py(v[1])
    c.beginPath(); c.arc(x, y, r, 0, TAU)
    if (tone === 'mistake') {
      c.fillStyle = 'rgba(246,240,229,0.7)'; c.fill()
      c.lineWidth = Math.max(1, r * 0.12); c.strokeStyle = '#6E5F4D'; c.stroke(); c.fillStyle = '#6E5F4D'
    } else { c.fillStyle = tone === 'best' ? '#8A2F22' : '#6E5F4D'; c.fill(); c.fillStyle = '#F6F0E5' }
    c.fillText(label, x, y + r * 0.08)
  }
}

/* ---------- view ---------- */
export class BoardView {
  private ctx: CanvasRenderingContext2D
  private S = 0
  private dpr = 1
  private g: Geom | null = null
  private state: BoardState | null = null
  private wood: HTMLCanvasElement | null = null
  private woodKey = ''
  private base: HTMLCanvasElement | null = null
  private baseKey = ''
  private own: number[] | null = null
  private ownId = 0
  private geomKey = ''
  private stones: HTMLCanvasElement | null = null
  private stonesKey = ''
  private set: StoneSet = 'japonaise'
  private hover: Vertex | null = null // the ghost stone: under the mouse, or where a finger tapped first
  private pointer = 'mouse' // the last pointerdown's pointerType: the click that follows comes from it
  private pos = '' // the position last shown
  private anim: { x: number; y: number; c: Sign; start: number } | null = null
  private shook: { x: number; y: number; c: Sign; start: number } | null = null
  /** Where each stone was put down (mm in the square jitter space); stones never move once down. */
  private placed = new Map<number, Placed & { c: Sign }>()
  private placedN = 0
  private placedId = 0
  private moveNo = 0
  private raf = 0
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  private cleanup: () => void

  /** onPlay returns true when the move was legal (the view then animates and sounds the drop). */
  constructor(private canvas: HTMLCanvasElement, private onPlay: (v: Vertex) => boolean) {
    this.ctx = canvas.getContext('2d')!
    const down = (e: PointerEvent) => { this.pointer = e.pointerType || 'mouse' }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return // a finger has no hover: its ghost comes from tap()
      const v = this.pick(e), s = this.state
      if (s?.counting) { // only stones are clickable while counting; no ghost stone
        canvas.style.cursor = v && s.interactive && s.signMap[v[1]][v[0]] ? 'pointer' : 'default'
        return
      }
      const nh = v && s?.interactive && !s.signMap[v[1]][v[0]] ? v : null
      canvas.style.cursor = nh ? 'pointer' : 'default'
      if (nh?.[0] === this.hover?.[0] && nh?.[1] === this.hover?.[1]) return
      this.hover = nh; this.req()
    }
    const leave = (e: PointerEvent) => { if (e.pointerType === 'mouse') { this.hover = null; this.req() } }
    // a finger plays on pointerup: WebKit may fold two quick taps into a double tap and send a single click
    const up = (e: PointerEvent) => { if (e.pointerType !== 'mouse') act(e) }
    const click = (e: MouseEvent) => { if (this.pointer === 'mouse') act(e) }
    const act = (e: MouseEvent) => {
      const touch = this.pointer !== 'mouse', v = this.pick(e, touch), s = this.state
      if (!v || !s?.interactive) return
      if (s.counting) { this.onPlay(v); return }
      const r = tap(this.hover, v, this.pointer)
      if (!r.play) { this.hover = s.signMap[v[1]][v[0]] ? null : [v[0], v[1]]; this.req(); return } // no ghost on a stone
      const c = s.toPlay
      if (this.onPlay(v)) this.drop(v, c)
      else if (touch) { this.hover = null; this.req() }
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('click', click)
    // Canvas text needs the bundled font actually loaded before the coordinates are drawn.
    void document.fonts.load(`500 12px ${LABEL_FONT}`).then(() => { this.woodKey = ''; this.req() })
    // devicePixelRatio changes (window moved to another display): the query only fires once, so re-arm it.
    let mq: MediaQueryList, onDpr: () => void
    const arm = () => { mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`); mq.addEventListener('change', onDpr) }
    onDpr = () => { mq.removeEventListener('change', onDpr); arm(); if (this.S) this.resize(this.S) }
    arm()
    this.cleanup = () => {
      mq.removeEventListener('change', onDpr)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('click', click)
      cancelAnimationFrame(this.raf)
    }
  }

  destroy() { this.cleanup() }

  /** The stone set drawn and heard (its three-free data: skin2d, snd); the stones are redrawn on the next frame. */
  setStones(set: StoneSet) { if (set !== this.set) { this.set = set in STONE_DATA ? set : 'japonaise'; this.req() } }

  /** The bot passed: a soft tap, nothing drawn. */
  pass() { if (this.state?.sound) playTap(STONE_DATA[this.set].snd) }

  /** Animates and sounds a stone landing (the player's click, or the bot's move). */
  drop(v: Vertex, c: Sign) {
    this.hover = null
    const N = this.placedN, p = v[1] * N + v[0] // the bot's drop arrives before its state update: put the stone down now
    if (N && this.placed.get(p)?.c !== c) { this.placed.delete(p); this.place(N, p, c) }
    if (!this.reducedMotion.matches) this.anim = { x: v[0], y: v[1], c, start: performance.now() }
    if (this.state?.sound) playClack(STONE_DATA[this.set].snd)
    this.req()
  }

  /** A refused stone (replaying from memory): it trembles and disappears; the position doesn't change. */
  shake(v: Vertex, c: Sign) {
    this.hover = null
    this.shook = { x: v[0], y: v[1], c, start: performance.now() }
    if (this.state?.sound) playTap(STONE_DATA[this.set].snd)
    this.req()
  }

  private place(N: number, p: number, c: Sign) {
    const x = p % N, y = (p / N) | 0, j = jitter(N, x, y, ++this.moveNo, J_AMP, J_AMP)
    const s = { x, y, c, R: J_R, jx: x * J_MM + j.jx - gx(N, x), jz: y * J_MM + j.jz - gz(N, y), tx: 0, tz: 0 }
    this.placed.set(p, s); settle(s, this.placed, N, x * J_MM, y * J_MM, J_MM, J_MM) // around the stones already down
    this.placedId++
  }

  /** Removals first, so a newcomer fits around the stones that stay. */
  private reconcile(state: BoardState) {
    const N = state.signMap.length
    if (N !== this.placedN) { this.placed.clear(); this.placedN = N; this.placedId++ }
    for (const [p, s] of this.placed) if (state.signMap[s.y][s.x] !== s.c) { this.placed.delete(p); this.placedId++ }
    state.signMap.forEach((row, Y) => row.forEach((c, X) => { if (c && !this.placed.has(Y * N + X)) this.place(N, Y * N + X, c) }))
  }

  /** A stone's drawn centre (the grid point when nothing is there). */
  private at: At = (X, Y) => {
    const g = this.g!, s = this.placed.get(Y * g.N + X), k = g.cell / J_MM
    return s ? [g.P[X] + (s.tx - X * J_MM) * k, g.P[Y] + (s.tz - Y * J_MM) * k] : [g.P[X], g.P[Y]]
  }

  update(state: BoardState) {
    // a finger's ghost waits for its second tap only on the position it was put on (compared by content: trainers rebuild maps)
    const pos = state.signMap.map(r => r.join('')).join('/')
    if (!state.interactive || state.counting || this.pointer !== 'mouse' && pos !== this.pos) this.hover = null
    this.pos = pos
    this.reconcile(state)
    const a = this.anim, l = state.last
    if (a && !(l && l[0] === a.x && l[1] === a.y)) this.anim = null // undo/navigation mid-drop
    if (state.ownership !== this.own) { this.own = state.ownership; this.ownId++ }
    this.state = state
    this.syncGeom()
    this.req()
  }

  private syncGeom() {
    const s = this.state
    if (!s || !this.S) return
    const key = `${this.S}|${this.dpr}|${s.signMap.length}|${s.coords}`
    if (key !== this.geomKey) { this.g = geom(this.S, s.signMap.length, s.coords, this.dpr); this.geomKey = key }
  }

  resize(size: number) {
    const S = Math.max(200, Math.floor(size)), dpr = window.devicePixelRatio || 1
    if (S === this.S && dpr === this.dpr) return this.snap() // the layout may have moved the canvas all the same
    this.S = S; this.dpr = dpr
    this.canvas.style.width = this.canvas.style.height = `${S}px`
    this.canvas.width = this.canvas.height = Math.round(S * dpr)
    this.snap()
    this.syncGeom() // geometry follows the size synchronously, so pick() is never stale
    this.frame(performance.now()) // synchronous: no blank frame while the window is being dragged
  }

  /** Centring can land on a half pixel, which smears 1px lines on 1× displays: nudge to the pixel grid. */
  private snap() {
    this.canvas.style.transform = ''
    const r = this.canvas.getBoundingClientRect()
    this.canvas.style.transform = `translate(${Math.round(r.left) - r.left}px, ${Math.round(r.top) - r.top}px)`
  }

  /** The board as drawn, without the hover ghost or a drop in flight, signed like the 3D postcard. */
  async snapshot(): Promise<Blob | null> {
    await signatureFonts()
    if (!this.state || !this.S) return null
    const h = this.hover
    this.hover = null; this.anim = null; this.shook = null; this.frame(performance.now())
    // the canvas ends inside the board's cast shadow: cut the board out and cast its shadows again, whole, on a larger sheet
    const { S, dpr: d } = this, g = this.g!, t = S * 0.016, pad = Math.ceil(S * 0.07 * d)
    const ox = Math.floor(g.bx * d), oy = Math.floor(g.by * d), w = Math.ceil((g.bx + g.bw + t * 0.45) * d) - ox, hh = Math.ceil((g.by + g.bw + t) * d) - oy
    const board = mk(w, hh), y = board.getContext('2d')!
    y.setTransform(d, 0, 0, d, -ox, -oy); boardPath(y, g, t); y.clip()
    y.setTransform(1, 0, 0, 1, 0, 0); y.drawImage(this.canvas, -ox, -oy)
    this.hover = h; this.req()
    const sheet = mk(w + 2 * pad, hh + 2 * pad), x = sheet.getContext('2d')!
    for (const sh of boardShadows(S, d)) { x.save(); shade(x, sh); x.drawImage(board, pad, pad); x.restore() }
    x.drawImage(board, pad, pad)
    return toPng(postcardCanvas(sheet, { x: 0, y: 0, w: sheet.width, h: sheet.height }))
  }

  private req() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)) }

  /** The point under e; `cell`: anywhere in its square (a finger), else within half a cell of it (the mouse). */
  private pick(e: MouseEvent, cell = false): Vertex | null {
    const g = this.g
    if (!g) return null
    const rect = this.canvas.getBoundingClientRect(), mx = e.clientX - rect.left, my = e.clientY - rect.top
    const x = Math.round((mx - g.P[0]) / g.cell), y = Math.round((my - g.P[0]) / g.cell)
    // a click on a drawn (jittered) stone picks that stone, even past the half-way line to the neighbour
    const cx = Math.min(g.N - 1, Math.max(0, x)), cy = Math.min(g.N - 1, Math.max(0, y)), sm = this.state?.signMap
    let hit: Vertex | null = null, best = g.r
    for (let Y = cy - 1; Y <= cy + 1; Y++) for (let X = cx - 1; X <= cx + 1; X++) {
      if (!sm?.[Y]?.[X]) continue
      const [px, py] = this.at(X, Y), d = Math.hypot(mx - px, my - py)
      if (d <= best) { best = d; hit = [X, Y] }
    }
    if (hit) return hit
    if (x < 0 || y < 0 || x >= g.N || y >= g.N) return null
    if (!cell && Math.hypot(mx - g.P[x], my - g.P[y]) > g.cell * 0.5) return null
    return [x, y]
  }

  private frame(now: number) {
    cancelAnimationFrame(this.raf); this.raf = 0
    const s = this.state
    if (!s || !this.S) return
    const { S, dpr } = this, N = s.signMap.length, W = this.canvas.width

    const woodKey = `${S}|${dpr}|${N}|${s.coords}`
    if (woodKey !== this.woodKey) {
      this.syncGeom()
      this.wood = mk(W, W)
      const x = this.wood.getContext('2d')!
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawBoard(x, this.g!, S, dpr)
      this.woodKey = woodKey; this.baseKey = ''
    }
    const g = this.g!
    const own = s.ownership?.length === N * N ? s.ownership : null
    const posKey = s.signMap.map(r => r.join('')).join('')
    const baseKey = `${woodKey}|${own ? `${this.ownId}|${posKey}` : ''}`
    if (baseKey !== this.baseKey) {
      this.base = mk(W, W)
      const x = this.base.getContext('2d')!
      x.drawImage(this.wood!, 0, 0)
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (own) drawTerritory(x, g, own, s.signMap, dpr)
      drawGrid(x, g, s.coords)
      this.baseKey = baseKey
    }

    let t = 1
    if (this.anim) {
      t = clamp01((now - this.anim.start) / DROP_MS)
      if (t >= 1) { this.anim = null; t = 1 }
    }
    const a = this.anim, ex = a ? a.y * N + a.x : -1
    const stonesKey = `${woodKey}|${ex}|${posKey}|${this.placedId}|${this.set}`, sk = STONE_DATA[this.set].skin2d
    if (stonesKey !== this.stonesKey) {
      this.stones = mk(W, W)
      const x = this.stones.getContext('2d')!
      x.setTransform(dpr, 0, 0, dpr, 0, 0)
      const list: [number, number, Sign][] = []
      s.signMap.forEach((row, Y) => row.forEach((c, X) => { if (c && Y * N + X !== ex) list.push([X, Y, c]) }))
      for (const [X, Y] of list) stoneShadow(x, g, ...this.at(X, Y), 1) // all shadows first so none overlaps a stone
      for (const [X, Y, c] of list) stone(x, g, X, Y, c, 1, this.at(X, Y), sk)
      this.stonesKey = stonesKey
    }

    const c = this.ctx
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, W, W)
    c.drawImage(this.base!, 0, 0)
    c.drawImage(this.stones!, 0, 0)
    c.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (own) deadHint(c, g, own, s.signMap, this.at)
    if (s.counting) countMarks(c, g, s.signMap, s.counting, this.at)
    if (s.focus || s.frame || s.marks?.length) paintMarks(c, i => g.P[i], i => g.P[i], g.cell, s.marks, s.focus, S, S, undefined, s.frame)
    if (a) { const ap = this.at(a.x, a.y); stoneShadow(c, g, ...ap, t); stone(c, g, a.x, a.y, a.c, t, ap, sk) }
    const w = this.shook, wk = w ? (now - w.start) / SHAKE_MS : 1
    if (w && wk < 1 && !s.signMap[w.y]?.[w.x]) {
      const dx = this.reducedMotion.matches ? 0 : Math.sin(wk * TAU * 4) * g.cell * 0.12 * (1 - wk), p: [number, number] = [g.P[w.x] + dx, g.P[w.y]]
      c.globalAlpha = 1 - sstep(0.45, 1, wk); stoneShadow(c, g, ...p, 1); stone(c, g, w.x, w.y, w.c, 1, p, sk); c.globalAlpha = 1
    } else this.shook = null
    const l = s.last
    if (l && s.signMap[l[1]]?.[l[0]] && (!a || t > 0.6)) lastRing(c, g, this.at(l[0], l[1]), s.signMap[l[1]][l[0]])
    if (s.pending) { c.globalAlpha = 0.5; stone(c, g, s.pending.v[0], s.pending.v[1], s.pending.sign, 1, undefined, sk); c.globalAlpha = 1 }
    const h = this.hover
    if (h && s.interactive && !s.signMap[h[1]]?.[h[0]]) {
      c.globalAlpha = 0.35; stone(c, g, h[0], h[1], s.toPlay, 1, undefined, sk); c.globalAlpha = 1
    }
    if (a || this.shook) this.req()
  }
}
