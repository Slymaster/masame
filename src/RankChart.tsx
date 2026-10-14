import { t } from './i18n'
import { rankLabel } from './ogs'

export interface RankPoint { t: number; rank: number }

// drawn at its container's width (default: the sheet's, 460 − 2 × 36), so text keeps its size
const H = 92, L = 30, R = 40, TOP = 8, BOTTOM = 18
const MONTH = 30.44 * 24 * 3600_000

/** Integer rank boundaries inside [lo, hi], 2 to 4 of them, widening the domain when fewer fit. */
export function rankTicks(lo: number, hi: number): { lo: number; hi: number; ticks: number[] } {
  if (Math.floor(hi) - Math.ceil(lo) < 1) { lo = Math.floor(lo); hi = Math.ceil(hi); if (hi - lo < 1) hi = lo + 1 }
  const ints: number[] = []
  for (let i = Math.ceil(lo); i <= Math.floor(hi); i++) ints.push(i)
  const step = Math.ceil(ints.length / 4)
  return { lo, hi, ticks: ints.filter(i => (i - ints[0]) % step === 0) }
}

/** A rank over time (OGS's ranking scale; by default my OGS rank): a line; the current rank stands out at the end. */
export function RankChart({ points, label, width: W = 388 }: { points: RankPoint[]; label?: (from: string, to: string, months: number) => string; width?: number }) {
  if (!points.length) return null
  const ys = points.map(p => p.rank)
  const min = Math.min(...ys), max = Math.max(...ys), pad = Math.max(0.4, (max - min) * 0.12)
  const { lo, hi, ticks } = rankTicks(min - pad, max + pad)
  const t0 = points[0].t, t1 = points.at(-1)!.t, span = t1 - t0
  const x = (t: number) => (span ? L + ((t - t0) / span) * (W - L - R) : (L + W - R) / 2)
  const y = (r: number) => TOP + ((hi - r) / (hi - lo)) * (H - TOP - BOTTOM)
  const xy = (t: number, r: number) => `${x(t).toFixed(1)},${y(r).toFixed(1)}`
  const line = points.map(p => xy(p.t, p.rank)).join(' ')
  const last = points.at(-1)!, first = points[0]
  const months = Math.max(1, Math.round(span / MONTH))
  const date = (ms: number) => t.month(new Date(ms).toISOString())

  return (
    <svg className="rank-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={(label ?? t.ogsChartLabel)(rankLabel(first.rank), rankLabel(last.rank), months)}>
      {ticks.map(r => <g key={r}>
        <line className="rc-rule" x1={L} x2={W - R} y1={y(r)} y2={y(r)} />
        <text className="rc-tick" x={L - 6} y={y(r)} dy="0.35em" textAnchor="end">{rankLabel(r)}</text>
      </g>)}
      <polyline className="rc-line" points={line} />
      <circle className="rc-now" cx={x(last.t)} cy={y(last.rank)} r={3} />
      <text className="rc-now-label" x={x(last.t) + 7} y={y(last.rank)} dy="0.35em">{rankLabel(last.rank)}</text>
      <text className="rc-date" x={L} y={H - 3}>{date(t0)}</text>
      {date(t1) !== date(t0) && <text className="rc-date" x={W - R} y={H - 3} textAnchor="end">{date(t1)}</text>}
    </svg>
  )
}
