// The exercises trainer: your reviews' key moments, practised like the joseki; it borrows the board and the card while open.
// KataGo grades each answer (through App's ask, which queues it behind any other query).
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Mark } from '../board/BoardView'
import { askFirst } from '../files'
import type { Game, Sign, Vertex } from '../game'
import { failureText, pick, t } from '../i18n'
import { Icon } from '../Icon'
import { review } from '../joseki/fsrs'
import { record } from '../joseki/store'
import { gtp, type Analysis } from '../katago'
import { rankName } from '../rank'
import type { Moment } from '../review'
import { deckStep, HAND } from '../today/ritual'
import { addReview, counts, emptyDeck, gapOf, lineOf, load, mv, nextExercise, positionOf, ratingOf, save, verdictOf, weakest, type Exercise, type StoredDeck } from './deck'

const REPLAY_MS = 650
const PHASES = ['opening', 'middle', 'endgame'] as const
/** « Ouverture 4k · Milieu de partie 7k · Fin de partie 12k », phases without a rank left out. */
export const phaseLine = (ps: (number | null)[]) => ps.flatMap((x, i) => (x === null ? [] : [`${t.exPhases[PHASES[i]]} ${rankName(x)}`])).join(' · ')
type Link = [string, string, () => void]
type Line = (Vertex | null)[]
interface Run { k: string; tried: Vertex | null; gap: number | null; shown: Line; more: Line; line: 'better' | 'punish' | null; error: unknown }
/** The exercise's position, then `line` played with rule checks. */
const after = (x: Exercise, line: Line) => { const g = positionOf(x); return g.branch(g.moves.length, line) }

