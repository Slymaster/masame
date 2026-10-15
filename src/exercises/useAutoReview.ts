// The automatic review's runner: the oldest queued game is read whenever the engine is free (App says when), one
// run at a time behind App's other readings; an interrupted run resumes from its cached leads.
import { useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import type { Game, Sign } from '../game'
import type { Analysis } from '../katago'
import type { Reading } from '../rank'
import type { Moment } from '../review'
import { enqueue, leadsOf, loadQueue, ranksOf, newAuto, nextJob, RETRY_MS, reviewed, runJob, saveQueue, type Auto, type Job } from './autoReview'
import { recordKey } from './deck'

export function useAutoReview({ free, ask, scanRun, add, done, human }: {
  free: boolean // nothing else needs the engine, nor the player's attention
  ask: (g: Game, q: object) => Promise<Analysis>
  scanRun: RefObject<Promise<unknown>> // App's chain of readings: 2 queries in flight at most
  add: (g: Game, ms: Moment[], leads: (number | undefined)[], side: Sign) => void
  done: (k: string, ms: Moment[], r: Reading | null, j: { id?: string; leads: (number | undefined)[] }) => void // a background review complete, with the player's rank when read
  human: boolean // the human network is there: the player's rank is read too
}) {
  const a = useRef<Auto>(null as unknown as Auto)
  a.current ??= newAuto(loadQueue())
  const [ver, bump] = useReducer((x: number) => x + 1, 0)
  const [pct, setPct] = useState<number | null>(null)
  const current = useRef<Job | null>(null)
  const freeRef = useRef(free), latest = useRef({ ask, add, done, human })
  freeRef.current = free; latest.current = { ask, add, done, human }
  const changed = () => { saveQueue(a.current.queue); bump() }

  useEffect(() => {
    const s = a.current, j = nextJob(s, Date.now())
    if (!free || current.current || !j) return
    current.current = j; setPct(null)
    const live = () => freeRef.current && current.current === j
    let got: Reading | null = null
    const run = scanRun.current.catch(() => {}).then(() => runJob(s, j, (g, q) => latest.current.ask(g, q), live,
      p => current.current === j && setPct(p), (...x) => latest.current.add(...x), latest.current.human ? r => { got = r } : undefined))
    scanRun.current = run
    run.then(r => {
      if (current.current === j) current.current = null
      if (r === 'failed') setTimeout(bump, RETRY_MS)
      else if (r !== 'paused') { setPct(null); latest.current.done(j.k, r, got, { id: j.id, leads: leadsOf(s, j.k) }) } // before changed() saves the queue without the job
      changed()
    }, e => { console.error('automatic review', e); if (current.current === j) current.current = null }) // never leaves the runner stuck
  }, [free, ver, scanRun])

  return {
    /** A finished game whose player is `side` (0: unknown, ignored), kept in the library under `id`. */
    enqueue: (game: Game, side: Sign | 0, id?: string) => { const q = enqueue(a.current, game, side, Date.now(), id); if (q !== a.current.queue) { a.current.queue = q; changed() } },
    /** The scan leads of this record, shared by the foreground review. */
    leadsOf: (game: Game) => leadsOf(a.current, recordKey(game)),
    /** The rank probabilities of this record, shared by the foreground review. */
    ranksOf: (game: Game) => ranksOf(a.current, recordKey(game)),
    /** The player reviewed this record: its job goes. */
    reviewed: (game: Game) => {
      const k = recordKey(game)
      if (current.current?.k === k) { current.current = null; setPct(null) }
      reviewed(a.current, k); changed()
    },
    /** Games waiting, and the current one's progress while it is being read. */
    pending: a.current.queue.length, pct: current.current ? pct : null,
  }
}
