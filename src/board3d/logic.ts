// Pure logic of the 3D goban (no three.js, no DOM): real dimensions, hand-placed jitter + relaxation, time of day,
// the adaptive quality governor and the contrast measure. Covered by logic.test.ts.

import { hash, rng } from '../board/noise'

/* ---------- real dimensions (mm) ---------- */
export const SX = 22, SZ = 23.7          // grid spacing across / along (cells are longer than wide)
export const BT = 60                      // board thickness (a table board, not a legged one)
export const RB = 11.1, RW = 10.95        // stone radii: slate 22.2 mm, shell 21.9 mm
export const SH = 4.5                     // stone half thickness

/** Half thickness of a biconvex stone at distance r from its axis (dome with a rounded girdle). */
export const lens = (r: number, R: number) => SH * Math.pow(Math.max(0, 1 - (r / R) ** 2), 0.78)

/** Board top size: a 19×19 is 424 × 454 mm; smaller boards keep the cell size. Coordinates widen the margin for the labels. */
export function dims(N: number, coords: boolean) {
  const m = coords ? 30 : 14
  return { N, BW: (N - 1) * SX + 2 * m, BD: (N - 1) * SZ + 2 * (m - 0.3), margin: m }
}
export const gx = (N: number, i: number) => (i - (N - 1) / 2) * SX
export const gz = (N: number, j: number) => (j - (N - 1) / 2) * SZ

/** Hoshi offsets in cells from the centre. */
export const hoshiStep = (N: number) => (N >= 19 ? 6 : N >= 13 ? 3 : N >= 9 ? 2 : 0)

/* ---------- placement: jitter and relaxation ---------- */
export interface Placed { x: number; y: number; R: number; jx: number; jz: number; tx: number; tz: number }

/** Stable hand-placed look per (point, move number): ±1.5 mm offset, random spin, wobble axis and material seed. */
export function jitter(N: number, x: number, y: number, moveNo: number) {
  const r = rng(Math.floor(hash(x, y, moveNo * 7 + 3) * 4294967296))
  const a = r() * Math.PI * 2, m = Math.sqrt(r()) * 1.5
  return { jx: gx(N, x) + Math.cos(a) * m, jz: gz(N, y) + Math.sin(a) * m, seed: r(), rotY: r() * Math.PI * 2, wobAxis: r() * Math.PI * 2 }
}

/** Neighbours never interpenetrate (22 mm spacing < 22.2 mm slate diameter): a few relaxation passes on targets tx/tz. */
export function relax(stones: Map<number, Placed>, N: number, iterations = 8) {
  for (const s of stones.values()) { s.tx = s.jx; s.tz = s.jz }
  for (let it = 0; it < iterations; it++) for (const s of stones.values()) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const x2 = s.x + dx, y2 = s.y + dy
    if (x2 < 0 || y2 < 0 || x2 >= N || y2 >= N) continue
    const o = stones.get(y2 * N + x2)
    if (!o) continue
    const vx = o.tx - s.tx, vz = o.tz - s.tz, d = Math.hypot(vx, vz) || 1e-6, min = s.R + o.R + 0.12
    if (d < min) { const k = (min - d) / 2 / d; s.tx -= vx * k; s.tz -= vz * k; o.tx += vx * k; o.tz += vz * k }
  }
}

/* ---------- stones at rest in a bowl or on a lid ---------- */
export interface Rest { x: number; z: number; y: number; tilt: number; dir: number }

/**
 * Drops stones one after another at the given (x, z) onto a floor (centre height of a lone stone at distance d from
 * the axis) and onto the stones already there. Two flat lenses d apart clear each other when their centres differ by
 * 2·lens(d/2) (the profile is concave, so the closest pair of surfaces is midway). A stone resting on another dips away
 * from it; it is raised by R·sin(tilt) so the tilt can't reach into anything either. Stones landing above maxY are dropped.
 */
export function dropStones(xz: number[][], R: number, floor: (d: number) => number, rnd: () => number, maxTilt = 0.1, maxY = Infinity): Rest[] {
  const out: Rest[] = []
  for (const [x, z] of xz) {
    let y = floor(Math.hypot(x, z)), on: Rest | null = null
    for (const o of out) {
      const d = Math.hypot(x - o.x, z - o.z)
      if (d < 2 * R && o.y + 2 * lens(d / 2, R) > y) { y = o.y + 2 * lens(d / 2, R); on = o }
    }
    const tilt = on ? maxTilt * (0.5 + 0.5 * rnd()) : maxTilt * 0.25 * rnd()
    const dir = on ? Math.atan2(z - on.z, x - on.x) : rnd() * Math.PI * 2
    if (y + R * Math.sin(tilt) <= maxY) out.push({ x, z, y: y + R * Math.sin(tilt), tilt, dir }) // too high: it would roll off
  }
  return out
}

/** A bowl's visible top: a hexagonal bed (rotated, jittered) inside rMax, then a few stones heaped towards the middle. */
export function bowlHeap(R: number, rMax: number, top: number, rnd: () => number): number[][] {
  const s = 2 * R + 0.6, a = rnd() * Math.PI, ox = rnd() * s, oz = rnd() * s, pts: number[][] = []
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) {
    const u = (i + (j & 1) / 2) * s + ox - s / 2, v = j * s * Math.sqrt(3) / 2 + oz - s / 2
    const x = u * Math.cos(a) - v * Math.sin(a) + (rnd() - 0.5) * 0.5, z = u * Math.sin(a) + v * Math.cos(a) + (rnd() - 0.5) * 0.5
    if (Math.hypot(x, z) <= rMax) pts.push([x, z])
  }
  for (let k = 0; k < top; k++) { const r = rMax * 0.65 * Math.sqrt(rnd()), t = rnd() * Math.PI * 2; pts.push([Math.cos(t) * r, Math.sin(t) * r]) }
  return pts
}

