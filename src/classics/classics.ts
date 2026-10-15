// Les Classiques: guess the masters' moves. The shipped Edo games (public/assets/classics, see SOURCES.md) and the pure
// parts of the guessing: which moves the player guesses, what a guess costs, the best score kept per game.
import type { Game, Sign, Vertex } from '../game'
import { loadSgf } from '../sgf'
import { readV1, writeV1 } from '../store'

/** A shipped game, as index.json lists it. */
export interface Classic {
  id: string; file: string; date: string // "1846-09-11", or "1815" when only the year is known
  black: string; white: string; result: string; moves: number
  title: { fr: string; en: string }; context: { fr: string; en: string }
}
const base = `${import.meta.env.BASE_URL}assets/classics/`
let index: Promise<Classic[]> | null = null
export const loadIndex = () => index ??= fetch(`${base}index.json`).then(r => r.ok ? r.json() as Promise<Classic[]> : Promise.reject(new Error(`HTTP ${r.status}`)))
  .catch(e => { index = null; throw e }) // tried again next time
export const loadClassic = (c: Classic) => fetch(`${base}${c.file}`).then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))).then(loadSgf)

/** The start choices: move 1, or move 21 to skip the opening. */
export const STARTS = [1, 21] as const

/** Indices into game.moves the player guesses: `side`'s real moves from move number `from` on (passes and setup aside). */
export function turnsOf(g: Game, side: Sign, from: number): number[] {
  let n = 0
  return g.moves.flatMap((m, i) => m.setup ? [] : ++n >= from && m.sign === side && m.vertex ? [i] : [])
}
/** The position a run starts from: just before real move number `from`. */
export function startOf(g: Game, from: number): number {
  let n = 0
  const i = g.moves.findIndex(m => !m.setup && ++n >= from)
  return i < 0 ? g.moves.length : i
}

/** Points a guess costs against the master's move, from Black's lead after each (0 when it does as well or better). */
export const costOf = (sign: Sign, master: number, tried: number) => Math.max(0, sign * (master - tried))

export const same = (a: Vertex | null, b: Vertex | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])

/** A run's score: moves found, moves guessed, and the summed cost of the other (graded) moves. */
export interface Score { found: number; total: number; cost: number; others: number }
export const NONE: Score = { found: 0, total: 0, cost: 0, others: 0 }
/** One more guess: found (the master's move), or another move with its cost (null while not graded yet). */
export const scored = (s: Score, found: boolean, cost: number | null): Score =>
  found ? { ...s, found: s.found + 1, total: s.total + 1 }
  : { ...s, total: s.total + 1, ...cost !== null && { cost: s.cost + cost, others: s.others + 1 } }
/** What the other moves cost on average (points; 0 without any). */
export const average = (s: Score) => (s.others ? s.cost / s.others : 0)
/** The better of two runs: more moves found, then the cheaper other moves. */
export const better = (a: Score, b: Score | undefined) => !b || a.found > b.found || (a.found === b.found && average(a) < average(b))

/** The move a player of the policy's profile would most likely play: its likeliest legal point (null: no policy). */
export function humanTop(policy: number[] | null, size: number): Vertex | null {
  if (!policy) return null
  let best = -1
  for (let i = 0; i < size * size; i++) if (policy[i] >= 0 && (best < 0 || policy[i] > policy[best])) best = i
  return best < 0 ? null : [best % size, Math.floor(best / size)]
}

// ---------- the best scores (localStorage) ----------
/** masame.classics: the best run per game, keyed by the classic's id or the library id of a guessed game. */
export interface Best extends Score { t: number }
export interface Store { v: 1; best: Record<string, Best> }
export const KEY = 'masame.classics'
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0
const isBest = (b: unknown): b is Best => !!b && typeof b === 'object' && ['found', 'total', 'cost', 'others', 't'].every(k => n((b as Record<string, unknown>)[k]))

export function load(st: Storage = localStorage): Store {
  const best = readV1<Store>(KEY, j => !!j.best && typeof j.best === 'object', st)?.best ?? {}
  return { v: 1, best: Object.fromEntries(Object.entries(best).filter(([, b]) => isBest(b))) as Record<string, Best> }
}
/** Keeps a finished (or stopped) run when it beats the stored one; returns the store as it now is. */
export function keepBest(id: string, s: Score, now = Date.now(), st: Storage = localStorage): Store {
  const store = load(st)
  if (!s.total || !better(s, store.best[id])) return store
  const next: Store = { v: 1, best: { ...store.best, [id]: { ...s, t: now } } }
  writeV1(KEY, next, st)
  return next
}
