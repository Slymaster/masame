// Your rank, read in your moves: KataGo's human network gives, per rank profile, the probability of each move you played;
// the profile under which your moves are likeliest is the rank you played like. Pure, plus readRank (driven through `ask`,
// like review.ts readGame) and the readings kept in localStorage.
import { RANKS } from './bot'
import type { Game, Sign } from './game'
import type { Analysis } from './katago'
import { phaseOf, reviewEnd } from './review'

/** The profiles asked (indices into RANKS: 20k = 0 … 9d = 28). */
export const PROFILES = ['20k', '15k', '10k', '5k', '1d', '5d']
/** A move's probability is floored before the log: one unthinkable move can't decide. */
export const FLOOR = 1e-4
/** Fewer of the player's moves in a phase: no rank for that phase; in a game: no reading (calibrated on 113 OGS players: the
 * reading's spread vs the whole game is 3.5 ranks at 25 moves, 2.5 at 60; the opening gives 25, the endgame is the noisiest). */
export const MIN_PHASE = 25, MIN_GAME = 30
/** Readings in the local rank. */
export const WINDOW = 10
/** The AI level stays within BAND ranks of the local rank. */
export const BAND = 2
export const KEY = 'masame.rank', BAD = 'masame.rank.bad', CAP = 200
const XS = PROFILES.map(p => RANKS.indexOf(p))

export interface Reading { all: number; phases: (number | null)[]; n: number }
/** A stored reading: k = the record's key (exercises/deck.ts recordKey), t = when (ms). */
export interface Read extends Reading { k: string; t: number }
export interface Ranks { v: 1; games: Read[] }
export interface StoredRanks { p: Ranks; readOnly: boolean }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Where the log-likelihood `ls` (at ranks `xs`) peaks: the best profile, refined by the parabola through it and its neighbours. */
export function peak(xs: number[], ls: number[]): number {
  const b = ls.indexOf(Math.max(...ls))
  if (b === 0 || b === xs.length - 1) return xs[b]
  const [x0, x1, x2] = xs.slice(b - 1, b + 2), [l0, l1, l2] = ls.slice(b - 1, b + 2)
  const num = (x1 - x0) ** 2 * (l1 - l2) - (x1 - x2) ** 2 * (l1 - l0), den = (x1 - x0) * (l1 - l2) - (x1 - x2) * (l1 - l0)
  return den ? Math.min(x2, Math.max(x0, x1 - num / den / 2)) : x1
}

const sums = (probs: number[][]) => XS.map((_, j) => probs.reduce((s, p) => s + Math.log(Math.max(FLOOR, p[j])), 0))

/** The rank (index, fractional) of these moves, overall and per phase (null under MIN_PHASE moves); null under MIN_GAME moves. */
export function reading(probs: number[][], phases: (0 | 1 | 2)[]): Reading | null {
  if (probs.length < MIN_GAME) return null
  return {
    all: peak(XS, sums(probs)), n: probs.length,
    phases: [0, 1, 2].map(ph => { const ps = probs.filter((_, i) => phases[i] === ph); return ps.length < MIN_PHASE ? null : peak(XS, sums(ps)) }),
  }
}

/** The query asking the human network's policy under one profile (no search). */
export const rankQuery = (p: string) => ({ maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: `rank_${p}`, ignorePreRootHistory: false } })

/**
 * Asks the position before each real move by `side` with each profile (2 queries in flight, probabilities cached in
 * `cache` by `${move index}|${profile}`, NaN when the reply had no human policy: that move is skipped). Settles only once
 * none of its queries is in flight; null when interrupted (live() false) or without moves.
 */
