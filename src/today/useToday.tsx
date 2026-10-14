// The Today panel: the daily ritual's steps, its streak and one button to the next step. It doesn't borrow the board:
// the game stays shown underneath, not playable while the panel is open (App's play() and bot turn defer to it).
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { Icon } from '../Icon'
import { today } from '../joseki/store'
import { allDone, complete, gameStep, load, save, streakOf, type Step } from './ritual'

type Link = [string, string, () => void]
const NAMES = ['exercises', 'joseki', 'game'] as const

export function useToday({ open, setOpen, blocked, decks, canPlay, rank, start, onDone }: {
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  decks: [Step, Step] // exercises (null without an analysis net), joseki ({ done: false, left: null } while loading)
  canPlay: boolean; rank: string // the AI can play; the ritual game's rank (your level)
  start: [() => void, () => void, () => void] // opens each step: the exercises, a joseki line, the 9×9
  onDone: (streak: number) => void // the ritual just got done today
}) {
  const [r, setR] = useState(load)
  const [flow, setFlow] = useState(false) // the player is going through the steps: the trainers offer the next one
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps
  const now = Date.now(), steps: Step[] = [...decks, canPlay ? gameStep(r, now) : null]
  const done = allDone(steps), finished = done || r.last === today(now)
  useEffect(() => {
    const n = complete(r, Date.now())
    if (!done || n === r) return
    setR(n); save(n); setFlow(false); onDone(n.streak)
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A ritual game reached a result. */
  const played = () => { const n = { ...r, game: today() }; setR(n); save(n) }
  const go = () => { const i = steps.findIndex(s => s && !s.done); if (i >= 0) { setFlow(true); start[i]() } }
  /** The open trainer's link to the next step, once its own step is done. */
  const onward = (i: number): Link[] => flow && !finished && steps[i]?.done ? [['ritual', t.ritualGo, go]] : []
  const toggle = () => { if (!blocked) setOpen(!open) }
  const close = () => setOpen(false)
  const waiting = !open && !blocked && !finished && steps.some(s => s && !s.done)
  const button = (
    <button className="icon" aria-pressed={open} onClick={toggle} disabled={blocked} aria-label={t.today} title={`${t.today} (D)`}>
      <Icon name="calendar" />{waiting && <i className="dot" />}
    </button>
  )
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, button, played, onward }
  if (!open) return none

  const streak = streakOf(r, now), avail = steps.some(Boolean)
  const state = (s: Step, i: number) => !s ? t.tdOff[NAMES[i] as 'exercises' | 'game'] : s.done ? t.tdDoneStep : s.left === null ? t.tdLoading : t.tdLeft(s.left)
  const label = flow || steps.some(s => s?.done) ? t.tdContinue : t.tdStart
  const note = finished ? t.ritualDone(streak) : avail ? t.tdIntro : t.tdNothing
  const cur = steps.findIndex(s => s && !s.done)
  const body = (
    <section className="rv td" aria-label={t.today}>
      <div className="lab"><span>{t.today}</span><span>{streak ? `${t.tdStreakLab} · ${t.tdStreak(streak)}` : ''}</span></div>
      <ol className="td-rail">
        {steps.map((s, i) => (
          <li key={i} className={!s ? 'off' : s.done ? 'done' : i === cur ? 'cur' : ''} aria-current={i === cur ? 'step' : undefined}>
            <i aria-hidden="true">{s?.done ? '✓' : i + 1}</i>
            <b>{t.tdSteps[NAMES[i]]}</b><span>{i === 2 && s && !s.done ? t.tdGameAt(rank) : state(s, i)}</span>
          </li>
        ))}
      </ol>
      {finished ? <p className="estimate">{t.tdAllDone}</p> : avail && <div className="opts"><button className="btn accent" onClick={go}>{label}</button></div>}
    </section>
  )
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  // the game's own keys are muted while the panel is open (Space still presses a focused button)
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {},
  }
  return { ...none, board: { interactive: false }, note, body, acts, keys }
}
