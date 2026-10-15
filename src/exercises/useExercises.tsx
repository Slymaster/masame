// The exercises trainer: your reviews' key moments, practised like the joseki; it borrows the board and the card while open.
// KataGo grades each answer (through App's ask, which queues it behind any other query).
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Mark } from '../board/BoardView'
import { askFirst } from '../files'
import type { Game, Sign, Vertex } from '../game'
import { failureText, pick, t } from '../i18n'
import { Icon } from '../Icon'
import { note as journal } from '../journal'
import { review, type Rating } from '../joseki/fsrs'
import { record } from '../joseki/store'
import { gtp, type Analysis } from '../katago'
import * as library from '../library'
import { boxOf, ldVerdict, mean, PLIES, reached } from '../tsumego/mine'
import { findYose, libraryGames, YOSE_N, YOSE_QUERY } from '../tsumego/yose'
import { rankName } from '../rank'
import { REPLY, type Moment } from '../review'
import { deckStep, HAND } from '../today/ritual'
import { addReview, counts, emptyDeck, gapOf, lineOf, load, mv, nextExercise, positionOf, save, sessionKeys, verdictOf, weakest, type Exercise, type Only, type StoredDeck } from './deck'

const REPLAY_MS = 650
const PHASES = ['opening', 'middle', 'endgame'] as const
/** « Ouverture 4k · Milieu de partie 7k · Fin de partie 12k », phases without a rank left out. */
export const phaseLine = (ps: (number | null)[]) => ps.flatMap((x, i) => (x === null ? [] : [`${t.exPhases[PHASES[i]]} ${rankName(x)}`])).join(' · ')
type Link = [string, string, () => void]
type Line = (Vertex | null)[]
// ok: a tsumego's status reached after KataGo's reply (null until checked)
interface Run { k: string; tried: Vertex | null; gap: number | null; ok: boolean | null; shown: Line; more: Line; line: 'better' | 'punish' | 'reply' | null; error: unknown }
/** What the trainer shows: one kind of card from the deck (`only`), or a session's cards in order (`keys`; yose ones in `yose`,
 *  found while `gen` counts them); `then` is offered once the session is over. */
interface Session { only: Only; keys: string[] | null; yose: Record<string, Exercise> | null; gen: number | null; then: Link | null; error?: unknown; empty?: boolean }
const DECK: Session = { only: 'find', keys: null, yose: null, gen: null, then: null }
export const WORK_N = 8 // cards in a phase session
const RATING: Record<'found' | 'short' | 'missed', Rating> = { found: 3, short: 2, missed: 1 }
const fresh = (k: string): Run => ({ k, tried: null, gap: null, ok: null, shown: [], more: [], line: null, error: null })
/** The exercise's position, then `line` played with rule checks. */
const after = (x: Exercise, line: Line) => { const g = positionOf(x); return g.branch(g.moves.length, line) }

