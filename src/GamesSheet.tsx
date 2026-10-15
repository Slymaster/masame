// The "Mes parties" door: the OGS games going on (my turn first), then every game kept in the library, filtered by
// source and searched by opponent, 50 at a time; a row opens the game on the board. Importing an SGF lives here too.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { failureText, t } from './i18n'
import { inTauri } from './katago'
import * as library from './library'
import type { Entry, Source } from './library'
import * as ogs from './ogs'
import { isMobile, shortcut } from './platform' // OGS on phones: v1.1
import { rankName } from './rank'
import { Seg } from './Seg'
import { Sheet } from './Sheet'

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

export type Filter = 'all' | 'ai' | 'ogs' | 'two' | 'file'
export const FILTERS: Filter[] = ['all', 'ai', 'ogs', 'two', 'file']
const SOURCES: Record<Exclude<Filter, 'all'>, Source[]> = { ai: ['ai'], ogs: ['ogs'], two: ['two'], file: ['file', 'position'] }
/** Who the player faced: the other side, or both sides when the player's colour is unknown. */
export const opponents = (e: Entry) => (e.me === 1 ? [e.white] : e.me === -1 ? [e.black] : [e.black, e.white])
/** The entries a filter and an opponent search keep, in the library's order (newest first). */
export function filtered(xs: Entry[], f: Filter, q: string): Entry[] {
  const s = q.trim().toLocaleLowerCase()
  return xs.filter(e => (f === 'all' || SOURCES[f].includes(e.source)) && (!s || opponents(e).some(p => p.name.toLocaleLowerCase().includes(s))))
}
/** The first `pages` pages of PAGE rows, and whether more remain. */
export const paged = <T,>(xs: T[], pages: number) => ({ rows: xs.slice(0, pages * library.PAGE), more: xs.length > pages * library.PAGE })
/** The result from the player's side: Won · B+R, Lost · W+4.5, Draw, Unfinished; the bare RE when the side is unknown. */
export function outcome(e: Entry): string {
  const re = e.result
  if (!re) return t.lbUnfinished
  if (re === '0' || /^(draw|jigo)/i.test(re)) return t.lbDraw
  if (!e.me) return re
  return `${re[0] === (e.me === 1 ? 'B' : 'W') ? t.lbWon : t.lbLost} · ${re}`
}
/** Finished OGS games not in the library yet: opening one imports it. */
export const notImported = (rows: ogs.GameRow[], xs: Entry[]) => rows.filter(g => !xs.some(e => e.ogsId === g.id))
/** A row's badges. Later activities add theirs here (from their Entry fields). */
export const badges = (e: Entry): string[] => [
  e.review && t.lbMoments(e.review.moments),
  e.memory && t.lbMemory(e.memory.recalled, e.memory.total),
  e.counted && t.lbCounted,
].filter((x): x is string => !!x)

// the AI's name already carries its rank ("KataGo human 10k")
const who = (p: { name: string; rank: string }, sign: 1 | -1) =>
  <span key={sign} className="who"><span className="nm">{p.name || t.color(sign)}</span>{p.rank && !p.name.endsWith(p.rank) && <span className="rk">{p.rank}</span>}</span>

