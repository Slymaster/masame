// The "Apprendre" door, tabs [Aujourd'hui | Progrès]. Aujourd'hui: the daily ritual, then one row per deck; a row closes
// the sheet and opens its trainer on the card. Progrès: a list of sections. Both lists come from App, so a new activity
// appends one DeckRow (and, if it measures something, one ProgressSection) without touching this file.
import { useEffect, useState, type ReactNode } from 'react'
import { failureText, t } from './i18n'
import * as ogs from './ogs'
import { curve, localRank, phaseRanks, rankName, WINDOW, type Read } from './rank'
import { RankChart, type RankPoint } from './RankChart'
import { Seg } from './Seg'
import { Sheet } from './Sheet'
import { phaseLine } from './exercises/useExercises'
import { whereLost, type Played } from './exercises/deck'

/** A deck in Aujourd'hui: its counter "to review · new" (null: not known yet, or `off` says why it can't open). */
export interface DeckRow { key: string; name: string; phrase: string; counts: { due: number; fresh: number } | null; off?: string; open: () => void }
/** A section of Progrès: a ruled title (and its right-hand side), then its body. */
export interface ProgressSection { key: string; title: string; side?: string; body: ReactNode }

type Tab = 'today' | 'progress'
const TAB_KEY = 'masame.learn.tab'
export const storedTab = (): Tab => { try { return localStorage.getItem(TAB_KEY) === 'progress' ? 'progress' : 'today' } catch { return 'today' } }
export const storeTab = (v: Tab) => { try { localStorage.setItem(TAB_KEY, v) } catch { /* private mode: not remembered */ } }

export function LearnSheet({ onClose, opener, ritual, decks, blocked, progress }: {
  onClose: () => void; opener: HTMLElement | null
  ritual: ReactNode // useToday's body
  decks: DeckRow[]; blocked: boolean // an ongoing OGS game or a review: no trainer opens
  progress: ProgressSection[]
}) {
  const [tab, setTab] = useState<Tab>(storedTab)
  const pick = (v: Tab) => { setTab(v); storeTab(v) }
  return (
    <Sheet title={t.doors.learn} onClose={onClose} opener={opener}>
      <div><Seg label={t.learnTabsLabel} value={tab} options={(['today', 'progress'] as const).map(v => [v, t.learnTabs[v]])} set={pick} /></div>
      {tab === 'today' ? <>
        {ritual}
        <section className="decks">
          <div className="lab"><span>{t.decksLab}</span><span /></div>
          {blocked && <p className="say">{t.learnBlocked}</p>}
          <ul>
            {decks.map(d => <li key={d.key}>
              <button className="deck-row" onClick={d.open} disabled={blocked}>
                <span className="deck-top"><b>{d.name}</b><span className="deck-n">{d.off ?? (d.counts ? t.deckCount(d.counts.due, d.counts.fresh) : '')}</span></span>
                <span className="deck-phrase">{d.phrase}</span>
              </button>
            </li>)}
          </ul>
        </section>
      </> : progress.map(s => (
        <section key={s.key} className="progress">
          <div className="lab"><span>{s.title}</span><span>{s.side ?? ''}</span></div>
          {s.body}
        </section>
      ))}
    </Sheet>
  )
}

/** Progrès › Your rank read in your moves (src/rank.ts). */
export function RankProgress({ ranks, follows }: { ranks: Read[]; follows: boolean }) {
  if (!ranks.length) return <p className="say">{t.rankNone}</p>
  return <>
    <p className="state">{rankName(localRank(ranks)!)}</p>
    <p className="quiet">{phaseLine(phaseRanks(ranks))}</p>
    <RankChart points={curve(ranks)} label={(a, b) => t.rankChartLabel(a, b, ranks.length)} width={308} />
    <p className="quiet">{t.rankHelp(Math.min(WINDOW, ranks.length), follows)}</p>
  </>
}

/** Progrès › OGS rating, loaded when shown (signed in only: App leaves the section out otherwise). */
export function OgsRating() {
  const [rating, setRating] = useState<RankPoint[] | string | null>(null)
  useEffect(() => {
    let live = true
    ogs.ratingHistory().then(r => live && setRating(r), e => live && setRating(failureText(e)))
    return () => { live = false }
  }, [])
  const last = Array.isArray(rating) ? rating.at(-1) : undefined
  return rating === null ? <p className="say">{t.ogsLoading}</p>
    : typeof rating === 'string' ? <p className="say err">{rating}</p>
    : !rating.length ? <p className="say">{t.ogsNoRanked}</p>
    : <><p className="state">{ogs.rankLabel(last!.rank)}</p><RankChart points={rating} /></>
}

const PHASES = ['opening', 'middle', 'endgame'] as const
/** Progrès › Where you lose points, per phase; `work` (when given) adds a button per phase to practise it. */
export function WhereLost({ games, work, blocked }: { games: Played[]; work?: (phase: 0 | 1 | 2) => void; blocked?: boolean }) {
  const n = games.length, where = whereLost(games), top = Math.max(...where), i = where.indexOf(top), head = Math.round(top) > 0 // first on a tie; never "−0 points"
  if (!n) return <p className="say">{t.exWhereNone}</p>
  return <>
    {head && <>
      <p className="state">{t.exPhases[PHASES[i]]}</p>
      <p className="share">{t.exPerGame(top, top / where.reduce((a, b) => a + b) * 100)}</p>
    </>}
    <ul className="phases">
      {PHASES.map((name, j) => <li key={name} className={head && j === i ? 'top' : ''}>
        <span>{t.exPhases[name]}</span><b>{t.exLost(where[j])}</b>
        {work && <button className="link" onClick={() => work(j as 0 | 1 | 2)} disabled={blocked}>{t.work}</button>}
      </li>)}
    </ul>
    <p className="quiet">{t.exWhereHelp(n)}</p>
  </>
}
