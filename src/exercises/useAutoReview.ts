// The automatic review's runner: the oldest queued game is read whenever the engine is free (App says when), one
// run at a time behind App's other readings; an interrupted run resumes from its cached positions.
import { useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import type { Facts, Pos } from '../classify'
import type { Game, Sign } from '../game'
import { inTauri, type Analysis } from '../katago'
import type { Reading } from '../rank'
import type { Moment } from '../review'
import * as library from '../library'
import { enqueue, posOf, loadQueue, ranksOf, newAuto, nextJob, RETRY_MS, reviewed, runJob, saveQueue, type Auto, type Job, type JobFlags } from './autoReview'
import { reviewKey } from './deck'

export function useAutoReview({ free, ask, scanRun, add, done, human, myRank }: {
  free: boolean // nothing else needs the engine, nor the player's attention
  ask: (g: Game, q: object) => Promise<Analysis>
  scanRun: RefObject<Promise<unknown>> // App's chain of readings: 2 queries in flight at most
  add: (g: Game, ms: Moment[], leads: (number | undefined)[], side: Sign) => void
  done: (k: string, ms: Moment[], r: Reading | null, j: Job & { pos: (Pos | undefined)[]; facts: Facts[] }) => void // a background review complete, with the player's rank when read
  human: boolean // the human network is there: the player's rank is read too
  myRank?: string // the player's rank: the level of a side whose SGF rank is unknown
}) {
  const a = useRef<Auto>(null as unknown as Auto)
  a.current ??= newAuto(loadQueue())
  const [ver, bump] = useReducer((x: number) => x + 1, 0)
  const [pct, setPct] = useState<number | null>(null)
  const [restored, setRestored] = useState(!inTauri())
  const current = useRef<Job | null>(null)
  const freeRef = useRef(free), latest = useRef({ ask, add, done, human, myRank })
  freeRef.current = free; latest.current = { ask, add, done, human, myRank }
  const changed = () => { saveQueue(a.current.queue); bump() }

  useEffect(() => {
    if (!inTauri()) return
    // A process may have died after the native delete but before localStorage was flushed.
    // Never resume an orphaned persisted analysis job.
    let ready = false
    const restore = () => {
      const xs = library.get()
      if (!xs || ready) return
      ready = true
      a.current.queue = a.current.queue.filter(j => !j.id || xs.some(e => e.id === j.id))
      changed(); setRestored(true)
    }
    // A later successful retry (for example opening My games) also releases the runner.
    const off = library.subscribe(restore)
    library.load().then(restore, e => console.error('automatic review library', e))
    return off
  }, [])

  useEffect(() => library.onDelete((id, phase) => {
    if (phase !== 'start') return
    a.current.queue = a.current.queue.filter(j => j.id !== id)
    if (current.current?.id === id) { current.current = null; setPct(null) }
    changed()
  }), [])

  useEffect(() => {
    const s = a.current, j = nextJob(s, Date.now())
    if (!restored || !free || current.current || !j) return
    current.current = j; setPct(null)
    const valid = library.guard(j.id)
    const live = () => freeRef.current && current.current === j && valid()
    let got: Reading | null = null
    const run = scanRun.current.catch(() => {}).then(() => runJob(s, j, (g, q) => latest.current.ask(g, q), live,
      p => current.current === j && setPct(p), (...x) => latest.current.add(...x), latest.current.human ? r => { got = r } : undefined, latest.current.myRank))
    scanRun.current = run
    run.then(r => {
      if (current.current !== j || !valid()) return
      if (current.current === j) current.current = null
      if (r === 'failed') setTimeout(bump, RETRY_MS)
      else if (r !== 'paused') { setPct(null); latest.current.done(j.k, r.moments, got, { ...j, pos: posOf(s, j.k), facts: r.facts }) } // before changed() saves the queue without the job
      changed()
    }, e => { console.error('automatic review', e); if (current.current === j) current.current = null }) // never leaves the runner stuck
  }, [free, restored, ver, scanRun])

  return {
    /** A finished game whose player is `side` (0: unknown, ignored), kept in the library under `flags.id`. */
    enqueue: (game: Game, side: Sign | 0, flags?: JobFlags) => { if (!library.active(game) || flags?.id && !library.writable(flags.id)) return; const q = enqueue(a.current, game, side, Date.now(), flags); if (q !== a.current.queue) { a.current.queue = q; changed() } },
    /** The scan positions of this record, shared by the foreground review. */
    posOf: (game: Game) => posOf(a.current, reviewKey(game)),
    /** The rank probabilities of this record, shared by the foreground review. */
    ranksOf: (game: Game) => ranksOf(a.current, reviewKey(game)),
    /** The player reviewed this record: its job goes. */
    reviewed: (game: Game, id?: string) => {
      const k = reviewKey(game)
      if (current.current?.k === k && (!id || !current.current.id || current.current.id === id)) { current.current = null; setPct(null) }
      reviewed(a.current, k, id); changed()
    },
    /** Games waiting, and the current one's progress while it is being read. */
    pending: a.current.queue.length, pct: current.current ? pct : null,
  }
}
