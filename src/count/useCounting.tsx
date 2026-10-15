// "Compter": a position from one of your reviewed games, on the board; you say who leads and by how much, and KataGo's
// lead, read by the review, answers. Five positions a session (two in the ritual's hand). It borrows the board and the card.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Game } from '../game'
import { failureText, t } from '../i18n'
import { Icon } from '../Icon'
import { note as journal } from '../journal'
import { inTauri } from '../katago'
import * as library from '../library'
import { Seg } from '../Seg'
import { loadSgf } from '../sgf'
import { added, countable, countedToday, guessOf, load, pickGame, pickMove, recent, save, SESSION, truthOf, verdictOf, type Counting } from './counting'

type Link = [string, string, () => void]
/** A position: the game and its id, the moves played (at), KataGo's lead (Black's view); then the answer and the light. */
interface Run { id: string; game: Game; at: number; lead: number; guess: number | null; own: number[] | null; lighting: boolean; error: unknown }

/** One of the least-counted reviewed games and a position in it; null when none has a readable position. */
async function draw(avoid: Set<string>): Promise<Run | null> {
  let xs = (await library.load()).filter(countable)
  while (xs.length) {
    const e = pickGame(xs, Math.random)!
    xs = xs.filter(x => x !== e)
    try {
      const side = await library.sidecar<library.ReviewSidecar>(e.id, 'review')
      if (!side?.leads) continue
      const game = loadSgf(await library.read(e.id)), leads = side.leads.map((x, i) => (avoid.has(`${e.id}:${i}`) ? null : x))
      const at = pickMove(leads, game.moves.length, Math.random)
      if (at !== null) return { id: e.id, game, at, lead: side.leads[at]!, guess: null, own: null, lighting: false, error: null }
    } catch (err) { console.error('counting', e.id, err) } // an unreadable game: the next one
  }
  return null
}

