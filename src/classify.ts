// Move classification after a review, after chess.com: expected points (a win chance at the mover's level) lost by each move.
// Pure: the scan's positions (Pos) and per-move facts come from review.ts; see .claude/coups-spec.md.

import type { SignMap } from '@sabaki/go-board'
import type { Game, Sign, Vertex } from './game'

export type Cat = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'miss' | 'blunder'
export const CATS: Cat[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder']
export const NOTABLE: Cat[] = ['brilliant', 'great', 'miss', 'mistake', 'blunder']

export interface Cand { v: Vertex | null; lead: number; visits: number; prior: number } // lead: Black's, after v
export interface Pos {
  lead: number // root scoreLead, Black's
  u: number // mean (1 − |ownership|), 0..1
  cands: Cand[] // ≤ 6, KataGo's order
  pv: (Vertex | null)[] // top move's line, ≤ 7
  deep?: true // re-read by the deeper confirmation search
}
export interface Facts { sac: number; book: boolean }
export interface Levels { black: number; white: number }
export interface Judged {
  cat: Cat
  loss: number // points lost by the mover, ≥ 0
  dEP: number // expected points lost, 0..1
  ep: number // mover's EP after the move
  best: Vertex | null // KataGo's preferred move when it differs from the played one
  pv: (Vertex | null)[] // KataGo's line from this position
  gap?: number // Great: EP gap to the best alternative
  acc: number // the move's accuracy (Lichess), on the reference scale
  w: number // Black's Win% after the move, on the reference scale
}

// chess.com's bands on ΔEP
export const BEST = 0.005, EXCELLENT = 0.02, GOOD = 0.05, INACCURACY = 0.1, MISTAKE = 0.2
export const MISS_GIFT = 0.15, MISS_LOSS = 0.1, MISS_SLACK = 0.02
export const GREAT_GAP = 0.1, GREAT_PRIOR = 0.8
export const BRILLIANT_SAC = 2, WEAK_LEVEL = -14 /* 15k */, BRILLIANT_BEFORE = 0.9, BRILLIANT_AFTER = 0.35, BRILLIANT_PRIOR = 0.3
export const SAC_OPEN_U = 0.35 // one given-up stone is enough while the board is still open (not an endgame throw-in)
export const DEEP_GAP = 0.06
export const MIN_VISITS = 30
export const OWN_BEFORE = -0.3, OWN_AFTER = -0.6
export const MIN_ACCURACY_MOVES = 5
/** σ anchors (points), fitted on KataGo's humanScoreStdev, then scaled per level for severity (.claude/research/coups/report.md §3). level: 1k = 0, 1d = 1, pro = 10. */
export const SIGMA_ANCHORS: { level: number; s0: number; min: number }[] = [
  { level: -19, s0: 23, min: 6 }, { level: -9, s0: 18, min: 5 }, { level: -4, s0: 16.5, min: 4 },
  { level: 1, s0: 14, min: 3 }, { level: 5, s0: 12.5, min: 2.5 }, { level: 10, s0: 11, min: 2 },
]
/** Accuracy is read on one scale for every player (1d) so it stays comparable across levels; categories stay at the mover's level. */
export const ACC_LEVEL = 1

const PRO = 10
const TITLE = /meijin|honin|kisei|j[uū]dan|tengen|[oō]za|gosei|kisung|myeongin|kuksu|mingren|qisheng|名人|本因坊|棋聖|棋圣|天元|十段|王座|碁聖|国手|國手/i

const KANJI = '一二三四五六七八九'

export function parseRank(s: string | undefined | null): number | null {
  if (!s) return null
  s = s.replace(/[一二三四五六七八九](?=\s*[段级級])/g, c => String(KANJI.indexOf(c) + 1)) // 九段; 十段 stays a title
  const m = /(\d+)\s*(k|kyu|d|dan|p|段|단|级|級|급)/i.exec(s)
  if (m) {
    const n = +m[1], u = m[2].toLowerCase()
    // Fox writes pros as P9段, China 职业九段
    return u === 'p' || /pro|职业|職業/i.test(s) || /p\s*$/i.test(s.slice(0, m.index)) ? PRO : /^(k|级|級|급)/.test(u) ? 1 - n : n
  }
  if (/初段/.test(s)) return 1
  return TITLE.test(s) || /\bpro\b/i.test(s) ? PRO : null
}

export function sigma(level: number, u: number): number {
  const a = SIGMA_ANCHORS, j = a.findIndex(x => x.level >= level)
  let s0: number, min: number
  if (j <= 0) ({ s0, min } = a[j < 0 ? a.length - 1 : 0]) // clamped outside the table
  else {
    const p = a[j - 1], q = a[j], t = (level - p.level) / (q.level - p.level)
    s0 = p.s0 + t * (q.s0 - p.s0); min = p.min + t * (q.min - p.min)
  }
  return Math.max(min, s0 * Math.sqrt(Math.max(0, u)))
}

export const ep = (leadForMover: number, sigma: number): number => 1 / (1 + Math.exp(-1.702 * leadForMover / sigma))

/** Own stones given up by move i (the played stone included): ownership before > −0.3, after ≤ −0.6, mover's view. */
export function sacrificed(before: SignMap, after: SignMap, ownBefore: number[], ownAfter: number[], mover: Sign): number {
  let n = 0
  after.forEach((row, y) => row.forEach((s, x) => {
    const k = y * row.length + x
    // the played stone had no ownership of its own before: only the 'after' test
    if (s === mover && mover * ownAfter[k] <= OWN_AFTER && (before[y][x] !== mover || mover * ownBefore[k] > OWN_BEFORE)) n++
  }))
  return n
}

const same = (a: Vertex | null, b: Vertex | null | undefined) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])

