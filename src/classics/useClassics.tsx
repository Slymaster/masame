// Les Classiques: guess the masters' moves, one at a time. The list of the shipped Edo games is a sheet; a game (or any
// game shown from the library) then borrows the board and the card: you choose your side and the start, the other side
// plays by itself, and after each of your moves the master's appears and KataGo grades yours against it in points.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Mark } from '../board/BoardView'
import type { Game, Sign, Vertex } from '../game'
import { failureText, lang, pick, t } from '../i18n'
import { Icon } from '../Icon'
import { note as journal } from '../journal'
import { gtp, type Analysis } from '../katago'
import { idOf, keep } from '../library'
import { rankQuery } from '../rank'
import { Seg } from '../Seg'
import { loadSgf, saveSgf } from '../sgf'
import { Sheet } from '../Sheet'
import {
  average, costOf, humanTop, keepBest, load, loadClassic, loadIndex, NONE, same, scored, startOf, STARTS, turnsOf, type Classic, type Score,
} from './classics'

const REPLAY_MS = 650, FOUND_MS = 900
// a quick read of each position (the master's move, then yours), like the exercises' answers
export const GRADE = { maxVisits: 100, overrideSettings: { maxTime: 1 } }
type Link = [string, string, () => void]
interface Guess { tried: Vertex; found: boolean; cost: number | null; human?: Vertex | null; error?: unknown }
interface Run {
  n: number // this run, so a late answer from an earlier one is dropped
  key: string | null // where its best score is kept: the classic's id, or the library id (null until known)
  classic: Classic | null; orig: Game | null; me: Sign | 0 // a classic, or a game shown from the library
  game: Game; black: string; white: string
  side: Sign; from: number; phase: 'setup' | 'play' | 'end'
  at: number; turns: Set<number>; score: Score; guess: Guess | null; found: boolean // found: the last guess was the master's move
}

/** "11 September 1846", "December 1835" or "1815": what the date says, in the UI's language. */
export function dateText(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  if (!m) return String(y)
  const date = new Date(Date.UTC(y, m - 1, day || 1))
  const text = new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', { year: 'numeric', month: 'long', ...day && { day: 'numeric' }, timeZone: 'UTC' }).format(date)
  return lang === 'fr' && day === 1 ? text.replace(/^1(?=\s)/, '1er') : text // « 1er décembre 1851 »
}
/** A game worth guessing: real moves to guess, on a board KataGo reads. */
export const canGuess = (g: Game) => g.info.size <= 19 && g.moves.filter(m => !m.setup && m.vertex).length >= 10

