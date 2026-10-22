// The automatic review's runner: the oldest queued game is read whenever the engine is free (App says when), one
// run at a time behind App's other readings; an interrupted run resumes from its cached positions.
import { useEffect, useReducer, useRef, useState, type RefObject } from 'react'
import type { Facts, Pos } from '../classify'
import type { Game, Sign } from '../game'
import type { Analysis } from '../katago'
import type { Reading } from '../rank'
import type { Moment } from '../review'
import { enqueue, posOf, loadQueue, ranksOf, newAuto, nextJob, RETRY_MS, reviewed, runJob, saveQueue, type Auto, type Job, type JobFlags } from './autoReview'
import { recordKey } from './deck'

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
  const current = useRef<Job | null>(null)
  const freeRef = useRef(free), latest = useRef({ ask, add, done, human, myRank })
  freeRef.current = free; latest.current = { ask, add, done, human, myRank }
  const changed = () => { saveQueue(a.current.queue); bump() }

  useEffect(() => {
    const s = a.current, j = nextJob(s, Date.now())
    if (!free || current.current || !j) return
    current.current = j; setPct(null)
    const live = () => freeRef.current && current.current === j
    let got: Reading | null = null
    const run = scanRun.current.catch(() => {}).then(() => runJob(s, j, (g, q) => latest.current.ask(g, q), live,
      p => current.current === j && setPct(p), (...x) => latest.current.add(...x), latest.current.human ? r => { got = r } : undefined, latest.current.myRank))
    scanRun.current = run
    run.then(r => {
      if (current.current === j) current.current = null
      if (r === 'failed') setTimeout(bump, RETRY_MS)
      else if (r !== 'paused') { setPct(null); latest.current.done(j.k, r.moments, got, { ...j, pos: posOf(s, j.k), facts: r.facts }) } // before changed() saves the queue without the job
      changed()
    }, e => { console.error('automatic review', e); if (current.current === j) current.current = null }) // never leaves the runner stuck
  }, [free, ver, scanRun])

  return {
    /** A finished game whose player is `side` (0: unknown, ignored), kept in the library under `flags.id`. */
    enqueue: (game: Game, side: Sign | 0, flags?: JobFlags) => { const q = enqueue(a.current, game, side, Date.now(), flags); if (q !== a.current.queue) { a.current.queue = q; changed() } },
    /** The scan positions of this record, shared by the foreground review. */
    posOf: (game: Game) => posOf(a.current, recordKey(game)),
    /** The rank probabilities of this record, shared by the foreground review. */
    ranksOf: (game: Game) => ranksOf(a.current, recordKey(game)),
    /** The player reviewed this record: its job goes. */
    reviewed: (game: Game, id?: string) => {
      const k = recordKey(game)
      if (current.current?.k === k && (!id || !current.current.id || current.current.id === id)) { current.current = null; setPct(null) }
      reviewed(a.current, k, id); changed()
    },
    /** Games waiting, and the current one's progress while it is being read. */
    pending: a.current.queue.length, pct: current.current ? pct : null,
  }
}