export function useExercises({ view, open, setOpen, blocked, canAnalyze, ask, setThinking, autoLine, hand = HAND }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void; pass?(c: Sign): void } | null>
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  canAnalyze: boolean // an analysis network is active (KataGo grades each answer)
  ask: (g: Game) => Promise<Analysis> // KataGo's view of a position; App serialises the queries
  setThinking: (on: boolean) => void // App's "thinking" (board animation, engine-start captions)
  autoLine: string | null // the automatic review's state, while games wait
  hand?: number // the ritual hand's exercise cards (fewer when counting positions join it)
}) {
  const [store, setStore] = useState<StoredDeck>(load)
  const loaded = useRef(store)
  // shortcut: cards are ~0.5 KB each in localStorage (shared ~5 MB quota), fine for years of daily reviews; move them to a file if players keep thousands
  useEffect(() => { if (store !== loaded.current) save(store) }, [store]) // written on real changes only, never at launch
  const [run, setRun] = useState<Run | null>(null)
  const [say, setSay] = useState<string | null>(null) // a one-off note (a refused move)
  const x = run ? store.p.items[run.k] : undefined
  const pos = useMemo(() => x && run && after(x, run.shown), [x, run?.shown]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => {
    const k = nextExercise(store.p, Date.now(), weakest(store.p.games)) // leaning toward your weakest phase
    setRun(k === null ? null : { k, tried: null, gap: null, shown: [], more: [], line: null, error: null }); setSay(null)
  }
  useEffect(() => { if (open && !run && canAnalyze) next() }, [open, canAnalyze]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A try's gap, shown and recorded once (FSRS). */
  const grade = (k: string, item: Exercise, gap: number) => {
    setRun(r => r && r.k === k ? { ...r, gap } : r)
    setStore(s => s.readOnly ? s : { ...s, p: record(s.p, k, review(s.p.cards[k], ratingOf(item, gap), Date.now())) })
  }
  // any try but the better move and the game's mistake (graded in play) asks KataGo
  useEffect(() => {
    if (!open || !run || !x || !run.tried || run.gap !== null || run.error) return
    const { k, tried } = run
    let live = true
    setThinking(true)
    ask(after(x, [tried])).then(a => { if (live) grade(k, x, gapOf(x, tried, a.scoreLead)!) },
      e => live && setRun(r => r && { ...r, error: e })).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [open, x, run?.k, run?.tried, run?.gap, run?.error]) // eslint-disable-line react-hooks/exhaustive-deps

  // a replayed line, one stone at a time
  useEffect(() => {
    if (!open || !run?.more.length || !pos) return
    const id = setTimeout(() => {
      const v = run.more[0], sign = pos.toPlay
      if (v) view.current?.drop(v, sign); else view.current?.pass?.(sign)
      setRun({ ...run, shown: [...run.shown, v], more: run.more.slice(1) })
    }, REPLAY_MS)
    return () => clearTimeout(id)
  }, [open, run, pos, view])

  const toggle = () => { if (!blocked) { setOpen(!open); setSay(null); if (!open && !run && canAnalyze) next() } } // started at once: no flash of "nothing left"
  const close = () => setOpen(false)
  const add = (game: Game, moments: Moment[], leads: (number | undefined)[], me: Sign | 0) =>
    setStore(s => s.readOnly ? s : { ...s, p: addReview(s.p, game, moments, leads, me, Date.now()) })
  const now = Date.now(), c = counts(store.p, now)
  const today = deckStep(store.p.cards, c.due + c.fresh, now, hand) // the daily ritual's first step: a hand of `hand` cards
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, add, today, counts: c, games: store.p.games }
  if (!open) return none

  // ---------- the board, the note and its links ----------
  const better = x ? lineOf(x.better) : [], punish = x ? lineOf(x.punish) : []
  const played = x && lineOf(x.played)[0]
  const replaying = !!run?.more.length
  const board: Partial<Board3DState> = !run || !x || !pos ? { interactive: false, marks: null } : {
    signMap: pos.board.signMap, last: pos.lastMove?.vertex ?? null, toPlay: pos.toPlay, ownership: null, counting: null, focus: null,
    captures: { black: pos.board.getCaptures(1), white: pos.board.getCaptures(-1) }, interactive: !run.tried,
    marks: played && !replaying && (!run.tried || !pos.board.get(played)) ? [{ v: played, label: '×', tone: 'mistake' } as Mark] : [],
  }
  const play = (v: Vertex | null) => {
    if (!run || !x || run.tried || !v) return false
    const r = positionOf(x).play(v)
    if (r !== 'ok') { setSay(pick(t.refused, r) ?? null); return false }
    setRun({ ...run, tried: v, shown: [v] }); setSay(null)
    const known = gapOf(x, v, null)
    if (known !== null) grade(run.k, x, known)
    return true
  }
  const show = (line: 'better' | 'punish') => {
    if (!run || !x) return
    setRun({ ...run, line, shown: [], more: line === 'better' ? better : [played ?? null, ...punish] }); setSay(null)
  }
  const verdict = run?.gap != null && x ? verdictOf(x, run.gap) : null
  const graded = verdict === 'found' ? t.exFound : verdict === 'short' ? t.exShort(run!.gap!) : t.exMissed(run?.gap ?? 0)
  const note = say ?? (!run || !x ? !canAnalyze ? t.exNeedsNet : Object.keys(store.p.items).length ? t.exDone : t.exEmpty
    : run.error ? t.answerFailed(failureText(run.error))
    : !run.tried ? t.exAsk(x.sign, played ? gtp(played, x.size) : null, x.loss)
    : run.gap === null ? t.exChecking
    : run.line === 'better' && better[0] ? t.betterLine(x.sign, gtp(better[0], x.size), x.loss)
    : run.line === 'punish' && punish[0] ? t.punishLine(-x.sign, gtp(punish[0], x.size), x.sign, x.loss)
    : graded)
  const links: Link[] = !run || !x ? [] : run.error ? [['retry', t.retry, () => setRun({ ...run, error: null })], ['next', t.exNext, next]] : run.gap === null ? [] : [
    ...run.line === 'better' && replaying ? [] : [['better', t.seeBetter, () => show('better')] as Link],
    ...!punish.length || run.line === 'punish' && replaying ? [] : [['punish', t.seePunishment, () => show('punish')] as Link],
    ['next', t.exNext, next],
  ]

  // ---------- the panel ----------
  const resetAll = async () => { if (await askFirst(t.exResetAsk, t.exReset)) { setStore({ p: emptyDeck(), readOnly: false }); setRun(null); setSay(null) } }
  const body = (
    <section className="rv ex" aria-label={t.exercises}>
      <div className="lab"><span>{t.exercises}</span><span /></div>
      {!canAnalyze ? <p className="estimate">{t.exNeedsNet}</p> : <>
        {autoLine && <p className="quiet" aria-live="polite">{autoLine}</p>}
        {(store.readOnly || c.due + c.fresh + c.later > 0) && (
          <p className="quiet" aria-live="polite">{store.readOnly ? t.exReadOnly : t.exProgress(c.due, c.fresh, c.later)}</p>
        )}
        {x ? <p className="quiet">{t.exFrom(x.vs, mv(x))}</p> : <p className="estimate">{Object.keys(store.p.items).length ? t.exDone : t.exEmpty}</p>}
      </>}
      <p className="quiet"><button className="link" onClick={resetAll} disabled={store.readOnly}>{t.exReset}</button></p>
    </section>
  )
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  // the game's own keys are muted while the trainer has the board (Space still presses a focused button)
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {},
  }
  return { ...none, play, board, note, links, body, acts, keys }
}
