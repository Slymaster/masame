// "Le rituel du jour": a hand of exercises (leaning toward your weakest phase), the due joseki and a 9×9 at your level, chained once a day. The steps come from
// the decks (never stored); only the streak and the ritual game's day are kept, in localStorage like the decks.
import type { Card } from '../joseki/fsrs'
import type { Book } from '../joseki/db'
import { today } from '../joseki/store'

// cards that make a day's step: the joseki (or fuseki) step's CAP, the exercises step's HAND
export const KEY = 'masame.today', CAP = 5, HAND = 6
/** streak: days in a row ending on `last` (the last day done, '' never); game: the day a ritual game last reached a result. */
export interface Ritual { v: 1; streak: number; last: string; game: string }
/** A step today: done, and how many are left (null while unknown); null when unavailable (counted as done). */
export type Step = { done: boolean; left: number | null } | null
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0)
/** A deck's step: `cap` cards reviewed today, or nothing left today. */
export function deckStep(cards: Record<string, Card>, left: number, now: number, cap = CAP): Step {
  const seen = Object.values(cards).filter(c => c.last >= midnight(now)).length
  return { done: seen >= cap || left === 0, left: seen >= cap ? 0 : Math.min(left, cap - seen) }
}
/** The second step's book: the fuseki when the opening is your weakest phase (deck.ts weakest()), else the joseki. */
export const openingBook = (weak: 0 | 1 | 2 | null): Book => weak === 0 ? 'fuseki' : 'joseki'
export const gameStep = (r: Ritual, now: number): Step => ({ done: r.game === today(now), left: r.game === today(now) ? 0 : 1 })
/** Every available step done, with at least one available. */
export const allDone = (steps: Step[]) => steps.some(s => s) && steps.every(s => !s || s.done)

/** The day before, by the calendar (a DST day is 23 or 25 hours). */
export const yesterday = (now: number) => { const d = new Date(now); d.setDate(d.getDate() - 1); return today(d.getTime()) }
/** Today done: the streak goes on from yesterday, or starts again; once a day. */
export const complete = (r: Ritual, now: number): Ritual =>
  r.last === today(now) ? r : { ...r, streak: (r.last === yesterday(now) ? r.streak : 0) + 1, last: today(now) }
/** The streak shown: still alive until today ends without the ritual. */
export const streakOf = (r: Ritual, now: number) => (r.last === today(now) || r.last === yesterday(now) ? r.streak : 0)

export const fresh = (): Ritual => ({ v: 1, streak: 0, last: '', game: '' })
export function load(st: Storage = localStorage): Ritual {
  try {
    const j = JSON.parse(st.getItem(KEY) ?? 'null')
    if (j?.v === 1 && Number.isInteger(j.streak) && j.streak >= 0 && typeof j.last === 'string' && typeof j.game === 'string') return { v: 1, streak: j.streak, last: j.last, game: j.game }
  } catch { /* storage disabled or garbage: a fresh start */ }
  return fresh()
}
export function save(r: Ritual, st: Storage = localStorage) {
  try { st.setItem(KEY, JSON.stringify(r)) } catch { /* private mode: this session only */ }
}
