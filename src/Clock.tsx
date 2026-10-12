import { useEffect, useState } from 'react'
import type { JGOFTimeControl, protocol } from 'goban-engine'
import type { Sign } from './game'
import { t } from './i18n'
import { clockOf, drift, hms } from './ogs'

const DAY = 86_400_000, HOUR = 3_600_000
/** Correspondence time in days and hours, live time as h:mm:ss. */
const span = (ms: number) => (ms >= DAY ? t.days(Math.floor(ms / DAY), Math.floor((ms % DAY) / HOUR)) : hms(ms))

/** One side's OGS clock; ticks on its own so only it re-renders. */
export function Clock({ clock, tc, color, pausedSince }: { clock: protocol.GameClock; tc?: JGOFTimeControl; color: Sign; pausedSince?: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const c = clockOf(clock, color, now, drift(), pausedSince)
  if (!c) return null
  const over = c.main <= 0 && c.period !== undefined, left = over ? c.period! : c.main
  const extra = c.periods !== undefined && tc?.system === 'byoyomi' ? t.periods(c.periods, tc.period_time)
    : c.stones !== undefined && over ? t.stones(c.stones) : ''
  return <span role="timer" className={`clock${c.running && left < 10_000 ? ' low' : ''}`}>{span(left)}{extra && ` · ${extra}`}</span>
}
