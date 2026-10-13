// Joseki progress, kept in localStorage and keyed by position (positionKey), so it survives data rebuilds.
import type { Card } from './fsrs'

export const KEY = 'masame.joseki', BAD = 'masame.joseki.bad', NEW_PER_DAY = 10
/** day: the local date `fresh` (new cards introduced) counts for. */
export interface Progress { v: 1; cards: Record<string, Card>; day: string; fresh: number }
/** readOnly: written by a newer app; shown empty and never overwritten. */
export interface Stored { p: Progress; readOnly: boolean }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export const today = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` }
const empty = (): Progress => ({ v: 1, cards: {}, day: today(), fresh: 0 })
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
const isCard = (c: unknown) => !!c && typeof c === 'object' && (['s', 'd', 'due', 'last', 'reps', 'lapses'] as const).every(k => num((c as Card)[k]))

export function load(st: Storage = localStorage): Stored {
  let raw: string | null = null
  try { raw = st.getItem(KEY) } catch { return { p: empty(), readOnly: false } } // storage disabled
  if (raw === null) return { p: empty(), readOnly: false }
  try {
    const j = JSON.parse(raw)
    if (num(j?.v) && j.v > 1) return { p: empty(), readOnly: true }
    if (j?.v === 1 && j.cards && typeof j.cards === 'object' && Object.values(j.cards).every(isCard) && typeof j.day === 'string' && num(j.fresh))
      return { p: j.day === today() ? j : { ...j, day: today(), fresh: 0 }, readOnly: false }
  } catch { /* garbage: below */ }
  try { st.setItem(BAD, raw) } catch { /* full: the fresh start still beats a crash */ }
  return { p: empty(), readOnly: false }
}

export function save(s: Stored, st: Storage = localStorage) {
  if (s.readOnly) return
  try { st.setItem(KEY, JSON.stringify(s.p)) } catch { /* private mode: this session only */ }
}

/** A review recorded on a new day restarts the daily count of new cards. */
export function record(p: Progress, key: string, card: Card, now = Date.now()): Progress {
  const day = today(now), fresh = (p.day === day ? p.fresh : 0) + (p.cards[key] ? 0 : 1)
  return { ...p, cards: { ...p.cards, [key]: card }, day, fresh }
}
export const reset = (): Progress => empty()