export function GamesSheet({ onClose, opener, onResume, onOpen, onImport, onImportOgs }: {
  onClose: () => void; opener: HTMLElement | null
  onResume: (id: number) => void // an ongoing OGS game
  onOpen: (e: Entry) => void // a library game, shown on the board
  onImport: () => void // Import an SGF…
  onImportOgs: (id: number) => void // a finished OGS game not in the library yet
}) {
  const active = useSyncExternalStore(ogs.active.subscribe, ogs.active.get)
  const searches = useSyncExternalStore(ogs.searches.subscribe, ogs.searches.get)
  const entries = useSyncExternalStore(library.subscribe, library.get)
  const [error, setError] = useState<unknown>(null)
  const [filter, setFilter] = useState<Filter>('all'), [q, setQ] = useState(''), [pages, setPages] = useState(1)
  useEffect(() => { if (inTauri()) library.load().catch(setError) }, [])
  // OGS filter: the finished OGS games, 20 a page, fetched only when asked for
  const [done, setDone] = useState<{ rows: ogs.GameRow[]; page: number; more: boolean } | null>(null)
  const [doneErr, setDoneErr] = useState<unknown>(null), [loading, setLoading] = useState(false)
  const loadDone = (page: number) => {
    setLoading(true); setDoneErr(null)
    ogs.history(page).then(r => setDone(d => ({ rows: [...(page > 1 && d ? d.rows : []), ...r.rows], page, more: r.more })), setDoneErr)
      .finally(() => setLoading(false))
  }
  const showOgs = filter === 'ogs' && !!ogs.me && inTauri()
  const now = Date.now()
  const ongoing = ogs.me ? [...active ?? []].sort(activeOrder) : []
  const detail = (g: ogs.ActiveRow) => [
    `${g.size}×${g.size}`,
    g.phase === 'stone removal' ? t.ogsCounting : g.myTurn ? t.ogsYourTurn : t.ogsTheirTurn,
    g.corr && g.myTurn && g.expires !== undefined && timeLeft(g.expires - now),
  ].filter(Boolean).join(' · ')
  const list = entries && filtered(entries, filter, q), page = list && paged(list, pages)

  return (
    <Sheet title={t.doors.games} onClose={onClose} opener={opener}>
      {(ongoing.length > 0 || (ogs.me && searches.length > 0)) && <section>
        <div className="lab"><span>{t.ongoing}</span><span /></div>
        {ongoing.map(g => (
          <button key={g.id} className={`game-row${g.myTurn && g.phase === 'play' ? ' turn-mine' : ''}`} onClick={() => onResume(g.id)}>
            <span className="who"><span className="nm">{g.opponent.username}</span>{g.opponent.rank && <span className="rk">{g.opponent.rank}</span>}</span>
            <span className="dim">{detail(g)} · <span className="go">{t.resume}</span></span>
          </button>
        ))}
        {searches.map(s => (
          <div key={s.uuid} className="ogs-item">
            <span className="dim">{t.ogsCorrSearch(s.size)}</span>
            <span className="ogs-acts"><button className="link" onClick={() => { try { ogs.cancelSearch(s.uuid) } catch { /* offline: it ends with the session */ } }}>{t.cancel}</button></span>
          </div>
        ))}
      </section>}

      <section>
        <div className="lab"><span>{t.gamesAll}</span><span>{list && list.length ? list.length : ''}</span></div>
        {!inTauri() ? <p className="say">{t.gamesInAppOnly}</p> : <>
          <Seg label={t.gamesFilterLabel} value={filter} options={FILTERS.filter(f => !isMobile || f !== 'ogs').map(f => [f, t.gamesFilters[f]])} set={f => { setFilter(f); setPages(1) }} />
          <input className="ogs-input" type="search" value={q} onChange={e => { setQ(e.target.value); setPages(1) }} placeholder={t.gamesSearch} aria-label={t.gamesSearch}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
          {error ? <p className="say err" role="alert">{failureText(error)}</p>
            : !page ? <p className="say">{t.gamesLoading}</p>
            : !page.rows.length ? <p className="say">{entries!.length ? t.gamesNoMatch : t.gamesEmpty}</p>
            : <ul className="lib">
              {page.rows.map(e => {
                const bs = badges(e)
                return <li key={e.id}><button className="lib-row" onClick={() => onOpen(e)}>
                  <span className="lib-top">
                    <span className="lib-who">{e.me ? who(opponents(e)[0], e.me === 1 ? -1 : 1) : <>{who(e.black, 1)}<span className="vs">·</span>{who(e.white, -1)}</>}</span>
                    <span className="lib-res">{outcome(e)}</span>
                  </span>
                  <span className="lib-sub">{[t.date(e.date), `${e.size}×${e.size}`, e.rankRead && t.lbPlayedLike(rankName(e.rankRead.all))].filter(Boolean).join(' · ')}</span>
                  {bs.length > 0 && <span className="lib-badges">{bs.map(b => <i key={b}>{b}</i>)}</span>}
                </button></li>
              })}
            </ul>}
          {page?.more ? <button className="link ogs-more" onClick={() => setPages(p => p + 1)}>{t.ogsMore}</button>
            : showOgs && !done && !loading && !doneErr && <button className="link ogs-more" onClick={() => loadDone(1)}>{t.ogsMore}</button>}
          {showOgs && (done || loading || doneErr) && <>
            <div className="lab"><span>{t.gamesOgsFinished}</span><span /></div>
            {done && (notImported(done.rows, entries ?? []).length
              ? notImported(done.rows, entries ?? []).map(g => (
                <button key={g.id} className="game-row" onClick={() => onImportOgs(g.id)}>
                  <span className="who"><span className="nm">{g.opponent.username}</span>{g.opponent.rank && <span className="rk">{g.opponent.rank}</span>}</span>
                  <span className="dim">{[`${g.size}×${g.size}`, g.result, t.date(g.date)].filter(Boolean).join(' · ')}</span>
                </button>))
              : !done.more && <p className="say">{t.gamesOgsAllKept}</p>)}
            {loading && <p className="say">{t.ogsLoading}</p>}
            {!!doneErr && <p className="say err" role="alert">{failureText(doneErr)}</p>}
            {done?.more && !loading && <button className="link ogs-more" onClick={() => loadDone(done.page + 1)}>{t.ogsMore}</button>}
          </>}
        </>}
      </section>

      <section className="opts">
        <button className="btn" onClick={onImport} title={shortcut('O')}>{t.gamesImport}</button>
      </section>
    </Sheet>
  )
}