/* ---------- time of day ---------- */
export type TimeName = 'morning' | 'afternoon' | 'evening'
/** room: brightness of the surroundings in Contemplation (the table and the dark around it). */
export interface Tod { az: number; el: number; K: number; I: number; env: number; rot: number; exp: number; room: number }
export const TOD: Record<TimeName, Tod> = {
  morning: { az: 200, el: 27, K: 5500, I: 3.3, env: 0.62, rot: 0.4, exp: 0.95, room: 1 },
  afternoon: { az: 232, el: 40, K: 4200, I: 3.5, env: 0.55, rot: 1.6, exp: 0.88, room: 0.8 },
  evening: { az: 318, el: 14, K: 3000, I: 6.0, env: 0.4, rot: 3.0, exp: 1.12, room: 0.3 },
}
export const mixTod = (a: Tod, b: Tod, t: number): Tod =>
  Object.fromEntries(Object.keys(a).map(k => [k, a[k as keyof Tod] + (b[k as keyof Tod] - a[k as keyof Tod]) * t])) as unknown as Tod

/** "Auto": the light follows the local hour. 9 h morning, 14 h afternoon, 19 h and the night evening, eased in between. */
export function todAt(hours: number): Tod {
  const h = ((hours % 24) + 24) % 24
  const keys: [number, Tod][] = [[0, TOD.evening], [6, TOD.evening], [9, TOD.morning], [11.5, TOD.morning], [14, TOD.afternoon], [16.5, TOD.afternoon], [19, TOD.evening], [24, TOD.evening]]
  for (let k = 1; k < keys.length; k++) if (h <= keys[k][0]) {
    const [h0, a] = keys[k - 1], [h1, b] = keys[k], t = (h - h0) / (h1 - h0)
    return mixTod(a, b, t * t * (3 - 2 * t))
  }
  return TOD.evening
}

/* ---------- adaptive quality governor ---------- */
export interface Quality { dpr: number; shadow: number; msaa: number; bowlSegments: number }
/** Quality ladder, best first. The pixel ratio is capped by the display's own. */
export function qualityLadder(deviceDpr: number): Quality[] {
  const d = Math.min(Math.max(deviceDpr, 1), 2)
  return [
    { dpr: d, shadow: 4096, msaa: 4, bowlSegments: 72 },
    { dpr: d, shadow: 2048, msaa: 4, bowlSegments: 72 },
    { dpr: Math.min(d, 1.5), shadow: 2048, msaa: 4, bowlSegments: 48 },
    { dpr: Math.min(d, 1.25), shadow: 2048, msaa: 0, bowlSegments: 48 },
    { dpr: 1, shadow: 1024, msaa: 0, bowlSegments: 32 },
  ]
}

/**
 * Watches frame intervals while something animates (render on demand: still frames don't count).
 * A window averaging slower than 50 fps steps one level down; at the bottom, a window slower than 30 fps asks for the 2D fallback.
 * shortcut: downgrades only (no upgrade probing) — the level resets with the next Board3D instance.
 */
export class Governor {
  level = 0
  private dts: number[] = []
  constructor(readonly levels: number, readonly window = 30, readonly slowMs = 20, readonly fallbackMs = 33) {}
  /** dt = interval between two consecutive animated frames, ms. */
  sample(dt: number): 'down' | 'fallback' | null {
    if (dt <= 0 || dt > 100) { this.dts = []; return null } // hidden tab, first frame after idle, debugger
    this.dts.push(dt)
    if (this.dts.length < this.window) return null
    const avg = this.dts.reduce((a, b) => a + b, 0) / this.dts.length
    this.dts = []
    if (this.level < this.levels - 1 && avg > this.slowMs) { this.level++; return 'down' }
    if (this.level === this.levels - 1 && avg > this.fallbackMs) return 'fallback'
    return null
  }
}

/* ---------- readability ---------- */
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
export const luminance = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
/** WCAG contrast ratio between two sRGB colours (0–255). */
export function contrast(a: number[], b: number[]) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/**
 * Silhouette rule: going round a stone, every direction must cross a dark edge (its shadow-side rim, its contact line
 * or its cast shadow) with enough contrast against the board around it (target 3:1 in Study). `rays` = per direction,
 * the sRGB samples across the edge; `board` = the stone's local lit wood (not the shadow it casts). Returns the worst
 * direction's darkest-edge contrast (1 when a direction has nothing darker than the board, Infinity with no rays).
 */
export function silhouette(rays: number[][][], board: number[]) {
  const lb = luminance(board)
  let worst = Infinity
  for (const across of rays) worst = Math.min(worst, Math.max(1, ...across.filter(p => luminance(p) < lb).map(p => contrast(p, board))))
  return worst
}

/* ---------- sound ---------- */
/** Stereo position of a stone: the board spans about ±0.55 of the field, like sitting at it. */
export const panFor = (N: number, x: number) => (N > 1 ? (x / (N - 1)) * 2 - 1 : 0) * 0.55
