import { useEffect, useState, useSyncExternalStore } from 'react'
import { failureText, t } from './i18n'
import * as ogs from './ogs'
import { RankChart, type RankPoint } from './RankChart'

const H = 3600_000, D = 24 * H

/** Time left on a correspondence clock: "2 d 4 h", or "5 h" / "40 min" under a day. */
export function timeLeft(ms: number): string {
  ms = Math.max(0, ms)
  const d = Math.floor(ms / D), h = Math.floor((ms % D) / H)
  return d ? t.days(d, h) : h ? t.ogsHours(h) : t.ogsMinutes(Math.floor(ms / 60_000))
}

/** My turn first, the most urgent first; then the newest. */
export const activeOrder = (a: ogs.ActiveRow, b: ogs.ActiveRow) =>
  +b.myTurn - +a.myTurn || (a.myTurn ? (a.expires ?? Infinity) - (b.expires ?? Infinity) : 0) || b.id - a.id

const who = (p: ogs.Player) => <span className="who"><span className="nm">{p.username}</span>{p.rank && <span className="rk">{p.rank}</span>}</span>

/** My rank over time, my ongoing games (live, from the store) and my finished ones, a page at a time. */
export function OgsGames({ onResume, onImport }: { onResume: (id: number) => void; onImport: (id: number) => void }) {
  const active = useSyncExternalStore(ogs.active.subscribe, ogs.active.get)
  const [rating, setRating] = useState<RankPoint[] | string | null>(null)
  const [done, setDone] = useState<{ rows: ogs.GameRow[]; page: number; more: boolean } | null>(null)
  const [doneErr, setDoneErr] = useState<string | null>(null), [loading, setLoading] = useState(false)
  const load = (page: number) => {
    setLoading(true); setDoneErr(null)
    return ogs.history(page).then(r => setDone(d => ({ rows: [...(page > 1 && d ? d.rows : []), ...r.rows], page, more: r.more })),
      e => setDoneErr(failureText(e))).finally(() => setLoading(false))
  }
  useEffect(() => {
    let live = true
    ogs.ratingHistory().then(r => live && setRating(r), e => live && setRating(failureText(e)))
    void load(1)
    return () => { live = false }
  }, [])
  const now = Date.now()
  const detail = (g: ogs.ActiveRow) => [
    `${g.size}×${g.size}`,
    g.phase === 'stone removal' ? t.ogsCounting : g.myTurn ? t.ogsYourTurn : t.ogsTheirTurn,
    g.corr && g.myTurn && g.expires !== undefined && timeLeft(g.expires - now),
  ].filter(Boolean).join(' · ')
  const last = Array.isArray(rating) ? rating.at(-1) : undefined

  return <>
    <div className="games ogs-rank">
      <div className="games-title"><span>{t.ogsRank}</span>{last && <span className="ogs-rank-now">{ogs.rankLabel(last.rank)}</span>}</div>
      {rating === null ? <p className="quiet">{t.ogsLoading}</p>
        : typeof rating === 'string' ? <p className="quiet err">{rating}</p>
        : !rating.length ? <p className="quiet">{t.ogsNoRanked}</p>
        : <RankChart points={rating} />}
    </div>
    <div className="games">
      <div className="games-title">{t.ongoing}</div>
      {active === null ? <p className="quiet">{t.ogsLoading}</p>
        : !active.length ? <p className="quiet">{t.none}</p>
        : [...active].sort(activeOrder).map(g => (
          <button key={g.id} className={`game-row${g.myTurn && g.phase === 'play' ? ' turn-mine' : ''}`} onClick={() => onResume(g.id)}>
            {who(g.opponent)}<span className="dim">{detail(g)}</span>
          </button>
        ))}
    </div>
    <div className="games">
      <div className="games-title">{t.finished}</div>
      {done === null ? (!doneErr && <p className="quiet">{t.ogsLoading}</p>)
        : !done.rows.length ? <p className="quiet">{t.none}</p>
        : done.rows.map(g => (
          <button key={g.id} className="game-row" onClick={() => onImport(g.id)}>
            {who(g.opponent)}<span className="dim">{`${g.size}×${g.size} · ${g.result ?? ''} · ${t.date(g.date)}`}</span>
          </button>
        ))}
      {doneErr && <p className="quiet err" role="alert">{doneErr}</p>}
      {done?.more && <button className="link ogs-more" onClick={() => void load(done.page + 1)} disabled={loading}>{t.ogsMore}</button>}
    </div>
  </>
}