/** Moves that can be judged (mirrors losses() in review.ts): real moves until both players have passed. */
function judgeable(game: Game, end: number): boolean[] {
  const ok = game.moves.map(() => false)
  let passes = 0
  for (let i = 0; i < Math.min(end, game.moves.length); i++) {
    const m = game.moves[i]
    if (m.setup) continue
    // the pass that ends the game, and anything after two passes, is no one's choice
    if (passes >= 2 || (passes === 1 && !m.vertex)) { passes = 2; continue }
    ok[i] = true
    passes = m.vertex ? 0 : 1
  }
  return ok
}

// shortcut: Facts has no "played stone given up" flag, so a single sacrificed stone is assumed to be it (open board or weak mover);
// a Facts.sacPlayed flag from review.ts would keep out a tenuki that drops a weak stone elsewhere
const sacOk = (sac: number, u: number, lvl: number) => sac >= BRILLIANT_SAC || (sac >= 1 && (u >= SAC_OPEN_U || lvl <= WEAK_LEVEL))

/** EP for the side `s` from a Black lead at position `at`, the handicap baseline taken away. */
function epAt(game: Game, pos: (Pos | undefined)[], levels: Levels) {
  const first = pos.find(p => p), handi = game.info.setup.black.length + game.info.setup.white.length > 0
  return (s: Sign, at: number, lead: number) => {
    const u = pos[at]!.u
    // the handicap is expected to be eaten as the game settles: its share of the lead shrinks with u
    const base = handi && first ? first.lead * (first.u > 0 ? Math.min(1, u / first.u) : 0) : 0
    return ep(s * (lead - base), sigma(s === 1 ? levels.black : levels.white, u))
  }
}

export function classify(game: Game, pos: (Pos | undefined)[], facts: (Facts | undefined)[], levels: Levels, end: number): (Judged | null)[] {
  const ok = judgeable(game, end), E = epAt(game, pos, levels), out: (Judged | null)[] = game.moves.map(() => null)
  const R = epAt(game, pos, { black: ACC_LEVEL, white: ACC_LEVEL })
  let prev = -1 // the previous judged move
  game.moves.forEach((m, i) => {
    const p = pos[i]
    if (!ok[i] || !p) return
    const s = m.sign, top = p.cands[0], c = p.cands.find(x => same(x.v, m.vertex))
    const isTop = !!top && same(top.v, m.vertex)
    let best: number, played: number
    if (isTop) best = played = top.lead
    else if (c && c.visits >= MIN_VISITS) { best = top.lead; played = c.lead } // same search, less noise
    else if (pos[i + 1]) { best = p.lead; played = pos[i + 1]!.lead }
    else return
    const epBest = E(s, i, best), epAfter = E(s, i, played)
    const dEP = isTop ? 0 : Math.max(0, epBest - epAfter), loss = isTop ? 0 : Math.max(0, s * (best - played))
    const rAfter = R(s, i, played), rdEP = isTop ? 0 : Math.max(0, R(s, i, best) - rAfter)
    const acc = Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * 100 * rdEP) - 3.1669))
    const f = facts[i], j: Judged = { cat: 'blunder', loss, dEP, ep: epAfter, best: top && !isTop ? top.v : null, pv: p.pv, acc, w: 100 * (s === 1 ? rAfter : 1 - rAfter) }
    const lvl = s === 1 ? levels.black : levels.white
    const brilliant = p.deep && c && dEP <= EXCELLENT && sacOk(f?.sac ?? 0, p.u, lvl)
      && E(s, i, p.lead) <= BRILLIANT_BEFORE && epAfter >= BRILLIANT_AFTER && c.prior <= BRILLIANT_PRIOR
    const alts = p.cands.filter(x => x !== c) // every listed one: a starved alternative after a deep read is evidence too
    const gap = alts.length ? epAfter - Math.max(...alts.map(x => E(s, i, x.lead))) : 0
    const isBest = isTop || dEP < BEST
    const gift = prev >= 0 && game.moves[prev].sign !== s && out[prev]!.dEP >= MISS_GIFT
    if (f?.book && dEP <= GOOD) j.cat = 'book' // a corner joseki can still be a whole-board error
    else if (brilliant) j.cat = 'brilliant'
    else if (isBest && p.deep && c && alts.length && gap >= GREAT_GAP && c.prior <= GREAT_PRIOR) { j.cat = 'great'; j.gap = gap }
    else if (isBest) j.cat = 'best'
    else if (gift && dEP >= MISS_LOSS && epAfter >= E(s, prev, pos[prev]!.lead) - MISS_SLACK) j.cat = 'miss'
    else j.cat = dEP <= EXCELLENT ? 'excellent' : dEP <= GOOD ? 'good' : dEP <= INACCURACY ? 'inaccuracy' : dEP <= MISTAKE ? 'mistake' : 'blunder'
    out[i] = j
    prev = i
  })
  return out
}

