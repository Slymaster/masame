// Game review: find the moves that cost the most points, then teach each one as try → punishment → better move.
// Pure helpers plus readGame, which drives the engine through an injected `ask` (tested with a fake one).

import { deepCandidates, parseRank, sacrificed, type Facts, type Levels, type Pos } from './classify'
import type { Game, Move, Sign, Vertex } from './game'
import type { Analysis } from './katago'

export type Step = 'try' | 'punish' | 'better'
export interface Moment {
  at: number // index of the mistake in game.moves
  sign: Sign // who made it
  loss: number // points, from the deep check
  lead: number // Black's lead after the mistake, with the best punishment
  punish: (Vertex | null)[]; better: (Vertex | null)[]
  lost: number[] | null; kept: number[] | null // ownership shown in ② and ③
}

export const MIN_LOSS = 2, MAX_MOMENTS = 3, FOUND = 1
/** Ownership change that counts as "changed hands"; 0 shows the full maps. */
export const SHIFT_MIN = 0.5
const DEEP_TIME = 3
// maxTime bounds each search on any hardware: two workers over the whole game take about a minute
export const scanQuery = (positions: number) => ({ maxVisits: 100, includeOwnership: true, analysisPVLen: 7, overrideSettings: { maxTime: Math.max(0.25, 120 / positions) } })
export const DEEP = { maxVisits: 400, includeOwnership: true, analysisPVLen: 7, overrideSettings: { maxTime: DEEP_TIME } }
/** The deeper search that confirms a Great or Brilliant candidate (positions before and after the move). */
export const GREAT_DEEP = { maxVisits: 400, includeOwnership: true, analysisPVLen: 7, overrideSettings: { maxTime: 1.5 } }
export const MAX_DEEP = 10
export const REPLY = { maxVisits: 200, overrideSettings: { maxTime: 1.5 } }

/**
 * Positions the engine can read: up to the first SGF move fromRecord lets through but KataGo refuses or replays
 * differently: onto an occupied point, a single-stone suicide, or the same colour twice in a row; or setup stones.
 * Empty and comment-only nodes (pseudo-moves) are skipped.
 */
export function reviewEnd(g: Game): number {
  let prev: Move | undefined
  const i = g.moves.findIndex((m, i) => {
    if (g.nodes[i + 1].stones) return true
    if (m.setup) return false
    const bad = prev?.sign === m.sign || !!m.vertex && (g.boards[i].get(m.vertex) !== 0 || g.boards[i + 1].get(m.vertex) === 0)
    prev = m
    return bad
  })
  return i < 0 ? g.moves.length : i
}

const lossOf = (leads: (number | undefined)[], moves: Move[], i: number) => moves[i].sign * (leads[i]! - leads[i + 1]!)

/**
 * [index, points lost] for every real move by `side` (0 = both) whose two leads are known, until both players have passed:
 * not the game-ending pass nor anything after it (a game resumed after a dispute): the same rule as classify's.
 */
export function losses(leads: (number | undefined)[], moves: Move[], side: Sign | 0): [number, number][] {
  const real = moves.map((m, i) => (m.setup ? -1 : i)).filter(i => i >= 0) // pseudo-moves are no one's mistake
  // the game-ending pass (the second in a row): nothing from it on counts, a game resumed after a dispute included
  const over = real.findIndex((i, k) => k > 0 && !moves[i].vertex && !moves[real[k - 1]].vertex)
  return real.filter((i, k) => (over < 0 || k < over)
    && leads[i] !== undefined && leads[i + 1] !== undefined && (side === 0 || moves[i].sign === side))
    .map(i => [i, lossOf(leads, moves, i)])
}

/** Candidate mistakes (indices into moves), worst first, at least half a board width apart. */
export function pickMoments(leads: (number | undefined)[], moves: Move[], side: Sign | 0, size: number, max = 5): number[] {
  const gap = Math.ceil(size / 2), picked: number[] = []
  for (const [i] of losses(leads, moves, side).filter(([, x]) => x >= MIN_LOSS).sort((a, b) => b[1] - a[1])) {
    if (picked.length >= max) break
    if (picked.every(j => Math.abs(i - j) >= gap)) picked.push(i)
  }
  return picked
}

/** Opening, middle game, endgame: moves 1–50, 51–150 and later on 19×19, scaled by board area (like resignFrom). */
export const phaseOf = (mv: number, size: number): 0 | 1 | 2 =>
  mv <= Math.round(50 * size * size / 361) ? 0 : mv <= Math.round(150 * size * size / 361) ? 1 : 2