export function useClassics({ view, open, setOpen, blocked, canAnalyze, ask, setThinking, rank }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void } | null>
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  canAnalyze: boolean // an analysis network is active (KataGo grades each guess)
  ask: (g: Game, query: Record<string, unknown>) => Promise<Analysis> // App serialises the queries
  setThinking: (on: boolean) => void
  rank: string // the player's level: the human policy's profile for "a player of your rank"
}) {
  const [list, setList] = useState<{ opener: HTMLElement | null } | null>(null)
  const [classics, setClassics] = useState<Classic[] | string | null>(null) // string: why they didn't load
  const [store, setStore] = useState(load)
  const [run, setRun] = useState<Run | null>(null)
  const [say, setSay] = useState<string | null>(null) // a one-off note (a refused move, a game that didn't load)
  const runs = useRef(0)
  const masters = useRef(new Map<string, Promise<[number, Vertex | null]>>()) // per run and move: the master's lead, the human pick

  useEffect(() => { if (blocked) { close(); setList(null) } }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  // a few kilobytes, read once: the deck row counts the games, the sheet lists them
  useEffect(() => { if (!Array.isArray(classics)) loadIndex().then(setClassics, e => setClassics(failureText(e))) }, [list]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Keeps the run's score (when it beats the best) — at its end, or when stopped. */
  const keepScore = (r: Run) => { if (r.key && r.score.total) setStore(keepBest(r.key, r.score)) }
  const close = () => { if (run?.phase === 'play') keepScore(run); setOpen(false) }
  useEffect(() => { if (!open) { setRun(r => (r?.phase === 'play' ? { ...r, phase: 'setup' } : r)); setSay(null) } }, [open])

  const setup = (game: Game, o: Pick<Run, 'key' | 'classic' | 'orig' | 'me' | 'black' | 'white'>) => {
    setRun({ ...o, n: ++runs.current, game, side: o.me || 1, from: 1, phase: 'setup', at: startOf(game, 1), turns: new Set(), score: NONE, guess: null, found: false })
    setSay(null); setList(null); setOpen(true)
  }
  const pickClassic = (c: Classic) => loadClassic(c).then(g => setup(g, { key: c.id, classic: c, orig: null, me: 0, black: c.black, white: c.white }),
    e => setSay(failureText(e)))
  /** The same mode on a game shown from the library (or an opened file, which enters the library when it starts). */
  const guess = (g: Game, me: Sign | 0) => setup(loadSgf(saveSgf(g)), {
    key: idOf(g) ?? null, classic: null, orig: g, me, black: g.info.playerBlack || t.color(1), white: g.info.playerWhite || t.color(-1),
  })
  const begin = () => {
    if (!run || !canAnalyze) return
    const n = ++runs.current, { game, side, from, orig } = run
    masters.current.clear()
    setRun({ ...run, n, phase: 'play', at: startOf(game, from), turns: new Set(turnsOf(game, side, from)), score: NONE, guess: null, found: false })
    setSay(null)
    // a file enters the library when it is guessed (keyed by its content: the same file finds the same entry)
    if (orig && !run.key) keep(orig, 'file', run.me).then(key => setRun(r => r && r.n === n ? { ...r, key } : r), () => {})
  }
  const openList = () => { if (!blocked) setList({ opener: document.activeElement as HTMLElement | null }) }
  const toggle = () => { if (open) close(); else openList() }

  const g = run?.game
  const mover = run && g && run.at < g.moves.length ? g.moves[run.at] : null
  const myTurn = !!run && run.phase === 'play' && run.turns.has(run.at)

  // the master's lead after his move and the human pick before it, asked as soon as the turn starts (cached per move)
  const master = (r: Run, at: number) => {
    const k = `${r.n}:${at}`
    let p = masters.current.get(k)
    if (!p) {
      p = Promise.all([
        ask(r.game.branch(at + 1), GRADE).then(a => a.scoreLead),
        ask(r.game.branch(at), rankQuery(rank)).then(a => humanTop(a.humanPolicy, r.game.info.size), () => null), // no human net: no line
      ])
      masters.current.set(k, p)
      p.catch(() => masters.current.delete(k)) // asked again on Try again
    }
    return p
  }
  useEffect(() => { if (open && run && myTurn && !run.guess) master(run, run.at).catch(() => {}) }, [open, run?.n, run?.at, myTurn]) // eslint-disable-line react-hooks/exhaustive-deps

  // the other side (and any pass or setup node) plays by itself; the end keeps the score
  useEffect(() => {
    if (!open || !run || !g || run.phase !== 'play' || run.guess) return
    if (run.at >= g.moves.length) { keepScore(run); setRun({ ...run, phase: 'end' }); return }
    if (myTurn) return
    const id = setTimeout(() => {
      const m = g.moves[run.at]
      if (m.vertex && !m.setup) view.current?.drop(m.vertex, m.sign)
      setRun({ ...run, at: run.at + 1 })
    }, REPLAY_MS)
    return () => clearTimeout(id)
  }, [open, run, g, myTurn, view]) // eslint-disable-line react-hooks/exhaustive-deps

  // a found move goes on by itself; another waits for "Next move" once graded
  useEffect(() => {
    if (!open || !run?.guess?.found) return
    const id = setTimeout(() => setRun(r => r && r.guess ? { ...r, at: r.at + 1, guess: null } : r), FOUND_MS)
    return () => clearTimeout(id)
  }, [open, run?.guess]) // eslint-disable-line react-hooks/exhaustive-deps

  // grading: Black's lead after the master's move and after yours, from the game's komi and Japanese rules
  useEffect(() => {
    const x = run?.guess
    if (!open || !run || !x || x.found || x.cost !== null || x.error) return
    let live = true
    const { n, at, game, side } = run
    setThinking(true)
    Promise.all([master(run, at), ask(game.branch(at, [x.tried]), GRADE)]).then(([[lead, human], a]) => {
      if (!live) return
      const cost = costOf(side, lead, a.scoreLead)
      journal('classic', false, run.key ?? undefined)
      setRun(r => r && r.n === n && r.guess === x ? { ...r, score: scored(r.score, false, cost), guess: { ...x, cost, human } } : r)
    }, e => live && setRun(r => r && r.guess === x ? { ...r, guess: { ...x, error: e } } : r)).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [open, run?.guess]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => setRun(r => r && r.guess ? { ...r, at: r.at + 1, guess: null, found: false,
    score: r.guess.cost === null ? scored(r.score, false, null) : r.score } : r) // skipped after an error: counted, not graded

  // ---------- the list (a sheet) ----------
  const bestOf = (k: string | null) => (k ? store.best[k] : undefined)
  const sheet = list && (
    <Sheet title={t.classics} onClose={() => setList(null)} opener={list.opener}>
      <section className="decks classics">
        <p className="say">{t.clIntro}</p>
        {say && <p className="say err">{say}</p>}
        {!Array.isArray(classics) ? <p className="say">{classics ?? t.clLoading}</p> : <ul>
          {classics.map(c => {
            const b = bestOf(c.id)
            return <li key={c.id}>
              <button className="deck-row" onClick={() => pickClassic(c)}>
                <span className="deck-top"><b>{c.title[lang]}</b><span className="deck-n">{b ? t.clBest(b.found, b.total) : t.clNew}</span></span>
                <span className="deck-phrase">{`${c.date.slice(0, 4)} · ${c.black} – ${c.white}`}</span>
              </button>
            </li>
          })}
        </ul>}
      </section>
    </Sheet>
  )
  const deckLine = Array.isArray(classics) ? t.clDeckCount(classics.filter(c => store.best[c.id]).length, classics.length) : undefined
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, sheet, openList, guess, deckLine, info: null as { size: number; komi: number } | null }
  if (!open || !run || !g) return none

  // ---------- the board ----------
  const x = run.guess, shownAt = x ? run.at + 1 : run.at, b = g.boards[shownAt], last = g.moves[shownAt - 1]
  const marks: Mark[] = x && !x.found ? [{ v: x.tried, label: '×', tone: 'mistake' },
    ...x.human && !same(x.human, x.tried) && !same(x.human, mover!.vertex) ? [{ v: x.human, label: '△', tone: 'ok' } as Mark] : []] : []
  const board: Partial<Board3DState> = {
    signMap: b.signMap, last: last && !last.setup ? last.vertex : null, toPlay: shownAt < g.moves.length ? g.moves[shownAt].sign : -(last?.sign ?? -1) as Sign,
    ownership: null, counting: null, focus: null, captures: { black: b.getCaptures(1), white: b.getCaptures(-1) },
    interactive: myTurn && !x, marks,
  }
  const play = (v: Vertex | null) => {
    if (!myTurn || run.guess || !v || !mover) return false
    const r = g.branch(run.at).play(v)
    if (r !== 'ok') { setSay(pick(t.refused, r) ?? null); return false }
    setSay(null)
    const found = same(v, mover.vertex)
    if (found) {
      journal('classic', true, run.key ?? undefined)
      setRun({ ...run, score: scored(run.score, true, 0), guess: { tried: v, found, cost: 0 }, found: true })
      return true // the view drops the stone: it is the master's
    }
    view.current?.drop(mover.vertex!, mover.sign)
    setRun({ ...run, guess: { tried: v, found, cost: null }, found: false })
    return false
  }

  // ---------- the caption and its links ----------
  const name = (s: Sign) => (s === 1 ? run.black : run.white), masterName = name(run.side)
  const moveNo = g.moveNumber(run.at) + 1, total = g.moveNumber(g.moves.length)
  // an average that rounds to 0 points says nothing: leave the sentence out
  const avg = run.score.others && Math.round(average(run.score) * 10) ? average(run.score) : null
  const note = say ?? (run.phase === 'setup' ? canAnalyze ? t.clYouPlay(name(run.side), run.side) : t.exNeedsNet
    : run.phase === 'end' ? t.clEnd(run.score.found, run.score.total, avg)
    : x?.error ? t.answerFailed(failureText(x.error))
    : x?.found ? t.clFound
    : x && x.cost === null ? t.clGrading(masterName)
    : x ? t.clCost(masterName, gtp(mover!.vertex!, g.info.size), x.cost!)
    : myTurn ? `${run.found ? `${t.clFound} ` : ''}${t.clAsk(moveNo, masterName)}`
    : t.clTheirs(name(-run.side as Sign)))
  const links: Link[] = run.phase === 'end' ? [['again', t.clAgain, () => setRun({ ...run, phase: 'setup', at: startOf(g, run.from) })],
    ...run.classic ? [['list', t.clOther, openList] as Link] : []]
    : x?.error ? [['retry', t.retry, () => setRun({ ...run, guess: { ...x, error: undefined } })], ['next', t.clNext, next]]
    : x && !x.found && x.cost !== null ? [['next', t.clNext, next]] : []

  // ---------- the panel ----------
  const best = bestOf(run.key ?? (run.orig && idOf(run.orig)) ?? null)
  const sides: [Sign, string][] = [[1, `${run.black} · ${t.black}`], [-1, `${run.white} · ${t.white}`]]
  const human = x?.human && mover?.vertex ? same(x.human, mover.vertex) ? t.clHumanSame(rank) : same(x.human, x.tried) ? t.clHumanYou(rank)
    : t.clHuman(rank, gtp(x.human, g.info.size)) : null
  const body = (
    <section className="rv cl" aria-label={t.classics}>
      <div className="lab"><span>{t.classics}</span><span>{run.phase === 'setup' ? run.classic ? dateText(run.classic.date) : '' : t.moveOf(Math.min(moveNo, total), total)}</span></div>
      <p className="state">{run.classic ? run.classic.title[lang] : `${run.black} – ${run.white}`}</p>
      {run.phase === 'setup' ? <>
        {run.classic && <p className="quiet">{run.classic.context[lang]}</p>}
        <div className="field"><span>{t.clSide}</span><Seg label={t.clSide} value={run.side} options={sides} set={side => setRun({ ...run, side })} /></div>
        <div className="field"><span>{t.clStart}</span>
          <Seg label={t.clStart} value={run.from} options={STARTS.map(s => [s, t.move(s)])} set={from => setRun({ ...run, from, at: startOf(g, from) })} />
        </div>
        {best && <p className="say">{t.clBestLine(best.found, best.total)}</p>}
        <div className="opts"><button className="btn accent" onClick={begin} disabled={!canAnalyze}>{t.clBegin}</button></div>
      </> : <>
        <p className="say" aria-live="polite">{run.score.total > 0 && t.clScore(run.score.found, run.score.total)}</p>
        {avg !== null && <p className="say">{t.clAverage(avg)}</p>}
        <div className="bar" role="progressbar" aria-label={t.clProgress} aria-valuenow={shownAt} aria-valuemin={0} aria-valuemax={g.moves.length}>
          <i style={{ width: `${shownAt / g.moves.length * 100}%` }} />
        </div>
        {human && <p className="say" aria-live="polite">{human}</p>}
      </>}
    </section>
  )
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  // the game's own keys are muted while the master's game has the board; → or Enter goes on after a graded move
  const onward = links.find(l => l[0] === 'next')?.[2]
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, home: () => {}, end: () => {}, p: () => {},
    arrowright: () => onward?.(), enter: onward,
  }
  return { ...none, play, board, note, links, body, acts, keys, info: g.info } // the meta line reads the master's board and komi
}
