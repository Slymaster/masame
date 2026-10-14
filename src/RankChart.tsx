import { t } from './i18n'
import { rankLabel } from './ogs'

export interface RankPoint { t: number; rank: number; lo?: number; hi?: number }

// drawn at the sheet's content width (460 − 2 × 36), so text keeps its size
const W = 388, H = 92, L = 30, R = 40, TOP = 8, BOTTOM = 18
const MONTH = 30.44 * 24 * 3600_000

/** Integer rank boundaries inside [lo, hi], 2 to 4 of them, widening the domain when fewer fit. */
export function rankTicks(lo: number, hi: number): { lo: number; hi: number; ticks: number[] } {
  if (Math.floor(hi) - Math.ceil(lo) < 1) { lo = Math.floor(lo); hi = Math.ceil(hi); if (hi - lo < 1) hi = lo + 1 }
  const ints: number[] = []
  for (let i = Math.ceil(lo); i <= Math.floor(hi); i++) ints.push(i)
  const step = Math.ceil(ints.length / 4)
  return { lo, hi, ticks: ints.filter(i => (i - ints[0]) % step === 0) }
}

/** My OGS rank over time: a line, a ± deviation band, or a dot per game; the current rank stands out at the end. */
export function RankChart({ points, variant = 'line' }: { points: RankPoint[]; variant?: 'line' | 'band' | 'dots' }) {
  if (!points.length) return null
  const band = variant === 'band'
  const ys = points.flatMap(p => (band ? [p.rank, p.lo ?? p.rank, p.hi ?? p.rank] : [p.rank]))
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
    <svg className="rank-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.ogsChartLabel(rankLabel(first.rank), rankLabel(last.rank), months)}>
      {ticks.map(r => <g key={r}>
        <line className="rc-rule" x1={L} x2={W - R} y1={y(r)} y2={y(r)} />
        <text className="rc-tick" x={L - 6} y={y(r)} dy="0.35em" textAnchor="end">{rankLabel(r)}</text>
      </g>)}
      {band && <polygon className="rc-band" points={[...points.map(p => xy(p.t, p.hi ?? p.rank)), ...points.map(p => xy(p.t, p.lo ?? p.rank)).reverse()].join(' ')} />}
      {variant === 'dots'
        ? points.map((p, i) => <circle key={i} className="rc-dot" cx={x(p.t)} cy={y(p.rank)} r={1.6} />)
        : <polyline className="rc-line" points={line} />}
      <circle className="rc-now" cx={x(last.t)} cy={y(last.rank)} r={3} />
      <text className="rc-now-label" x={x(last.t) + 7} y={y(last.rank)} dy="0.35em">{rankLabel(last.rank)}</text>
      <text className="rc-date" x={L} y={H - 3}>{date(t0)}</text>
      {date(t1) !== date(t0) && <text className="rc-date" x={W - R} y={H - 3} textAnchor="end">{date(t1)}</text>}
    </svg>
  )
}
