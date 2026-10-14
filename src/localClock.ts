// A byo-yomi clock for local games: pure time maths (ms), React only syncs it with the side to move.
import type { Sign } from './game'
import type { Clock } from './ogs'

export interface Spec { main: number; periods: number; period: number }
export const CLOCKS = {
  '5+3x20': { main: 300_000, periods: 3, period: 20_000 },
  '10+3x30': { main: 600_000, periods: 3, period: 30_000 },
  '30+5x30': { main: 1_800_000, periods: 5, period: 30_000 },
} satisfies Record<string, Spec>
export type ClockSetting = 'off' | keyof typeof CLOCKS

/** main: main time left; periods: byo-yomi periods left, the current one included; period: what is left of it. */
export interface Side { main: number; periods: number; period: number }
/** len: the line's length at the last sync. */
export interface LocalClock { spec: Spec; b: Side; w: Side; turn: Sign | null; since: number; len: number }

const key = (s: Sign) => (s === 1 ? 'b' : 'w')
export function startClock(spec: Spec): LocalClock {
  const s = { main: spec.main, periods: spec.periods, period: spec.period }
  return { spec, b: s, w: s, turn: null, since: 0, len: 0 }
}

/** Main time first, then the periods: each one fully elapsed is used up; none left is a loss on time. */
export function spend(s: Side, ms: number, p: number): Side {
  const main = s.main - ms
  if (main >= 0) return { ...s, main }
  const over = -main - s.period // past the current period
  if (over < 0) return { main: 0, periods: s.periods, period: -over }
  const periods = Math.max(0, s.periods - 1 - Math.floor(over / p))
  return { main: 0, periods, period: periods ? p - (over % p) : 0 }
}

/** What the face shows for `sign` at `now`. */
export function read(c: LocalClock, sign: Sign, now: number): Clock {
  const s = c.turn === sign ? spend(c[key(sign)], Math.max(0, now - c.since), c.spec.period) : c[key(sign)]
  return { ...s, running: c.turn === sign }
}

export const timeUp = (c: LocalClock, sign: Sign, now: number) => { const r = read(c, sign, now); return r.main <= 0 && !r.periods }

/** When the running side runs out of time (null: stopped). */
export function flagAt(c: LocalClock): number | null {
  if (c.turn === null) return null
  const s = c[key(c.turn)]
  return c.since + s.main + (s.periods ? s.period + (s.periods - 1) * c.spec.period : 0)
}

/** Charges the running side and starts `turn` (null: stopped) for a line of `len` moves; a move handing the turn over
 * starts a fresh period (an undo doesn't). Same object when nothing changes. */
export function sync(c: LocalClock, turn: Sign | null, now: number, len: number): LocalClock {
  if (turn === c.turn) return len === c.len ? c : { ...c, len }
  const next = { ...c, turn, since: now, len }
  if (c.turn !== null) {
    const s = spend(c[key(c.turn)], now - c.since, c.spec.period)
    next[key(c.turn)] = turn === -c.turn && len > c.len && s.periods ? { ...s, period: c.spec.period } : s
  }
  return next
}

/** SGF TM (seconds) and OT. */
export const sgfTime = (s: Spec) => ({ TM: [String(s.main / 1000)], OT: [`${s.periods}x${s.period / 1000} byo-yomi`] })
