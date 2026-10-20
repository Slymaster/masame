// Pure logic of the 3D goban (no three.js, no DOM): real dimensions, hand-placed jitter + fitting, time of day,
// the décors' looks, the quality governor and the contrast measure. Covered by logic.test.ts.

import { hash, rng } from '../board/noise'
import type { Decor } from './decors'

/* ---------- real dimensions (mm) ---------- */
export const SX = 22, SZ = 23.7          // grid spacing across / along (cells are longer than wide)
export const BT = 60                      // board thickness (a table board, not a legged one)

/** A stone set's shape (mm): radii of the black and white stones, half thickness, and the lens profile's exponent. */
export interface StoneShape { rB: number; rW: number; sh: number; lensExp: number }

/** Half thickness of a biconvex stone of half thickness sh at distance r from its axis (dome with a rounded girdle). */
export const lens = (r: number, R: number, sh: number, exp: number) => sh * Math.pow(Math.max(0, 1 - (r / R) ** 2), exp)

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

/** Jitter amplitudes (mm): across, where the 22 mm spacing leaves no slack, and along the 23.7 mm rows. */
export const JIT_ACROSS = 0.8, JIT_ALONG = 2.2
/** Smallest offset, as a fraction of the amplitude: no stone sits dead centre. */
export const JIT_MIN = 0.4

/** Stable hand-placed look per (point, move number): an elliptical offset, random spin and material seed. */
export function jitter(N: number, x: number, y: number, moveNo: number, across = JIT_ACROSS, along = JIT_ALONG) {
  const r = rng(Math.floor(hash(x, y, moveNo * 7 + 3) * 4294967296))
  const a = r() * Math.PI * 2, m = JIT_MIN + (1 - JIT_MIN) * Math.sqrt(r())
  return { jx: gx(N, x) + Math.cos(a) * m * across, jz: gz(N, y) + Math.sin(a) * m * along, seed: r(), rotY: r() * Math.PI * 2 }
}

/** Placing: the last 12 mm of the fall, then the fingers' last push, a SLIDE_MM slide into place once the stone touches. */
export const DROP_MS = 140, SLIDE_MS = 90, SLIDE_MM = 1
/** The new stone ms after release: height above rest (mm), the contact shadow's tightening k, and the share of the slide still to go. */
export function dropPose(ms: number) {
  const t = Math.min(1, Math.max(0, ms / DROP_MS)), u = Math.min(1, Math.max(0, (ms - DROP_MS) / SLIDE_MS))
  return { y: 12 * (1 - t * t), k: t * t, slide: (1 - u) * (1 - u) } // eases out: friction stops it
}

/**
 * Stones never move once down, so a newcomer fits itself around the stones already there (22 mm spacing < 22.2 mm
 * slate diameter): a few passes pushing only it out of any overlap, from its jittered spot into tx/tz.
 * shortcut: squeezed between two neighbours that were themselves placed inwards, an overlap of about 1 mm can remain
 * (settle() limits the rest); upgrade only if stones may ever move once down.
 */
export function fit(s: Placed, stones: Map<number, Placed>, N: number, iterations = 24) {
  s.tx = s.jx; s.tz = s.jz
  for (let it = 0; it < iterations; it++) {
    let mx = 0, mz = 0 // all overlaps at once, so a squeezed stone settles midway instead of bouncing between neighbours
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x2 = s.x + dx, y2 = s.y + dy
      if ((!dx && !dy) || x2 < 0 || y2 < 0 || x2 >= N || y2 >= N) continue
      const o = stones.get(y2 * N + x2)
      if (!o || o === s) continue
      const vx = s.tx - o.tx, vz = s.tz - o.tz, d = Math.hypot(vx, vz) || 1e-6, min = s.R + o.R + 0.12
      if (d < min) { mx += vx * (min - d) / d; mz += vz * (min - d) / d }
    }
    if (!mx && !mz) return
    s.tx += 0.6 * mx; s.tz += 0.6 * mz
  }
}