/** Moves worth a deeper search before Great/Brilliant can be awarded (played = top move and a big gap or a sacrifice). */
export function deepCandidates(game: Game, pos: (Pos | undefined)[], facts: (Facts | undefined)[], levels: Levels, end: number, max = 10): number[] {
  const ok = judgeable(game, end), E = epAt(game, pos, levels), found: [number, number][] = []
  game.moves.forEach((m, i) => {
    const p = pos[i], [a, b] = p?.cands ?? []
    if (!ok[i] || !a) return
    const sac = facts[i]?.sac ?? 0, sacs = sacOk(sac, p!.u, m.sign === 1 ? levels.black : levels.white)
    const c = p!.cands.find(x => same(x.v, m.vertex))
    // a sacrifice the scan put within EXCELLENT of its top move gets a deep read too, first: scan noise often costs it the top spot
    if (c && c !== a && sacs && c.prior <= BRILLIANT_PRIOR && E(m.sign, i, a.lead) - E(m.sign, i, c.lead) <= EXCELLENT) { found.push([i, 3]); return }
    if (c !== a) return
    const gap = b ? E(m.sign, i, a.lead) - E(m.sign, i, b.lead) : 0
    // moves that can still become Great/Brilliant (the deep read keeps the scan's prior) next; gaps are in [−1, 1]
    const eligible = a.prior <= GREAT_PRIOR || (sacs && a.prior <= BRILLIANT_PRIOR)
    if (gap >= DEEP_GAP || sac >= 1) found.push([i, gap + (eligible ? 2 : 0)])
  })
  return found.sort((x, y) => y[1] - x[1]).slice(0, max).map(([i]) => i)
}

/** Lichess's game accuracy on the reference Win% (ACC_LEVEL): mean of the volatility-weighted and harmonic means; book moves excluded. */
export function accuracy(judged: (Judged | null)[], game: Game, sign: Sign): number | null {
  const all = judged.flatMap((j, i) => (j ? [{ j, s: game.moves[i].sign }] : []))
  const mine = all.flatMap((x, k) => (x.s === sign && x.j.cat !== 'book' ? [k] : []))
  if (mine.length < MIN_ACCURACY_MOVES) return null
  // Black's Win% after each judged move; the first windows repeat the first full one (Lichess pads the same way)
  const win = all.map(x => x.j.w), w = Math.min(win.length, Math.max(2, Math.min(8, Math.round(win.length / 10))))
  const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) }
  const weight = (k: number) => Math.min(12, Math.max(0.5, sd(win.slice(Math.max(0, k - w + 1), Math.max(0, k - w + 1) + w))))
  let sw = 0, swa = 0, inv = 0
  for (const k of mine) { const a = all[k].j.acc, wt = weight(k); sw += wt; swa += wt * a; inv += 1 / Math.max(1, a) }
  return (swa / sw + mine.length / inv) / 2
}

export function tally(judged: (Judged | null)[], game: Game, sign: Sign): Record<Cat, number> {
  const t = Object.fromEntries(CATS.map(c => [c, 0])) as Record<Cat, number>
  judged.forEach((j, i) => { if (j && game.moves[i].sign === sign) t[j.cat]++ })
  return t
}
