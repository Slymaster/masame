// The journal: what you practised, one small event at a time, kept in localStorage like the decks. The monthly letter
// (Apprendre › Progrès) reads it; each trainer notes its own graded answers, the ritual its done days.
export type Kind = 'exercise' | 'tsumego' | 'count' | 'joseki' | 'fuseki' | 'classic' | 'memory' | 'yose' | 'ritual'
/** ok: found (or done); id: what was practised (a card key, a game id), for "new lines learned" and the like. */
export interface Event { t: number; k: Kind; ok: boolean; id?: string }
export const KEY = 'masame.journal', CAP = 5000 // a few years of daily practice; the oldest go first
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const isEvent = (e: unknown): e is Event => !!e && typeof e === 'object' && Number.isFinite((e as Event).t)
  && typeof (e as Event).k === 'string' && typeof (e as Event).ok === 'boolean' && ['undefined', 'string'].includes(typeof (e as Event).id)

export function load(st: Storage = localStorage): Event[] {
  try {
    const j = JSON.parse(st.getItem(KEY) ?? '[]')
    return Array.isArray(j) ? j.filter(isEvent) : []
  } catch { return [] } // storage disabled or garbage: an empty journal, never a crash
}

export function note(k: Kind, ok: boolean, id?: string, now = Date.now(), st: Storage = localStorage) {
  const es = [...load(st), { t: now, k, ok, ...id !== undefined && { id } }].slice(-CAP)
  try { st.setItem(KEY, JSON.stringify(es)) } catch { /* private mode or full: this one is lost */ }
}

/** The events of a calendar month (local time; m: 0–11). */
export function inMonth(es: Event[], y: number, m: number): Event[] {
  const from = new Date(y, m, 1).getTime(), to = new Date(y, m + 1, 1).getTime()
  return es.filter(e => e.t >= from && e.t < to)
}