export async function readRank(game: Game, side: Sign, cache: Map<string, number>, ask: (g: Game, q: object) => Promise<Analysis>,
  live: () => boolean): Promise<Reading | null> {
  const n = game.info.size, end = reviewEnd(game)
  let mv = 0
  const moves = game.moves.slice(0, end).flatMap((m, i) => (m.setup ? [] : (mv++, m.vertex && m.sign === side ? [{ i, v: m.vertex, mv }] : [])))
  const todo = moves.flatMap(m => PROFILES.map(p => ({ ...m, p }))).filter(q => !cache.has(`${q.i}|${q.p}`))
  const worker = async () => {
    let q: (typeof todo)[number] | undefined
    while (live() && (q = todo.shift())) {
      let a: Analysis
      try { a = await ask(game.branch(q.i), rankQuery(q.p)) } catch (e) { todo.length = 0; throw e }
      cache.set(`${q.i}|${q.p}`, a.humanPolicy?.[q.v[1] * n + q.v[0]] ?? NaN)
    }
  }
  const r = await Promise.allSettled([worker(), worker()])
  for (const x of r) if (x.status === 'rejected') throw x.reason
  if (!live()) return null
  const read = moves.map(m => ({ m, ps: PROFILES.map(p => cache.get(`${m.i}|${p}`)!) })).filter(x => x.ps.every(p => !Number.isNaN(p)))
  return reading(read.map(x => x.ps), read.map(x => phaseOf(x.m.mv, n)))
}

const last = (games: Read[], upto = games.length) => games.slice(Math.max(0, upto - WINDOW), upto)
const mean = (xs: [number, number][]) => { const w = xs.reduce((s, [, n]) => s + n, 0); return w ? xs.reduce((s, [x, n]) => s + x * n, 0) / w : null }
/** The move-weighted mean of the last WINDOW readings up to `upto`. */
export const localRank = (games: Read[], upto = games.length) => mean(last(games, upto).map(g => [g.all, g.n]))
/** The same per phase, readings without that phase left out. */
export const phaseRanks = (games: Read[]) => [0, 1, 2].map(p => mean(last(games).flatMap(g => (g.phases[p] === null ? [] : [[g.phases[p]!, g.n]]))))
/** RankChart points of the local rank after each reading, on OGS's scale (ranking = index + 10; + .5 so rankLabel rounds). */
export const curve = (games: Read[]) => games.map((g, i) => ({ t: g.t, rank: localRank(games, i + 1)! + 10.5 }))
/** The rank of an index, rounded. */
export const rankName = (x: number) => RANKS[Math.max(0, Math.min(RANKS.length - 1, Math.round(x)))]
/** The AI level (an index) within BAND ranks of the local rank. */
export const anchored = (ai: number, local: number) => {
  const r = Math.round(local)
  return Math.max(0, Math.min(RANKS.length - 1, r + BAND, Math.max(r - BAND, ai)))
}

/** The readings with this one added (newest last, one per record, the oldest dropped past CAP). */
export const withReading = (p: Ranks, k: string, r: Reading, now: number): Ranks =>
  ({ v: 1, games: [...p.games.filter(g => g.k !== k), { k, t: now, ...r }].slice(-CAP) })

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isRead = (g: unknown): g is Read => !!g && typeof g === 'object' && typeof (g as Read).k === 'string' && num((g as Read).t)
  && num((g as Read).all) && num((g as Read).n) && (g as Read).n > 0 && Array.isArray((g as Read).phases) && (g as Read).phases.length === 3
  && (g as Read).phases.every(x => x === null || num(x))
const empty = (): Ranks => ({ v: 1, games: [] })

/** The stored readings: a bad entry costs that entry only (the raw text kept aside); a newer version is read-only. */
export function loadRanks(st: Storage = localStorage): StoredRanks {
  let raw: string | null = null
  try { raw = st.getItem(KEY) } catch { return { p: empty(), readOnly: false } } // storage disabled
  if (raw === null) return { p: empty(), readOnly: false }
  try {
    const j = JSON.parse(raw)
    if (num(j?.v) && j.v > 1) return { p: empty(), readOnly: true }
    if (j?.v === 1 && Array.isArray(j.games)) {
      const games = j.games.filter(isRead).slice(-CAP).map(({ k, t, all, phases, n }: Read) => ({ k, t, all, phases, n }))
      if (games.length < j.games.length) try { st.setItem(BAD, raw) } catch { /* full */ }
      return { p: { v: 1, games }, readOnly: false }
    }
  } catch { /* garbage: below */ }
  try { st.setItem(BAD, raw) } catch { /* full */ }
  return { p: empty(), readOnly: false }
}

export function saveRanks(s: StoredRanks, st: Storage = localStorage) {
  if (s.readOnly) return
  try { st.setItem(KEY, JSON.stringify(s.p)) } catch { /* private mode: this session only */ }
}