/** Points lost by `side` in each phase; move numbers count real moves only. */
export function phaseLosses(leads: (number | undefined)[], moves: Move[], side: Sign, size: number): number[] {
  let n = 0
  const mv = moves.map(m => (m.setup ? n : ++n)), sums = [0, 0, 0]
  // signed on purpose: the scan's noise (a move "gaining" points) cancels out over a game
  for (const [i, x] of losses(leads, moves, side)) sums[phaseOf(mv[i], size)] += x
  return sums
}

/** "What changed hands": both maps keep only the points whose ownership moved by SHIFT_MIN or more. */
export function shift(before: number[] | null, after: number[] | null): { lost: number[] | null; kept: number[] | null } {
  if (!before || !after) return { lost: null, kept: null }
  const moved = (i: number) => Math.abs(after[i] - before[i]) >= SHIFT_MIN
  return { lost: after.map((x, i) => (moved(i) ? x : 0)), kept: before.map((x, i) => (moved(i) ? x : 0)) }
}

/** The step's board starts here: after the mistake (try, punishment) or just before it (better move). */
export const fromOf = (m: Moment, step: Step) => (step === 'better' ? m.at : m.at + 1)

/** A fresh variation for a step: the try waits at `from`, the lines show their first move. */
export function lessonBoard(game: Game, m: Moment, step: Step): Game {
  const from = fromOf(m, step)
  const g = game.branch(from, step === 'punish' ? m.punish : step === 'better' ? m.better : [])
  g.goTo(step === 'try' ? from : from + 1)
  return g
}

const same = (a: Vertex | null, b: Vertex | null | undefined) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])

/** Points between a try (Black's lead after it) and the best punishment. */
export function gradeTry(m: Moment, tried: Vertex | null, lead: number): number {
  return same(tried, m.punish[0]) ? 0 : Math.max(0, m.sign * (lead - m.lead))
}

export const verdict = (m: Moment, gap: number): 'found' | 'missed' | 'short' => (gap < FOUND ? 'found' : m.loss - gap < 1 ? 'missed' : 'short')

/** Promise.all that settles only once every promise has: a rejection leaves nothing of this run in flight. */
async function settled<T>(ps: Promise<T>[]): Promise<T[]> {
  const r = await Promise.allSettled(ps)
  for (const x of r) if (x.status === 'rejected') throw x.reason
  return r.map(x => (x as PromiseFulfilledResult<T>).value)
}

// ownership maps stay in memory only (361 numbers a position: too big for the sidecar), tied to their Pos
const owns = new WeakMap<Pos, number[]>()
export const ownershipOf = (p: Pos | undefined) => (p ? owns.get(p) : undefined)
/** A scan result as the classifier needs it: root lead, board uncertainty, KataGo's first 6 candidates, its line. */
export function toPos(a: Analysis, deep = false): Pos {
  // no ownership (never with includeOwnership): the position counts as wide open, the softest judgment
  const p: Pos = { lead: a.scoreLead, u: a.ownership ? a.ownership.reduce((s, x) => s + 1 - Math.abs(x), 0) / a.ownership.length : 1,
    cands: a.moves.slice(0, 6).map(m => ({ v: m.v, lead: m.scoreLead, visits: m.visits, prior: m.prior ?? 0 })), pv: a.pv.slice(0, 7), ...deep && { deep: true as const } }
  if (a.ownership) owns.set(p, a.ownership)
  return p
}
export const leadsOf = (pos: (Pos | undefined)[]) => pos.map(p => p?.lead)

/** Levels for the classifier: the SGF ranks (BR/WR), else `fallback` (the player's own rank), else 5k. */
export function levelsOf(game: Game, fallback?: string): Levels {
  const d = game.root.data, def = parseRank(fallback) ?? -4
  return { black: parseRank(d.BR?.[0]) ?? def, white: parseRank(d.WR?.[0]) ?? def }
}

/** Own stones given up by move i, from the ownerships of the positions around it (0 when either is unknown). */
function sacOf(game: Game, pos: (Pos | undefined)[], i: number): number {
  const m = game.moves[i], a = ownershipOf(pos[i]), b = ownershipOf(pos[i + 1])
  return m.setup || !m.vertex || !a || !b ? 0 : sacrificed(game.boards[i].signMap, game.boards[i + 1].signMap, a, b, m.sign)
}