export function useExercises({ view, open, setOpen, blocked, canAnalyze, ask, setThinking, autoLine, hand = HAND }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void; pass?(c: Sign): void } | null>
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  canAnalyze: boolean // an analysis network is active (KataGo grades each answer)
  ask: (g: Game, q?: object) => Promise<Analysis> // KataGo's view of a position (REPLY by default); App serialises the queries
  setThinking: (on: boolean) => void // App's "thinking" (board animation, engine-start captions)
  autoLine: string | null // the automatic review's state, while games wait
  hand?: number // the ritual hand's exercise cards (fewer when counting positions join it)
}) {
  const [store, setStore] = useState<StoredDeck>(load)
  const loaded = useRef(store)
  // shortcut: cards are ~0.5 KB each in localStorage (shared ~5 MB quota), fine for years of daily reviews; move them to a file if players keep thousands
  useEffect(() => { if (store !== loaded.current) save(store) }, [store]) // written on real changes only, never at launch
  const [run, setRun] = useState<Run | null>(null)
  const [session, setSession] = useState<Session>(DECK)
  const [say, setSay] = useState<string | null>(null) // a one-off note (a refused move)
  const x = run ? session.yose?.[run.k] ?? store.p.items[run.k] : undefined
  const pos = useMemo(() => x && run && after(x, run.shown), [x, run?.shown]) // eslint-disable-line react-hooks/exhaustive-deps
  const gen = useRef(0) // the yose search under way: a new session or closing cancels it

  const next = (s = session) => {
    let k: string | null
    if (s.keys) { k = s.keys[0] ?? null; setSession({ ...s, keys: s.keys.slice(1) }) }
    else k = nextExercise(store.p, Date.now(), weakest(store.p.games), s.only) // leaning toward your weakest phase
    setRun(k === null ? null : fresh(k)); setSay(null)
  }
  /** Opens the trainer on a deck or a session, its first card at once. */
  const start = (s: Partial<Session>) => {
    if (blocked) return
    const n = { ...DECK, ...s }
    gen.current++; setSession(n); setOpen(true)
    if (canAnalyze) next(n); else setRun(null)
  }
  useEffect(() => { if (open && !run && canAnalyze && session.gen === null) next() }, [open, canAnalyze]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) { gen.current++; if (session.gen !== null) setThinking(false) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Fin de partie: a yose session, its positions found now in the library's endgames (the player watches the count). */
  const yoseSession = () => {
    if (blocked) return
    start({ only: null, keys: [], yose: {}, gen: 0 })
    const id = gen.current, live = () => gen.current === id
    setThinking(true)
    libraryGames().then(gs => findYose(gs, g => ask(g, YOSE_QUERY), live, n => live() && setSession(s => ({ ...s, gen: n })), Date.now()))
      .then(xs => {
        if (!live()) return
        const yose = Object.fromEntries(xs.map((x, i) => [`yose-${i}`, x])), s: Session = { ...DECK, only: null, keys: Object.keys(yose), yose }
        setSession(s); next(s)
      }, e => live() && setSession(s => ({ ...s, gen: null, error: e })))
      .finally(() => live() && setThinking(false))
  }
  /** Progrès › Travailler: opening, the phase-0 exercises then `opening` (joseki or fuseki practice); middle game, a mixed
   *  session of WORK_N cards; endgame, a yose session. */
  const work = (phase: 0 | 1 | 2, opening: () => void) => {
    if (blocked) return
    if (phase === 2) return yoseSession()
    const keys = sessionKeys(store.p, Date.now(), WORK_N, phase)
    if (phase === 0 && !keys.length) return opening()
    start({ only: null, keys, empty: !keys.length, then: phase === 0 ? ['opening', t.workOpening, opening] : null })
  }

  /** A try's gap (and a tsumego's status), shown, noted in the journal and recorded once (FSRS; a yose position isn't kept). */
  const grade = (k: string, item: Exercise, gap: number, more: Partial<Run> = {}) => {
    setRun(r => r && r.k === k ? { ...r, gap, ...more } : r)
    const v = item.kind === 'ld' ? ldVerdict(!!more.ok, gap) : verdictOf(item, gap)
    journal(item.kind === 'ld' ? 'tsumego' : item.kind === 'yose' ? 'yose' : 'exercise', v === 'found', item.kind === 'yose' ? undefined : k)
    if (item.kind !== 'yose') setStore(s => s.readOnly ? s : { ...s, p: record(s.p, k, review(s.p.cards[k], RATING[v], Date.now())) })
  }
  // a tsumego: KataGo answers the try with its best line (PLIES moves, replayed), then the chain's ownership says alive or dead
  useEffect(() => {
    if (!open || !run || !x || x.kind !== 'ld' || !run.tried || run.gap !== null || run.error) return
    const { k, tried } = run, chain = lineOf(x.chain!) as Vertex[], owner = positionOf(x).board.get(chain[0]) as Sign
    let live = true
    setThinking(true)
    ask(after(x, [tried])).then(async a => {
      const line = a.pv.slice(0, PLIES), end = await ask(after(x, [tried, ...line]), { ...REPLY, includeOwnership: true })
      if (!live) return
      const ok = !!end.ownership && reached(x.sign === owner, mean(end.ownership, chain, owner, x.size))
      grade(k, x, gapOf(x, tried, a.scoreLead)!, { ok, more: line, line: 'reply' })
    }).catch(e => live && setRun(r => r && { ...r, error: e })).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [open, x, run?.k, run?.tried, run?.gap, run?.error]) // eslint-disable-line react-hooks/exhaustive-deps
  // any other try but the better move and the game's mistake (graded in play) asks KataGo
  useEffect(() => {
    if (!open || !run || !x || x.kind === 'ld' || !run.tried || run.gap !== null || run.error) return
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

  // started at once: no flash of "nothing left"; the find-better deck picks up where it was left
  const toggle = () => { if (open) setOpen(false); else if (session.only === 'find' && !session.keys && run) { if (!blocked) setOpen(true) } else start(DECK) }
  const close = () => setOpen(false)
  const add = (game: Game, moments: Moment[], leads: (number | undefined)[], me: Sign | 0) => {
    const id = library.idOf(game), date = id ? library.get()?.find(e => e.id === id)?.date : undefined // when it was played, for the monthly letter
    setStore(s => s.readOnly ? s : { ...s, p: addReview(s.p, game, moments, leads, me, Date.now(), date) })
  }
  /** New cards from elsewhere (the tsumego miner), known keys untouched. */
  const addItems = (xs: Record<string, Exercise>) =>
    setStore(s => s.readOnly ? s : { ...s, p: { ...s.p, items: { ...Object.fromEntries(Object.entries(xs).filter(([k]) => !(k in Object.prototype))), ...s.p.items } } })
  const has = (k: string) => Object.hasOwn(store.p.items, k)
  const now = Date.now(), all = counts(store.p, now)
  const today = deckStep(store.p.cards, all.due + all.fresh, now, hand) // the daily ritual's first step: a hand of `hand` cards, tsumego included
  const none = {
    open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, info: null as { size: number; komi: number } | null, add, addItems, has, today,
    counts: counts(store.p, now, 'find'), tsCounts: counts(store.p, now, 'ld'), games: store.p.games,
    start, work, tsumego: () => start({ ...DECK, only: 'ld' }),
  }
  if (!open) return none

  // ---------- the board, the note and its links ----------
  const ld = x?.kind === 'ld', yose = x?.kind === 'yose'
  const better = x ? lineOf(x.better) : [], punish = x ? lineOf(x.punish) : []
  const played = x && !ld && !yose ? lineOf(x.played)[0] : null // the game's mistake, marked ×
  const chain = ld ? lineOf(x.chain!) as Vertex[] : []
  const live = ld && positionOf(x).board.get(chain[0]) === x.sign // the side to play saves its group (else kills)
  const replaying = !!run?.more.length
  const board: Partial<Board3DState> = !run || !x || !pos ? { interactive: false, marks: null } : {
    signMap: pos.board.signMap, last: pos.lastMove?.vertex ?? null, toPlay: pos.toPlay, ownership: null, counting: null, focus: null, frame: ld ? boxOf(chain, x.size) : null,
    captures: { black: pos.board.getCaptures(1), white: pos.board.getCaptures(-1) }, interactive: !run.tried,
    marks: played && !replaying && (!run.tried || !pos.board.get(played)) ? [{ v: played, label: '×', tone: 'mistake' } as Mark] : [],
  }
  const play = (v: Vertex | null) => {
    if (!run || !x || run.tried || !v) return false
    const r = positionOf(x).play(v)
    if (r !== 'ok') { setSay(pick(t.refused, r) ?? null); return false }
    setRun({ ...run, tried: v, shown: [v] }); setSay(null)
    const known = ld ? null : gapOf(x, v, null) // a tsumego always waits for KataGo's reply
    if (known !== null) grade(run.k, x, known)
    return true
  }
  const show = (line: 'better' | 'punish') => {
    if (!run || !x) return
    setRun({ ...run, line, shown: [], more: line === 'better' ? better : [played ?? null, ...punish] }); setSay(null)
  }
  const verdict = run?.gap != null && x ? ld ? ldVerdict(!!run.ok, run.gap) : verdictOf(x, run.gap) : null
  const graded = ld ? verdict === 'found' ? t.tsFound(live) : verdict === 'short' ? t.tsShort(live, run!.gap!) : t.tsMissed(live)
    : yose ? verdict === 'found' ? t.yoFound : verdict === 'short' ? t.yoShort(run!.gap!) : t.yoMissed(run?.gap ?? 0)
    : verdict === 'found' ? t.exFound : verdict === 'short' ? t.exShort(run!.gap!) : t.exMissed(run?.gap ?? 0)
  const nothing = session.error ? t.answerFailed(failureText(session.error)) : session.gen !== null ? t.yoSearching(session.gen, YOSE_N)
    : session.yose ? Object.keys(session.yose).length ? t.workDone : t.yoNone
    : session.keys ? session.empty ? t.workEmpty : t.workDone
    : session.only === 'ld' ? Object.values(store.p.items).some(x => x.kind === 'ld') ? t.tsDone : t.tsEmpty
    : Object.keys(store.p.items).length ? t.exDone : t.exEmpty
  const note = say ?? (!run || !x ? !canAnalyze ? t.exNeedsNet : nothing
    : run.error ? t.answerFailed(failureText(run.error))
    : !run.tried ? ld ? t.tsAsk(x.sign, live) : yose ? t.yoAsk(x.sign) : t.exAsk(x.sign, played ? gtp(played, x.size) : null, x.loss)
    : run.gap === null || run.line === 'reply' && replaying ? t.exChecking
    : run.line === 'better' && better[0] ? ld ? t.tsAnswer(x.sign, gtp(better[0], x.size), live) : yose ? t.yoAnswer(x.sign, gtp(better[0], x.size)) : t.betterLine(x.sign, gtp(better[0], x.size), x.loss)
    : run.line === 'punish' && punish[0] ? t.punishLine(-x.sign, gtp(punish[0], x.size), x.sign, x.loss)
    : graded)
  const nextLink: Link = ['next', ld ? t.tsNext : t.exNext, () => next()]
  const links: Link[] = !run || !x ? session.then && !session.keys?.length && session.gen === null ? [session.then] : []
    : run.error ? [['retry', t.retry, () => setRun({ ...run, error: null })], nextLink] : run.gap === null || replaying && run.line === 'reply' ? [] : [
      ...run.line === 'better' && (replaying || ld || yose) || ld && verdict === 'found' ? [] : [['better', ld ? t.tsSeeAnswer : t.seeBetter, () => show('better')] as Link],
      ...!punish.length || run.line === 'punish' && replaying ? [] : [['punish', t.seePunishment, () => show('punish')] as Link],
      nextLink,
    ]

  // ---------- the panel ----------
  const resetAll = async () => { if (await askFirst(t.exResetAsk, t.exReset)) { setStore({ p: emptyDeck(), readOnly: false }); setRun(null); setSay(null) } }
  const c = counts(store.p, now, session.only)
  const title = session.yose ? t.yoTitle : session.keys ? t.workTitle : session.only === 'ld' ? t.tsTitle : t.exercises
  const body = (
    <section className="rv ex" aria-label={title}>
      <div className="lab"><span>{title}</span><span /></div>
      {!canAnalyze ? <p className="estimate">{t.exNeedsNet}</p> : <>
        {session.gen !== null && <p className="quiet" aria-live="polite">{t.yoSearching(session.gen, YOSE_N)}<progress value={session.gen} max={YOSE_N} /></p>}
        {!session.keys && autoLine && <p className="quiet" aria-live="polite">{autoLine}</p>}
        {session.keys ? x && <p className="quiet" aria-live="polite">{t.workLeft(session.keys.length + 1)}</p>
          : (store.readOnly || c.due + c.fresh + c.later > 0) && (
            <p className="quiet" aria-live="polite">{store.readOnly ? t.exReadOnly : t.exProgress(c.due, c.fresh, c.later)}</p>
          )}
        {x ? <p className="quiet">{t.exFrom(x.vs, mv(x))}</p> : session.gen === null && <p className="estimate">{nothing}</p>}
      </>}
      {!session.keys && <p className="quiet"><button className="link" onClick={resetAll} disabled={store.readOnly}>{t.exReset}</button></p>}
    </section>
  )
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  // the game's own keys are muted while the trainer has the board (Space still presses a focused button)
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {},
  }
  return { ...none, play, board, note, links, body, acts, keys, info: x ? { size: x.size, komi: x.komi } : null } // the meta line reads the exercise's board and komi
}
