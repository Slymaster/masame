// "Rejouer de mémoire": the shown game's board empties (handicap and setup stones kept) and you place its moves again,
// in order, for both sides; the AI doesn't play. It borrows the board and the card; Esc stops and keeps the partial score.
import { useEffect, useState, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Game, Sign, Vertex } from '../game'
import { t } from '../i18n'
import { Icon } from '../Icon'
import { note as journal } from '../journal'
import * as library from '../library'
import type { Msg } from '../i18n'
import { Timeline } from '../Timeline'
import { attempt, begin, better, expected, over, replayed, total, type Run, type Try } from './memory'

const HINT_MS = 900 // the right move lit, before it is placed (a help)
type Link = [string, string, () => void]
/** rec: a copy of the shown line; keep: the game's library id (kept first when it isn't yet); last: the last try and the
 * move it was on; hint: the right move lit after a second miss, until it is placed. */
interface Session { rec: Game; keep: () => Promise<string>; run: Run; last: { k: Try; at: number } | null; hint: Vertex | null; saved: boolean }

export function useMemory({ view, open, setOpen, blocked, onEnd }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void; pass?(c: Sign): void; shake?(v: Vertex, c: Sign): void } | null>
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  onEnd: (m: Msg) => void // the score, said in the game's caption once the takeover closes
}) {
  const [s, setS] = useState<Session | null>(null)
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The best run is written in the game's library entry (a file enters the library here). */
  const store = (x: Session) => {
    const r = x.run, n = total(x.rec), score = { recalled: r.recalled, total: n, helps: r.helps }
    x.keep().then(id => {
      journal('memory', over(x.rec, r), id)
      if (better(library.get()?.find(e => e.id === id)?.memory, score)) return library.patch(id, { memory: score })
    }).catch(console.error) // outside the app, or the disk refused: the score stays on screen only
  }
  /** Starts on a game (a copy of its shown line), from the empty board. */
  const start = (g: Game, keep: () => Promise<string>) => {
    if (blocked || !g.moves.some(m => !m.setup)) return
    const rec = g.branch(g.moves.length)
    setS({ rec, keep, run: begin(rec), last: null, hint: null, saved: false })
    setOpen(true)
  }
  const close = () => {
    if (s && !s.saved && replayed(s.run)) { // Esc: the partial score is kept and said
      store(s)
      const r = s.run, n = total(s.rec)
      onEnd(d => d.memSaid(r.recalled, n, r.helps))
    } else if (s?.saved) { const r = s.run, n = total(s.rec); onEnd(d => d.memSaid(r.recalled, n, r.helps)) } // a finished run: its score stays said
    setS(null); setOpen(false)
  }
  // the second miss: the right move lights up, then is placed
  useEffect(() => {
    if (!open || !s?.hint) return
    const id = setTimeout(() => {
      const v = s.hint!, sign = s.rec.moves[s.last!.at].sign
      view.current?.drop(v, sign)
      setS(x => x && { ...x, hint: null })
    }, HINT_MS)
    return () => clearTimeout(id)
  }, [open, s?.hint]) // eslint-disable-line react-hooks/exhaustive-deps
  // the record done: the score is kept once
  useEffect(() => {
    if (open && s && !s.saved && !s.hint && over(s.rec, s.run)) { store(s); setS({ ...s, saved: true }) }
  }, [open, s]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => { if (open) close() }
  const none = { open, toggle, close, start, play: (_: Vertex | null) => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null }
  if (!open || !s) return none

  const { rec, run } = s, n = total(rec), done = over(rec, run) && !s.hint
  // the board as placed so far; while a help is lit, the board before it, the move ringed
  const at = s.hint ? s.last!.at : run.k, pos = rec.boards[at], last = rec.moves[at - 1]
  const toPlay = rec.moves[run.k]?.sign ?? rec.toPlay
  rec.goTo(at) // the Timeline follows
  const board: Partial<Board3DState> = {
    signMap: pos.signMap, last: last && !last.setup ? last.vertex : null, toPlay, interactive: !s.hint && !done,
    ownership: null, counting: null, focus: null, captures: { black: pos.getCaptures(1), white: pos.getCaptures(-1) },
    marks: s.hint ? [{ v: s.hint, label: '', tone: 'best' }] : null,
  }
  const play = (v: Vertex | null) => {
    if (s.hint || done || v && pos.get(v)) return false // an occupied point is no try
    const [k, r] = attempt(rec, run, v)
    const sign = rec.moves[run.k].sign
    if (k === 'wrong' || k === 'help') { if (v) view.current?.shake?.(v, sign); else view.current?.pass?.(sign) }
    else if (k === 'right' && !v) view.current?.pass?.(sign)
    const hint = k === 'help' ? expected(rec, run) ?? null : null
    setS({ ...s, run: r, last: { k, at: run.k }, hint })
    return k === 'right'
  }
  const moveNo = rec.moveNumber(run.k) + 1, tried = s.last && rec.moveNumber(s.last.at) + 1
  const note = done ? `${t.memDone(run.recalled, n, run.helps)}.`
    : s.last?.k === 'help' ? (rec.moves[s.last.at].vertex ? t.memHelp(tried!) : t.memHelpPass(tried!))
    : s.last?.k === 'wrong' ? t.memWrong(moveNo)
    : t.memAsk(moveNo, toPlay)
  const links: Link[] = done ? [['again', t.memAgain, () => setS({ ...s, run: begin(rec), last: null, hint: null, saved: false })]] : []
  const body = (
    <section className="rv mem" aria-label={t.memTitle}>
      <div className="lab"><span>{t.memTitle}</span><span /></div>
      <ul className="mem-figs" aria-label={t.memDone(run.recalled, n, run.helps)}>
        <li><b>{run.recalled}</b><span>{t.memFound}</span></li><li><b>{run.helps}</b><span>{t.memHelps}</span></li><li><b>{n - rec.moveNumber(run.k)}</b><span>{t.memLeft}</span></li>
      </ul>
      <Timeline g={rec} floor={0} go={() => {}} auto={false} toggleAuto={() => {}} live relocate={() => {}} />
      <p className="say">{t.memHelpText}</p>
    </section>
  )
  const acts = <>
    <button className="act" onClick={() => play(null)} disabled={!!s.hint || done} title="P"><Icon name="hand-stop" />{t.pass}</button>
    <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  </>
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => play(null),
  }
  return { ...none, play, board, note, links, body, acts, keys }
}