/** Overlap allowed after fitting (mm): centred slate stones already sit 0.2 mm into each other across the 22 mm spacing. */
export const FIT_TOL = 0.3
/**
 * Room a stone leaves for each empty neighbouring point (mm): a stone of its own size centred there may overlap it by
 * at most this. Stones never move, so this is what keeps a later newcomer from being squeezed; it limits a lone stone
 * only across (22 mm spacing), and only slate: to ≈0.6 mm.
 */
export const FIT_ROOM = 0.8
/** Hard cap on a placed stone's distance from its grid point (mm). */
export const FIT_REACH = 4.5

/** Smallest gap (mm, negative = overlap) between a stone and its 8 neighbours, and that neighbour. */
function nearest(s: Placed, stones: Map<number, Placed>, N: number): [number, Placed | null] {
  let w = Infinity, n: Placed | null = null
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x2 = s.x + dx, y2 = s.y + dy, o = (dx || dy) && x2 >= 0 && y2 >= 0 && x2 < N && y2 < N ? stones.get(y2 * N + x2) : undefined
    if (!o || o === s) continue
    const g = Math.hypot(s.tx - o.tx, s.tz - o.tz) - s.R - o.R
    if (g < w) { w = g; n = o }
  }
  return [w, n]
}
export const worstGap = (s: Placed, stones: Map<number, Placed>, N: number) => nearest(s, stones, N)[0]

/** How far (mm) a stone at its current spot breaks FIT_TOL against its neighbours and FIT_ROOM towards empty points. */
function excess(s: Placed, stones: Map<number, Placed>, N: number, cx: number, cz: number, sx: number, sz: number) {
  let room = Infinity
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x2 = s.x + dx, y2 = s.y + dy
    if ((!dx && !dy) || x2 < 0 || y2 < 0 || x2 >= N || y2 >= N || stones.has(y2 * N + x2)) continue
    room = Math.min(room, Math.hypot(s.tx - cx - dx * sx, s.tz - cz - dy * sz) - 2 * s.R)
  }
  return Math.max(0, -worstGap(s, stones, N) - FIT_TOL) + Math.max(0, -room - FIT_ROOM)
}

/**
 * fit(), and when that leaves the newcomer overlapping by more than FIT_TOL, crowding an empty point (FIT_ROOM) or past
 * FIT_REACH, it tries a few spots, like a stone pushed by its neighbours: its jitter scaled down (each fitted), and small
 * steps from its grid point (cx, cz) away from the neighbour it hits most (raw and fitted). It keeps the spot with the
 * least excess within FIT_REACH, then the one closest to its jitter. Stones already down never move.
 * (sx, sz): grid spacing, for the empty points around it.
 */
export function settle(s: Placed, stones: Map<number, Placed>, N: number, cx: number, cz: number, sx = SX, sz = SZ) {
  const ok = () => Math.hypot(s.tx - cx, s.tz - cz) <= FIT_REACH
  fit(s, stones, N)
  if (ok() && !excess(s, stones, N, cx, cz, sx, sz)) return
  const o = nearest(s, stones, N)[1], jx = s.jx, jz = s.jz, cands: number[][] = []
  for (const f of [1, 0.75, 0.5, 0.25, 0]) { s.jx = cx + (jx - cx) * f; s.jz = cz + (jz - cz) * f; fit(s, stones, N); cands.push([s.tx, s.tz]) }
  const ux = o ? cx - o.tx : 0, uz = o ? cz - o.tz : 0, ul = Math.hypot(ux, uz) || 1
  for (const d of [0, 0.5, 1, 1.5]) {
    s.jx = cx + ux / ul * d; s.jz = cz + uz / ul * d
    cands.push([s.jx, s.jz]); fit(s, stones, N); cands.push([s.tx, s.tz])
  }
  let best = Infinity, bx = cx, bz = cz
  for (const [tx, tz] of cands) {
    s.tx = tx; s.tz = tz
    if (!ok()) continue
    const score = excess(s, stones, N, cx, cz, sx, sz) * 1e3 + Math.hypot(tx - jx, tz - jz)
    if (score < best) { best = score; bx = tx; bz = tz }
  }
  s.jx = jx; s.jz = jz; s.tx = bx; s.tz = bz
}

