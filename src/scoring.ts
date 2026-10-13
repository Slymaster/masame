// End-of-game counting under Japanese rules: dead stones suggested from KataGo ownership, territory by flood fill,
// score = territory + prisoners (captures + dead stones), komi to White. Pure logic, no engine, no DOM.
// Seki: an empty region enclosed by one colour stays neutral when KataGo's mean |ownership| over it is below 0.3.

import type { Sign, SignMap, Vertex } from '@sabaki/go-board'

/** dead[y][x]: the stone at that point is counted as captured. */
export type Dead = boolean[][]

export interface Side { territory: number; prisoners: number; total: number }
export interface Score {
  /** Owner of each point counted as territory (empty points and dead stones), 0 elsewhere. */
  territory: Sign[][]
  black: Side
  white: Side
  /** Black's total minus White's (komi included): > 0 Black wins, < 0 White wins. */
  lead: number
}

const around = (n: number, [x, y]: Vertex): Vertex[] =>
  ([[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as Vertex[]).filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n)

/** Points connected to `start` through points satisfying `same`. */
function region(n: number, start: Vertex, same: (v: Vertex) => boolean): Vertex[] {
  const seen = new Set([start[1] * n + start[0]]), out = [start]
  for (let i = 0; i < out.length; i++) {
    for (const v of around(n, out[i])) {
      const k = v[1] * n + v[0]
      if (!seen.has(k) && same(v)) { seen.add(k); out.push(v) }
    }
  }
  return out
}

const chain = (m: SignMap, v: Vertex) => region(m.length, v, ([x, y]) => m[y][x] === m[v[1]][v[0]])

export const noDead = (m: SignMap): Dead => m.map(r => r.map(() => false))

/** Chains whose average ownership (row-major, +1 = Black) leans to the opponent by `threshold` or more. */
export function suggestDead(m: SignMap, ownership: number[], threshold = 0.6): Dead {
  const n = m.length, dead = noDead(m), done = new Set<number>()
  m.forEach((row, y) => row.forEach((s, x) => {
    if (!s || done.has(y * n + x)) return
    const c = chain(m, [x, y])
    c.forEach(([a, b]) => done.add(b * n + a))
    const lean = c.reduce((acc, [a, b]) => acc + ownership[b * n + a] * s, 0) / c.length
    if (lean <= -threshold) c.forEach(([a, b]) => { dead[b][a] = true })
  }))
  return dead
}

/** Flips the whole chain at `v` between dead and alive; empty points are ignored. */
export function toggleDead(m: SignMap, dead: Dead, v: Vertex): Dead {
  if (!m[v[1]][v[0]]) return dead
  const next = dead.map(r => [...r]), to = !dead[v[1]][v[0]]
  for (const [x, y] of chain(m, v)) next[y][x] = to
  return next
}

/** One decimal: komi like 7.3 must not leave float noise; `+ 0` turns -0 into 0. */
export const round1 = (x: number) => Math.round(x * 10) / 10 + 0

/** `captures`: stones each colour captured during play (Black's count = White stones taken).
 *  `ownership` (row-major, as for suggestDead): without it, no seki is detected. */
export function score(m: SignMap, dead: Dead, captures: { black: number; white: number }, komi: number, ownership?: number[] | null): Score {
  const n = m.length
  const alive = ([x, y]: Vertex) => (dead[y][x] ? 0 : m[y][x])
  const territory: Sign[][] = m.map(r => r.map(() => 0 as Sign)), seen = new Set<number>()
  m.forEach((row, y) => row.forEach((_, x) => {
    if (alive([x, y]) || seen.has(y * n + x)) return
    const r = region(n, [x, y], v => !alive(v))
    const borders = new Set<number>()
    for (const v of r) {
      seen.add(v[1] * n + v[0])
      for (const w of around(n, v)) if (alive(w)) borders.add(alive(w))
    }
    const seki = ownership && r.reduce((acc, [a, b]) => acc + Math.abs(ownership[b * n + a]), 0) / r.length < 0.3
    if (borders.size === 1 && !seki) { const [o] = borders as Set<Sign>; for (const [a, b] of r) territory[b][a] = o }
  }))
  const count = (f: (x: number, y: number) => boolean) => m.reduce((acc, row, y) => acc + row.filter((_, x) => f(x, y)).length, 0)
  const side = (s: Sign, taken: number, extra: number): Side => {
    const t = count((x, y) => territory[y][x] === s), p = taken + count((x, y) => dead[y][x] && m[y][x] === -s)
    return { territory: t, prisoners: p, total: round1(t + p + extra) }
  }
  const black = side(1, captures.black, 0), white = side(-1, captures.white, komi)
  return { territory, black, white, lead: round1(black.total - white.total) }
}