export function useCounting({ open, setOpen, blocked, canAnalyze, light, setThinking }: {
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  canAnalyze: boolean // "See the light" needs an analysis network; counting itself doesn't
  light: (g: Game) => Promise<number[] | null> // the position's ownership (App queues the query)
  setThinking: (on: boolean) => void
}) {
  const [store, setStore] = useState<Counting>(load)
  const entries = useSyncExternalStore(library.subscribe, library.get)
  useEffect(() => { if (inTauri()) library.load().catch(() => {}) }, [])
  const [run, setRun] = useState<Run | null | 'none' | 'spent' | 'loading'>(null) // spent: no new position left mid-session
  const [done, setDone] = useState<{ n: number; right: number; seen: Set<string> }>(() => ({ n: 0, right: 0, seen: new Set() }))
  const [who, setWho] = useState<1 | -1 | 0 | null>(null), [by, setBy] = useState(5)

  const next = (fresh = false) => {
    const d = fresh ? { n: 0, right: 0, seen: new Set<string>() } : done
    if (fresh) setDone(d)
    setRun('loading'); setWho(null); setBy(5)
    draw(d.seen).then(r => setRun(r ?? (d.n ? 'spent' : 'none')), e => setRun({ id: '', game: null!, at: 0, lead: 0, guess: null, own: null, lighting: false, error: e }))
  }
  useEffect(() => { if (open && run === null) next(true) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) setRun(null) }, [open])

  const r = run && typeof run === 'object' && !run.error ? run : null
  const answer = () => {
    if (!r || who === null || r.guess !== null) return
    const guess = guessOf(who, by), err = Math.abs(guess - truthOf(r.lead)), now = Date.now()
    setRun({ ...r, guess })
    setStore(s => { const n = added(s, err, now); save(n); return n })
    setDone(d => ({ n: d.n + 1, right: d.right + +(verdictOf(err) === 'right'), seen: new Set(d.seen).add(`${r.id}:${r.at}`) }))
    journal('count', verdictOf(err) === 'right', r.id)
    const e = library.get()?.find(x => x.id === r.id)
    library.patch(r.id, { counted: (e?.counted ?? 0) + 1 }).catch(console.error)
  }
  // "See the light": the position's ownership, asked once
  useEffect(() => {
    if (!open || !r?.lighting) return
    let live = true
    setThinking(true)
    light(r.game.branch(r.at)).then(own => live && setRun(x => x && typeof x === 'object' ? { ...x, own, lighting: false } : x),
      error => live && setRun(x => x && typeof x === 'object' ? { ...x, lighting: false, error } : x)).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [open, r?.lighting]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => { if (!blocked) setOpen(!open) }
  const close = () => setOpen(false)
  const now = Date.now(), fig = recent(store)
  const available = !!entries?.some(countable)
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, info: null as { size: number; komi: number } | null,
    available, today: countedToday(store, now), median: fig.median, n: fig.n }
  if (!open) return none

  const pos = r?.game.boards[r.at], last = r?.game.moves[r.at - 1]
  const board: Partial<Board3DState> = !r || !pos ? { interactive: false, marks: null } : {
    signMap: pos.signMap, last: last && !last.setup ? last.vertex : null, toPlay: r.game.moves[r.at]?.sign ?? 1, interactive: false,
    ownership: r.own, counting: null, focus: null, marks: null, captures: { black: pos.getCaptures(1), white: pos.getCaptures(-1) },
  }
  const ended = done.n >= SESSION && r?.guess != null
  const err = r && r.guess !== null ? Math.abs(r.guess - truthOf(r.lead)) : null
  const failed = run && typeof run === 'object' && run.error
  const note = run === 'loading' ? t.countLoading : run === 'none' ? t.countNone : run === 'spent' ? `${t.countSpent} ${t.countSession(done.n, done.right)}`
    : failed ? (r ? t.countLightFailed : t.countFailed)(failureText(run.error))
    : !r ? null
    : err === null ? t.countAsk(done.n + 1, SESSION, r.game.moveNumber(r.at))
    : [t.countVerdict(verdictOf(err), truthOf(r.lead)), ended && t.countSession(done.n, done.right)].filter(Boolean).join(' ')
  const links: Link[] = run === 'spent' ? [['again', t.countAgain, () => next(true)]]
    : failed ? [['retry', t.retry, () => r ? setRun({ ...r, error: null }) : next()]]
    : !r || err === null ? []
    : [...canAnalyze && !r.own && !r.lighting ? [['light', t.countLight, () => setRun({ ...r, lighting: true })] as Link] : [],
      ended ? ['again', t.countAgain, () => next(true)] : ['next', t.countNext, () => next()]]

  const asked = !!r && r.guess === null
  const body = (
    <section className="rv ct" aria-label={t.countDeck}>
      <div className="lab"><span>{t.countDeck}</span><span>{r ? `${Math.min(done.n + +asked, SESSION)} / ${SESSION}` : ''}</span></div>
      {r && <>
        {/* the answer as it stands, large; then who, then how much */}
        <p className="state" aria-live="polite">{who === null ? t.countWho : who === 0 ? t.countEven : `${who === 1 ? t.black : t.white} +${by}`}</p>
        <Seg<number> label={t.countWho} value={who ?? NaN} options={[[1, t.black], [-1, t.white], [0, t.countEven]]} set={v => setWho(v as 1 | -1 | 0)} disabled={!asked} />
        <div className="row stepper big">
          <span className="say">{t.countBy}</span>
          <span className="step">
            <button onClick={() => setBy(b => Math.max(1, b - 1))} disabled={!asked || who === 0 || by <= 1} aria-label={`${t.countBy} −1`}>−</button>
            <output aria-live="polite">{who === 0 ? '–' : by}</output>
            <button onClick={() => setBy(b => Math.min(40, b + 1))} disabled={!asked || who === 0 || by >= 40} aria-label={`${t.countBy} +1`}>+</button>
          </span>
        </div>
        {asked ? <div className="opts"><button className="btn accent" onClick={answer} disabled={who === null}>{t.countAnswer}</button></div>
          : <p className="say">{t.countYours(r.guess!)}</p>}
      </>}
      <p className="say">{fig.median === null ? t.countNoneYet : t.countMedian(fig.median, fig.n)}</p>
    </section>
  )
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {},
  }
  return { ...none, board, note, links, body, acts, keys, info: r?.game.info ?? null } // the meta line reads the position's board and komi
}