/* ---------- stones at rest in a bowl or on a lid ---------- */
export interface Rest { x: number; z: number; y: number; tilt: number; dir: number }

/**
 * Drops stones one after another at the given (x, z) onto a floor (centre height of a lone stone at distance d from
 * the axis) and onto the stones already there. Two flat lenses d apart clear each other when their centres differ by
 * 2·lens(d/2) (the profile is concave, so the closest pair of surfaces is midway). A stone resting on another dips away
 * from it; it is raised by R·sin(tilt) so the tilt can't reach into anything either. Stones landing above maxY are dropped.
 */
export function dropStones(xz: number[][], R: number, shape: StoneShape, floor: (d: number) => number, rnd: () => number, maxTilt = 0.1, maxY = Infinity): Rest[] {
  const out: Rest[] = []
  for (const [x, z] of xz) {
    let y = floor(Math.hypot(x, z)), on: Rest | null = null
    for (const o of out) {
      const d = Math.hypot(x - o.x, z - o.z)
      const h = 2 * lens(d / 2, R, shape.sh, shape.lensExp)
      if (d < 2 * R && o.y + h > y) { y = o.y + h; on = o }
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
export interface Tod { az: number; el: number; K: number; I: number; env: number; exp: number; room: number }
export const TOD: Record<TimeName, Tod> = {
  morning: { az: 200, el: 27, K: 5500, I: 3.3, env: 0.62, exp: 0.95, room: 1 },
  afternoon: { az: 232, el: 40, K: 4200, I: 3.5, env: 0.55, exp: 0.88, room: 0.8 },
  evening: { az: 318, el: 14, K: 3000, I: 6.0, env: 0.4, exp: 1.12, room: 0.3 },
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

/* ---------- seasons ---------- */
const DAY = 86_400_000, YEAR = 365.2422, LAT = 45 * Math.PI / 180
const EQUINOX = Date.UTC(2000, 2, 20, 7, 35) // a March equinox: the declination's phase, continuous across new years
const JAN15 = Date.UTC(2000, 0, 15)

/** Local standard time in ms (the date's UTC offset without daylight saving), so clocks changing never move the sun.
 *  shortcut: no location is asked, so solar noon is taken at 13 h standard time (France, Spain, most of Europe's west sit
 *  that far from their zone's meridian); elsewhere the sun is off by up to an hour. */
function standardMs(date: Date): number {
  const y = date.getFullYear(), std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset())
  return date.getTime() - std * 60_000
}

/** The sun on a date at latitude 45°: its declination (deg), the solar hour (noon at 13 h standard time) and half the day's length (hours). */
export function sunOn(date: Date): { decl: number; hour: number; halfDay: number } {
  const ms = standardMs(date)
  const decl = 23.44 * Math.sin(2 * Math.PI * ((ms - EQUINOX) / DAY) / YEAR)
  const hour = (((ms / 3_600_000 - 1) % 24) + 24) % 24
  const halfDay = Math.acos(-Math.tan(LAT) * Math.tan(decl * Math.PI / 180)) * 12 / Math.PI
  return { decl, hour, halfDay }
}

/** Dec–Feb weight (0..1), highest mid-January: a snowy garden outside the Washitsu's shoji. */
export function snowOn(date: Date): number {
  const d = ((((standardMs(date) - JAN15) / DAY) % YEAR) + YEAR) % YEAR, off = Math.min(d, YEAR - d)
  return Math.max(0, Math.cos(Math.PI / 2 * off / 80))
}

/**
 * "Auto" through the year: the hour's light (todAt, an equinox day: unchanged then) stretched so that its golden hour
 * ends at the date's sunset, so summer's lasts longer and winter's is brief; the sun higher in summer (its noon height at 45°,
 * damped), its path wider; winter's light low, cold and a little dimmer. In the Washitsu, Dec–Feb, snow outside makes
 * the room brighter and colder. Other décors' fixed lights (the Lanterne) are not touched here: Board3D uses LOOKS.tod.
 */
export function seasonTod(date: Date, decor: Decor): Tod {
  const { decl, hour: h, halfDay: D } = sunOn(date)
  // the day (sunrise..sunset) onto todAt's 7..19 h (an equinox with noon at 13 h), the night onto its 19..7 h: continuous, monotone
  const N = 12 - D, w = h < 12 - D ? 7 - (12 - D - h) * 6 / N : h > 12 + D ? 19 + (h - 12 - D) * 6 / N : 13 + (h - 12) * 6 / D
  const b = todAt(w), s = decl / 23.44, winter = Math.max(0, -s), summer = Math.max(0, s)
  const tod: Tod = {
    az: 225 + (b.az - 225) * (1 + 0.25 * s),
    el: b.el * (1 + 0.8 * decl / 45),
    K: b.K + 3200 * winter - 450 * summer,
    I: b.I * (1 - 0.3 * winter),
    env: b.env * (1 + 0.1 * winter),
    exp: b.exp,
    room: b.room * (1 - 0.45 * winter),
  }
  if (decor === 'washitsu') {
    const snow = snowOn(date)
    tod.env *= 1 + 0.5 * snow; tod.K += 900 * snow; tod.exp *= 1 + 0.06 * snow
  }
  return tod
}

/** The UI card's skin follows the scene's backdrop: Laque on the dark rooms (the Lanterne, the Atelier seen in
 *  Contemplation), Washi on light ones (Study's linen, Clair and Washitsu) and always in 2D. */
export function cardSkin(renderer: '2d' | '3d', camera: 'study' | 'contemplation', decor: Decor): 'washi' | 'laque' {
  return renderer === '3d' && (decor === 'lanterne' || (camera === 'contemplation' && decor === 'atelier')) ? 'laque' : 'washi'
}

/* ---------- décors ---------- */
export type Ground = 'walnut' | 'tatami' | 'paper'
/** What a décor changes around the (identical) board, stones and bowls. Multipliers apply to the hour's light. */
export interface Look {
  /** Poly Haven HDRI in assets/board3d (`<sky>_1k.hdr`); null = three's procedural RoomEnvironment. */
  sky: string | null
  /** Azimuth (rad, as atan2(z, x) in three's equirect mapping) of the sky's energy-weighted brightest side: turned to the key's bearing. */
  skyAz: number
  /** null: follows the time of day. Otherwise the décor's own fixed light (Lanterne: a night with no window). */
  tod: Tod | null
  ground: Ground
  /** Ground colour multiplier (walnut: also darkened with the room's brightness). */
  tint: number
  rough: number
  /** Contemplation: the ground fades out into the dark of the room (otherwise it fills the view). */
  fade: boolean
  /** Study keeps the app's linen (transparent canvas) instead of drawing the ground. */
  linen: boolean
  key: number; ibl: number; exp: number
  /** Shadow penumbra and strength multipliers. */
  soft: number; shade: number
  /** Lanterne: a warm spot over the board, in units of 1e6 cd at 1 m (0 = none: the window key casts the shadows). */
  lamp: number
  /** Contemplation: the share of the window's light that comes through a shoji, its lattice falling on the board (0 = an open window). */
  shoji: number
  /** Contemplation, fx ≥ 1: the décor's HDRI shown behind the room, blurred (backgroundBlurriness) and dimmed. Absent = the dark room. */
  backdrop?: { blur: number; intensity: number }
}
const NIGHT: Tod = { az: 215, el: 64, K: 2650, I: 0, env: 0.5, exp: 1, room: 0 }
export const LOOKS: Record<Decor, Look> = {
  atelier: { sky: 'studio_country_hall', skyAz: 0.52, tod: null, ground: 'walnut', tint: 1, rough: 0.72, fade: true, linen: true, key: 1, ibl: 1, exp: 1, soft: 1, shade: 1, lamp: 0, shoji: 0 },
  washitsu: { sky: 'empty_play_room', skyAz: 0.38, tod: null, ground: 'tatami', tint: 0.92, rough: 0.82, fade: false, linen: false, key: 0.92, ibl: 1.1, exp: 1, soft: 1.3, shade: 0.95, lamp: 0, shoji: 0.35 },
  // time of day has no effect here: a lantern at night
  lanterne: { sky: 'studio_country_hall', skyAz: 0.52, tod: NIGHT, ground: 'walnut', tint: 0.5, rough: 0.72, fade: true, linen: false, key: 0, ibl: 0.25, exp: 1.6, soft: 1, shade: 1, lamp: 3.6, shoji: 0 },
  // skyAz: estimate from RoomEnvironment's layout (its two strong side panels at ±153°, the third at 92°), not measured on a render
  clair: { sky: null, skyAz: 2.9, tod: null, ground: 'paper', tint: 1, rough: 0.94, fade: false, linen: false, key: 0.9, ibl: 0.9, exp: 0.82, soft: 2, shade: 0.8, lamp: 0, shoji: 0 },
}

/* ---------- adaptive quality governor ---------- */
/** fx: Contemplation's décor effects. 2 = all, animated; 1 = still (backdrop, a still light cookie, no particles); 0 = none. */
export interface Quality { dpr: number; shadow: number; msaa: number; bowlSegments: number; kaya4k: boolean; fx: 0 | 1 | 2 }
/** Quality ladder, best first. The pixel ratio is capped by the display's own (and at 3); for d ≤ 2 the values are v0.2's. */
export function qualityLadder(deviceDpr: number): Quality[] {
  const d = Math.min(Math.max(deviceDpr, 1), 3)
  return [
    { dpr: d, shadow: 4096, msaa: 4, bowlSegments: 72, kaya4k: true, fx: 2 },
    { dpr: d, shadow: 2048, msaa: 4, bowlSegments: 72, kaya4k: true, fx: 2 },
    { dpr: Math.min(d, Math.max(1.5, 0.75 * d)), shadow: 2048, msaa: 4, bowlSegments: 48, kaya4k: false, fx: 1 },
    { dpr: Math.min(d, Math.max(1.25, 0.625 * d)), shadow: 2048, msaa: 0, bowlSegments: 48, kaya4k: false, fx: 1 },
    { dpr: 1, shadow: 1024, msaa: 0, bowlSegments: 32, kaya4k: false, fx: 0 },
  ]
}

/**
 * Quality is decided once: a short measured warm-up at startup and after a resize (`measured`), then only a step down
 * on sustained slowness (`sample`). It never steps back up during play (only `restart`, after a big shrink), so a still
 * board never shifts between levels; the view applies a runtime step only at its next scene change. Render on demand: only animated frames are sampled.
 * A window averaging slower than 50 fps steps one level down; at the bottom, a window slower than 30 fps asks for the 2D fallback.
 */
export class Governor {
  level = 0
  private dts: number[] = []
  constructor(readonly levels: number, readonly window = 30, readonly slowMs = 20, readonly fallbackMs = 33, readonly budgetMs = 12) {}
  /** Warm-up: ms per GPU-synchronised full frame at the current level. True = stepped down (measure again). */
  measured(ms: number): boolean {
    if (this.level < this.levels - 1 && ms > this.budgetMs) { this.level++; this.dts = []; return true }
    return false
  }
  /** Back to the top before a fresh warm-up (the canvas shrank a lot, so the old level may be too cautious). */
  restart() { this.level = 0; this.dts = [] }
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

/** Most frames per second a décor's ambient animation (leaves, snow) is drawn at. */
export const AMBIENT_FPS = 30
/**
 * Whether a décor's ambient animation may run this frame: an animated scene, in Contemplation, at fx 2 (the two best
 * quality levels), the window visible and focused, motion not reduced, and nothing else animating (a stone falling,
 * a crossfade: those frames are the governor's to measure, and ambient frames are never sampled).
 */
export function ambientOn(o: { animated: boolean; contemplation: boolean; fx: number; visible: boolean; focused: boolean; reducedMotion: boolean; busy: boolean }) {
  return o.animated && o.contemplation && o.fx >= 2 && o.visible && o.focused && !o.reducedMotion && !o.busy
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

/* ---------- seated camera (Contemplation) ---------- */
export const FOV = 28, TILT_HOME = (22 * Math.PI) / 180, TGT_Y = -6
/** Visible height (mm) of the seated view: the whole board stays in frame, bowls partly out ("framing A", 1.33× v0.2). */
export const seatHeight = (BW: number, BD: number, aspect: number) => Math.max(BD * 1.12, ((BW + 380) * 1.04) / 1.33 / Math.max(0.4, aspect))

/** yaw/tilt in rad (tilt from vertical), zoom = share of the home distance, (tx, tz) the target on the plane y = TGT_Y. */
export interface Orbit { yaw: number; tilt: number; zoom: number; tx: number; tz: number }
export const HOME: Readonly<Orbit> = { yaw: 0, tilt: TILT_HOME, zoom: 1, tx: 0, tz: 14 }
/** Closest zoom: this many mm in view. */
export const ZOOM_MM = 140
const YAW_MAX = Math.PI / 3, TILT_MIN = (5 * Math.PI) / 180, TILT_MAX = (58 * Math.PI) / 180
const clampV = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Limits for a visible height hc: zoom 1 is the home distance. The target may leave home by a quarter of the board at
 *  zoom 1, and up to the corners as the view zooms in: the view's centre always shows the board, and zooming out of a
 *  corner draws the board back into view. */
export function clampOrbit(o: Orbit, hc: number, BW: number, BD: number): Orbit {
  const zMin = Math.min(1, ZOOM_MM / hc), zoom = clampV(o.zoom, zMin, 1), s = zMin < 1 ? (1 - zoom) / (1 - zMin) : 0
  const cx = HOME.tx * (1 - s), cz = HOME.tz * (1 - s), hx = (BW / 4) * (1 + s), hz = (BD / 4) * (1 + s)
  return { yaw: clampV(o.yaw, -YAW_MAX, YAW_MAX), tilt: clampV(o.tilt, TILT_MIN, TILT_MAX), zoom, tx: clampV(o.tx, cx - hx, cx + hx), tz: clampV(o.tz, cz - hz, cz + hz) }
}

/** Pan: the camera slides by a - b on the plane y = TGT_Y, so the point a (grabbed) shows where b (now under the cursor) was. */
export const panBy = (o: Orbit, ax: number, az: number, bx: number, bz: number): Orbit => ({ ...o, tx: o.tx + ax - bx, tz: o.tz + az - bz })

/** Zoom by k about the point (px, TGT_Y, pz): the whole camera scales about it, so that point stays under the cursor. */
export const zoomAt = (o: Orbit, k: number, px: number, pz: number): Orbit => ({ ...o, zoom: o.zoom * k, tx: px + k * (o.tx - px), tz: pz + k * (o.tz - pz) })

/** Camera for an orbit at visible height hc: no roll (up stays horizontal, pointing away from the player). */
export function orbitEye(o: Orbit, hc: number) {
  const dist = (hc * o.zoom) / 2 / Math.tan((FOV * Math.PI) / 360), h = Math.sin(o.tilt) * dist
  const sy = Math.sin(o.yaw), cy = Math.cos(o.yaw)
  return { eye: [o.tx + h * sy, TGT_Y + dist * Math.cos(o.tilt), o.tz + h * cy], target: [o.tx, TGT_Y, o.tz], up: [-sy, 0, -cy], dist }
}

/** Moves cur towards goal (exponential follow, τ = 70 ms; at once under reduced motion). True while still moving. */
export function stepOrbit(cur: Orbit, goal: Orbit, dt: number, instant = false): boolean {
  const a = instant ? 1 : 1 - Math.exp(-dt / 70)
  let moving = false
  for (const k of ['yaw', 'tilt', 'zoom', 'tx', 'tz'] as const) {
    const d = goal[k] - cur[k], eps = k === 'tx' || k === 'tz' ? 0.02 : 1e-4
    if (Math.abs(d) * (1 - a) < eps) cur[k] = goal[k]
    else { cur[k] += d * a; moving = true }
  }
  return moving
}

export type WheelIntent = 'zoom' | 'orbit' | 'pan'
/**
 * Mouse wheel or trackpad, from the wheel event alone: pinches arrive as ctrl+wheel (Chromium, WebView2, Firefox);
 * a gesture keeps its first verdict through its momentum; line/page deltas and horizontal deltas tell a wheel from a
 * trackpad; macOS mouse notches come as multiples of 4.000244 px, Windows notches as ≥ 40 px; anything else is a
 * two-finger swipe (a pan with Shift).
 */
/** WebKit (WKWebView, Safari) sends a pinch both as gesture events and as ctrl+wheel: only the gesture events count there. */
export const skipPinchWheel = (ctrlKey: boolean, gestureEvents: boolean) => ctrlKey && gestureEvents

export function wheelIntent(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey?: boolean }, prev: WheelIntent | null, gapMs: number): WheelIntent {
  if (e.ctrlKey) return 'zoom'
  if (prev && gapMs < 250) return prev
  if (e.deltaMode !== 0) return 'zoom'
  const swipe = e.shiftKey ? 'pan' : 'orbit'
  if (e.deltaX !== 0) return swipe
  const d = Math.abs(e.deltaY), n = Math.round(d / 4.000244)
  return d >= 40 || (n > 0 && Math.abs(d - n * 4.000244) < 1e-4 * n) ? 'zoom' : swipe
}

/**
 * The point a ray points at in the seated view: the first stone it crosses (lens shape) between y = 2·sh and the board,
 * otherwise the board surface at y = 0, rounded to the nearest intersection (null off the grid).
 */
export function pickPoint(o: number[], d: number[], N: number, stones: Map<number, Placed>, shape: StoneShape): [number, number] | null {
  if (d[1] >= 0) return null
  const SH = shape.sh, t0 = (2 * SH - o[1]) / d[1], t1 = -o[1] / d[1], n = Math.ceil(((t1 - t0) * Math.hypot(d[0], d[2])) / 0.5) + 1
  for (let k = 0; k <= n; k++) {
    const t = t0 + ((t1 - t0) * k) / n, x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t
    const i = Math.round(x / SX + (N - 1) / 2), j = Math.round(z / SZ + (N - 1) / 2)
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i2 = i + di, j2 = j + dj, s = i2 >= 0 && j2 >= 0 && i2 < N && j2 < N ? stones.get(j2 * N + i2) : undefined
      if (s && Math.abs(y - SH) < lens(Math.hypot(x - s.tx, z - s.tz), s.R, SH, shape.lensExp)) return [s.x, s.y]
    }
  }
  const x = o[0] + d[0] * t1, z = o[2] + d[2] * t1, i = Math.round(x / SX + (N - 1) / 2), j = Math.round(z / SZ + (N - 1) / 2)
  if (i < 0 || j < 0 || i >= N || j >= N || Math.abs(x - gx(N, i)) > SX * 0.5 || Math.abs(z - gz(N, j)) > SZ * 0.5) return null
  return [i, j]
}
