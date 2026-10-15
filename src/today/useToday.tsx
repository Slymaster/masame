// The daily ritual: its steps, its streak and one button to the next step, shown at the top of Apprendre › Aujourd'hui.
// It never takes the card: its button closes the sheet and opens the step (App's `start`).
import { useEffect, useState } from 'react'
import { t } from '../i18n'
import { note as journal } from '../journal'
import { today } from '../joseki/store'
import { allDone, complete, gameStep, load, save, streakOf, type Step } from './ritual'

type Link = [string, string, () => void]
const NAMES = ['exercises', 'joseki', 'game'] as const

export function useToday({ blocked, decks, canPlay, rank, start, onDone }: {
  blocked: boolean // an ongoing OGS game or a review: no step can start
  decks: [Step, Step] // exercises (null without an analysis net), joseki ({ done: false, left: null } while loading)
  canPlay: boolean | null; rank: string // the AI can play (null: not known yet); the ritual game's rank (your level)
  start: [() => void, () => void, () => void] // opens each step: the exercises, a joseki line, the 9×9
  onDone: (streak: number) => void // the ritual just got done today
}) {
  const [r, setR] = useState(load)
  const [flow, setFlow] = useState(false) // the player is going through the steps: the trainers offer the next one
  const now = Date.now(), steps: Step[] = [...decks, canPlay === null ? { done: false, left: null } : canPlay ? gameStep(r, now) : null]
  const done = allDone(steps), finished = done || r.last === today(now)
  useEffect(() => {
    const n = complete(r, Date.now())
    if (!done || n === r) return
    setR(n); save(n); setFlow(false); journal('ritual', true); onDone(n.streak) // the monthly letter counts the days
  }, [done]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A ritual game reached a result. */
  const played = () => { const n = { ...r, game: today() }; setR(n); save(n) }
  const go = () => { const i = steps.findIndex(s => s && !s.done); if (i >= 0 && !blocked) { setFlow(true); start[i]() } }
  /** The open trainer's link to the next step, once its own step (or its part of it: `mine`) is done. */
  const onward = (i: number, mine = steps[i]?.done): Link[] => flow && !finished && mine ? [['ritual', t.ritualGo, go]] : []
  const waiting = !blocked && !finished && steps.some(s => s && !s.done) // the Learn door's dot

  const streak = streakOf(r, now), avail = steps.some(Boolean)
  const state = (s: Step, i: number) => !s ? t.tdOff[NAMES[i] as 'exercises' | 'game'] : s.done ? t.tdDoneStep : s.left === null ? t.tdLoading : t.tdLeft(s.left)
  const label = flow || steps.some(s => s?.done) ? t.tdContinue : t.tdStart
  const cur = steps.findIndex(s => s && !s.done)
  const body = (
    <section className="td" aria-label={t.today}>
      <div className="lab"><span>{t.today}</span><span>{streak ? `${t.tdStreakLab} · ${t.tdStreak(streak)}` : ''}</span></div>
      <p className="say">{finished ? t.tdAllDone : avail ? t.tdIntro : t.tdNothing}</p>
      <ol className="td-rail">
        {steps.map((s, i) => (
          <li key={i} className={!s ? 'off' : s.done ? 'done' : i === cur ? 'cur' : ''} aria-current={i === cur ? 'step' : undefined}>
            <i aria-hidden="true">{s?.done ? '✓' : i + 1}</i>
            <b>{t.tdSteps[NAMES[i]]}</b><span>{i === 2 && s && !s.done ? t.tdGameAt(rank) : state(s, i)}</span>
          </li>
        ))}
      </ol>
      {!finished && avail && <div className="opts"><button className="btn accent" onClick={go} disabled={blocked}>{label}</button></div>}
    </section>
  )
  return { waiting, body, played, onward }
}
