// The journal: what you practised, one small event at a time, kept in localStorage like the decks. The monthly letter
// (Apprendre › Progrès) reads it; each trainer notes its own graded answers, the ritual its done days.
export type Kind = 'exercise' | 'tsumego' | 'count' | 'joseki' | 'fuseki' | 'classic' | 'memory' | 'yose' | 'ritual'
/** ok: found (or done); id: what was practised (a card key, a game id), for "new lines learned" and the like. */
export interface Event { t: number; k: Kind; ok: boolean; id?: string }
export const KEY = 'masame.journal', BAD = 'masame.journal.bad', CAP = 5000 // a few years of daily practice; the oldest go first
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const isEvent = (e: unknown): e is Event => !!e && typeof e === 'object' && Number.isFinite((e as Event).t)
  && typeof (e as Event).k === 'string' && typeof (e as Event).ok === 'boolean' && ['undefined', 'string'].includes(typeof (e as Event).id)

/** Stored as { v: 1, events } (a bare array, the first format, is read too). A newer version is read-only; garbage is kept aside. */
function read(st: Storage): { es: Event[]; readOnly: boolean } {
  let raw: string | null
  try { raw = st.getItem(KEY) } catch { return { es: [], readOnly: true } } // storage disabled: nothing to read or write
  if (raw === null) return { es: [], readOnly: false }
  try {
    const j = JSON.parse(raw)
    if (Number.isFinite(j?.v) && j.v > 1) return { es: [], readOnly: true }
    const list = Array.isArray(j) ? j : j?.v === 1 && Array.isArray(j.events) ? j.events : null
    if (list) return { es: list.filter(isEvent), readOnly: false }
  } catch { /* garbage: below */ }
  try { st.setItem(BAD, raw) } catch { /* full: the fresh start still beats a crash */ }
  return { es: [], readOnly: false }
}

export const load = (st: Storage = localStorage): Event[] => read(st).es

export function note(k: Kind, ok: boolean, id?: string, now = Date.now(), st: Storage = localStorage) {
  const { es, readOnly } = read(st)
  if (readOnly) return
  try { st.setItem(KEY, JSON.stringify({ v: 1, events: [...es, { t: now, k, ok, ...id !== undefined && { id } }].slice(-CAP) })) } catch { /* private mode or full: this one is lost */ }
}

/** The events of a calendar month (local time; m: 0–11). */
export function inMonth(es: Event[], y: number, m: number): Event[] {
  const from = new Date(y, m, 1).getTime(), to = new Date(y, m + 1, 1).getTime()
  return es.filter(e => e.t >= from && e.t < to)
}