/** The deep check of one move (a moment, or Retry on any move): null when it costs under `min` points or the engine has no line. */
export async function momentAt(game: Game, at: number, ask: (at: number, query: object) => Promise<Analysis>, min = MIN_LOSS): Promise<Moment | null> {
  const [before, after] = await settled([ask(at, DEEP), ask(at + 1, DEEP)])
  const sign = game.moves[at].sign, loss = sign * (before.scoreLead - after.scoreLead)
  // a 'better move' equal to the mistake would contradict itself (search noise between the two checks)
  return loss >= min && before.pv[0] && after.pv[0] && !same(before.pv[0], game.moves[at].vertex)
    ? { at, sign, loss, lead: after.scoreLead, punish: after.pv, better: before.pv, ...shift(before.ownership, after.ownership) } : null
}

/**
 * Scans every position (2 queries in flight, results cached in `pos`), then confirms the worst candidates with
 * deeper searches until MAX_MOMENTS are kept. Moments come back in game order. Settles only once none of its
 * queries is in flight, so a caller can start the next run after it without exceeding 2.
 */
export async function readGame(game: Game, side: Sign | 0, pos: (Pos | undefined)[],
  ask: (at: number, query: object) => Promise<Analysis>, live: () => boolean, progress: (pct: number) => void,
  extra: { levels: Levels; book?: boolean[]; facts?: Facts[] }): Promise<{ moments: Moment[]; facts: Facts[] }> {
  const end = reviewEnd(game), n = end + 1
  const scan = scanQuery(n), step = scan.overrideSettings.maxTime / 2, deepStep = GREAT_DEEP.overrideSettings.maxTime
  // the position after a pseudo-move is the one before it: not asked, copied after the scan. A position without its
  // ownership in memory (restored from the sidecar) is read again, or its sacrifices would come back 0; unless the saved
  // facts come along (extra.facts): then the positions are trusted as they are and only the moments are read
  const saved = extra.facts
  const todo = Array.from({ length: n }, (_, i) => i).filter(i => (saved ? !pos[i] : !ownershipOf(pos[i])) && !game.moves[i - 1]?.setup)
  // progress in seconds of budget: each scan query is worth half its maxTime (two run at once), each deep pair its maxTime
  const total = n * step + MAX_DEEP * deepStep + MAX_MOMENTS * DEEP_TIME
  let done = (n - todo.length) * step
  const tick = (s: number) => { done += s; progress(Math.min(99, Math.floor(done / total * 100))) }
  progress(Math.min(99, Math.floor(done / total * 100)))
  const worker = async () => {
    let i: number | undefined
    while (live() && (i = todo.shift()) !== undefined) {
      try { pos[i] = toPos(await ask(i, scan)) } catch (e) { todo.length = 0; throw e }
      tick(step)
    }
  }
  await settled([worker(), worker()])
  const copy = () => { for (let i = 1; i < n; i++) if (game.moves[i - 1].setup) pos[i] = pos[i - 1] }
  const real = (k: number) => { while (k > 0 && game.moves[k - 1].setup) k--; return k } // the position a copy comes from
  copy()
  const facts: Facts[] = saved ?? game.moves.slice(0, end).map((_, i) => ({ sac: sacOf(game, pos, i), book: !!extra.book?.[i] }))
  if (!live()) return { moments: [], facts }
  // Great and Brilliant need a surer reading: both positions around each candidate again, deeper (kept across runs)
  for (const i of saved ? [] : deepCandidates(game, pos, facts, extra.levels, end, MAX_DEEP).slice(0, MAX_DEEP)) {
    if (!live()) break
    const again = [...new Set([i, i + 1].map(real))].filter(k => !pos[k]?.deep)
    const got = await settled(again.map(k => ask(k, GREAT_DEEP)))
    again.forEach((k, j) => { pos[k] = toPos(got[j], true) })
    copy()
    facts[i].sac = sacOf(game, pos, i)
    tick(deepStep)
  }
  const moments: Moment[] = []
  for (const at of pickMoments(leadsOf(pos), game.moves.slice(0, end), side, game.info.size)) {
    if (!live() || moments.length >= MAX_MOMENTS) break
    const m = await momentAt(game, at, ask)
    tick(DEEP_TIME)
    if (m) moments.push(m)
  }
  return { moments: moments.sort((a, b) => a.at - b.at), facts }
}
