// Game review: find the moves that cost the most points, then teach each one as try → punishment → better move.
// Pure helpers plus readGame, which drives the engine through an injected `ask` (tested with a fake one).

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
export const scanQuery = (positions: number) => ({ maxVisits: 100, overrideSettings: { maxTime: Math.max(0.25, 120 / positions) } })
export const DEEP = { maxVisits: 400, includeOwnership: true, analysisPVLen: 7, overrideSettings: { maxTime: DEEP_TIME } }
export const REPLY = { maxVisits: 200, overrideSettings: { maxTime: 1.5 } }

/**
 * Positions the engine can read: up to the first SGF move fromRecord lets through but KataGo refuses or replays
 * differently: onto an occupied point, a single-stone suicide, or the same colour twice in a row; or a setup or empty node.
 */
export function reviewEnd(g: Game): number {
  const i = g.moves.findIndex((m, i) => m.setup || g.nodes[i + 1].stones || (i > 0 && m.sign === g.moves[i - 1].sign)
    || !!m.vertex && (g.boards[i].get(m.vertex) !== 0 || g.boards[i + 1].get(m.vertex) === 0))
  return i < 0 ? g.moves.length : i
}

const lossOf = (leads: (number | undefined)[], moves: Move[], i: number) => moves[i].sign * (leads[i]! - leads[i + 1]!)

/** Candidate mistakes (indices into moves), worst first, at least half a board width apart. */
export function pickMoments(leads: (number | undefined)[], moves: Move[], side: Sign | 0, size: number, max = 5): number[] {
  const gap = Math.ceil(size / 2), picked: number[] = []
  const ok = moves.map((_, i) => i).filter(i =>
    leads[i] !== undefined && leads[i + 1] !== undefined && (side === 0 || moves[i].sign === side)
    && !(!moves[i].vertex && i > 0 && !moves[i - 1].vertex) // the game-ending pass
    && lossOf(leads, moves, i) >= MIN_LOSS)
  for (const i of ok.sort((a, b) => lossOf(leads, moves, b) - lossOf(leads, moves, a))) {
    if (picked.length >= max) break
    if (picked.every(j => Math.abs(i - j) >= gap)) picked.push(i)
  }
  return picked
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

/**
 * Scans every position (2 queries in flight, results cached in `leads`), then confirms the worst candidates with
 * deeper searches until MAX_MOMENTS are kept. Moments come back in game order. Settles only once none of its
 * queries is in flight, so a caller can start the next run after it without exceeding 2.
 */
export async function readGame(game: Game, side: Sign | 0, leads: (number | undefined)[],
  ask: (at: number, query: object) => Promise<Analysis>, live: () => boolean, progress: (pct: number) => void): Promise<Moment[]> {
  const end = reviewEnd(game), n = end + 1
  const scan = scanQuery(n), step = scan.overrideSettings.maxTime / 2
  const todo = Array.from({ length: n }, (_, i) => i).filter(i => leads[i] === undefined)
  // progress in seconds of budget: each scan query is worth half its maxTime (two run at once), each deep pair DEEP_TIME
  const total = n * step + MAX_MOMENTS * DEEP_TIME
  let done = (n - todo.length) * step
  const tick = (s: number) => { done += s; progress(Math.min(99, Math.floor(done / total * 100))) }
  progress(Math.min(99, Math.floor(done / total * 100)))
  const worker = async () => {
    let i: number | undefined
    while (live() && (i = todo.shift()) !== undefined) {
      try { leads[i] = (await ask(i, scan)).scoreLead } catch (e) { todo.length = 0; throw e }
      tick(step)
    }
  }
  await settled([worker(), worker()])
  const moments: Moment[] = []
  for (const at of pickMoments(leads, game.moves.slice(0, end), side, game.info.size)) {
    if (!live() || moments.length >= MAX_MOMENTS) break
    const [before, after] = await settled([ask(at, DEEP), ask(at + 1, DEEP)])
    tick(DEEP_TIME)
    const sign = game.moves[at].sign, loss = sign * (before.scoreLead - after.scoreLead)
    // a 'better move' equal to the mistake would contradict itself (search noise between the two checks)
    if (loss >= MIN_LOSS && before.pv[0] && after.pv[0] && !same(before.pv[0], game.moves[at].vertex))
      moments.push({ at, sign, loss, lead: after.scoreLead, punish: after.pv, better: before.pv, ...shift(before.ownership, after.ownership) })
  }
  return moments.sort((a, b) => a.at - b.at)
}
