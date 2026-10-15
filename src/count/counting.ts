// "Compter": positions drawn from your reviewed games, where you say who leads and by how much; KataGo's lead (read by
// the review) is the truth. Pure, plus the errors kept in localStorage (masame.counting) like the decks.
import type { Entry } from '../library'
import { readV1, writeV1 } from '../store'

export const KEY = 'masame.counting', CAP = 200, LAST = 20, SESSION = 5
/** Your counts' absolute errors in points, newest last. */
export interface Counting { v: 1; errs: { t: number; err: number }[] }
export type Verdict = 'right' | 'close' | 'far'
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** A game whose positions can be counted: reviewed (its leads are in the 'review' sidecar), never an unfinished OGS game. */
export const countable = (e: Entry) => !!e.review && !(e.source === 'ogs' && !e.result)

/** Among the countable games, one of those counted the least; null when there is none. */
export function pickGame(xs: Entry[], rand: () => number): Entry | null {
  const ok = xs.filter(countable)
  if (!ok.length) return null
  const least = Math.min(...ok.map(e => e.counted ?? 0)), pool = ok.filter(e => (e.counted ?? 0) === least)
  return pool[Math.floor(rand() * pool.length)]
}

/** A position (moves played) between 35 % and 70 % of a game of `moves` moves whose lead is known; null when none is. */
export function pickMove(leads: (number | null | undefined)[], moves: number, rand: () => number): number | null {
  const from = Math.ceil(moves * 0.35), to = Math.floor(moves * 0.7)
  const ok: number[] = []
  for (let i = from; i <= to; i++) if (Number.isFinite(leads[i])) ok.push(i)
  return ok.length ? ok[Math.floor(rand() * ok.length)] : null
}

/** KataGo's lead as the player is told it: to the half point (Japanese counts end in .5 or whole points). */
export const truthOf = (lead: number) => Math.round(lead * 2) / 2
/** The answer as Black's lead: Black +n, White +n (−n), or even (0). */
export const guessOf = (who: 1 | -1 | 0, by: number) => who * by
export const verdictOf = (err: number): Verdict => (err <= 3 ? 'right' : err <= 8 ? 'close' : 'far')

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/** The median error over your last LAST counts, and over how many. */
export const recent = (c: Counting) => { const xs = c.errs.slice(-LAST).map(e => e.err); return { median: median(xs), n: xs.length } }

export const added = (c: Counting, err: number, now: number): Counting => ({ v: 1, errs: [...c.errs, { t: now, err }].slice(-CAP) })
/** Positions counted since midnight (the ritual's counting cards). */
export const countedToday = (c: Counting, now: number) => { const m = new Date(now).setHours(0, 0, 0, 0); return c.errs.filter(e => e.t >= m).length }

export function load(st: Storage = localStorage): Counting {
  const j = readV1<Counting>(KEY, j => Array.isArray(j.errs), st)
  return { v: 1, errs: (j?.errs ?? []).filter((e: unknown) => !!e && Number.isFinite((e as { t: number }).t) && Number.isFinite((e as { err: number }).err)).slice(-CAP) }
}
export const save = (c: Counting, st: Storage = localStorage) => writeV1(KEY, c, st)
