// Automatic review: every finished game whose player is known is read in the background, and its key moments join
// the exercises. Pure: the queue (persisted like the deck) and one run of a job, which drives readGame through `ask`.
import type { Game, Sign } from '../game'
import type { Analysis } from '../katago'
import { readRank, type Reading } from '../rank'
import { readGame, reviewEnd, type Moment } from '../review'
import { loadSgf, saveSgf } from '../sgf'
import { recordKey } from './deck'

/** A game waiting for its review: the record as SGF (a snapshot: the shown game may grow variations), the player's side,
 * its library id (absent in queues saved before the library, or for a game not kept);
 * noRank: a lesson (the mentor), whose rank is not read; noAdjust: its rank never moves the levels (a Master of an era). */
export interface Job { k: string; sgf: string; side: Sign; t: number; id?: string; noRank?: true; noAdjust?: true }
export type JobFlags = Pick<Job, 'id' | 'noRank' | 'noAdjust'>
/** The session's memory: scan leads and rank probabilities per record key (shared with the foreground review), the moments
 * of jobs read but not yet ranked, failures per job, keys reviewed, and when the engine may be tried again after a failure (ms). */
export interface Auto { queue: Job[]; leads: Map<string, (number | undefined)[]>; ranks: Map<string, Map<string, number>>; read: Map<string, Moment[]>
  fails: Map<string, number>; reviewed: Set<string>; wait: number }
export const QUEUE_KEY = 'masame.reviewQueue', CAP = 20, MIN_MOVES = 10, MAX_FAILS = 3, RETRY_MS = 60_000
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Worth a review: the player's side known, a board KataGo reads, and enough real moves to learn from. */
export const eligible = (g: Game, side: Sign | 0) =>
  side !== 0 && g.info.size <= 19 && g.moves.slice(0, reviewEnd(g)).filter(m => !m.setup).length >= MIN_MOVES

/** The queue with this game added (oldest dropped past CAP), or unchanged when known, reviewed or not eligible. */
export function enqueue(a: Auto, game: Game, side: Sign | 0, now: number, flags: JobFlags = {}): Job[] {
  const sgf = saveSgf(game), g = loadSgf(sgf) // the record as the job will read it
  if (!eligible(g, side)) return a.queue
  const k = recordKey(g)
  // two library entries with the same moves (a file and its OGS copy) are two jobs: each gets its review written
  if (a.reviewed.has(flags.id ?? k) || a.queue.some(j => sameJob(j, k, flags.id))) return a.queue
  return [...a.queue, { k, sgf, side: side as Sign, t: now, ...flags.id && { id: flags.id }, ...flags.noRank && { noRank: true as const }, ...flags.noAdjust && { noAdjust: true as const } }].slice(-CAP)
}

/** The oldest job that has not failed too often this session; none for RETRY_MS after a failure. */
export const nextJob = (a: Auto, now: number) => (now < a.wait ? undefined : a.queue.find(j => (a.fails.get(j.k) ?? 0) < MAX_FAILS))
export const newAuto = (queue: Job[]): Auto => ({ queue, leads: new Map(), ranks: new Map(), read: new Map(), fails: new Map(), reviewed: new Set(), wait: 0 })

/** The job of record `k` kept under library id `id` (either unknown: the record alone decides). */
const sameJob = (j: Job, k: string, id?: string) => j.k === k && (!id || !j.id || j.id === id)
/** A record reviewed (in the background or by the player), kept under `id`: its job goes, and it is not queued again this
 * session; a job of the same moves under another id stays (and reuses the cached reading). */
export function reviewed(a: Auto, k: string, id?: string) {
  a.reviewed.add(id ?? k); a.queue = a.queue.filter(j => !sameJob(j, k, id))
  if (!a.queue.some(j => j.k === k)) { a.read.delete(k); a.ranks.delete(k) }
}

export function leadsOf(a: Auto, k: string) {
  let l = a.leads.get(k)
  if (!l) a.leads.set(k, l = [])
  return l
}
export function ranksOf(a: Auto, k: string) {
  let r = a.ranks.get(k)
  if (!r) a.ranks.set(k, r = new Map())
  return r
}

/**
 * Reads a job until `live` turns false: its moments (added once), then, given `rank`, the player's rank (reported); once
 * complete the job is dropped. 'paused' when interrupted (the job stays; the cached leads, moments and probabilities let it
 * resume), 'failed' on an engine error (counted toward MAX_FAILS).
 */
export async function runJob(a: Auto, j: Job, ask: (g: Game, q: object) => Promise<Analysis>, live: () => boolean,
  progress: (pct: number) => void, add: (g: Game, ms: Moment[], leads: (number | undefined)[], side: Sign) => void,
  rank?: (r: Reading | null) => void): Promise<Moment[] | 'paused' | 'failed'> {
  const game = loadSgf(j.sgf), leads = leadsOf(a, j.k)
  let ms = a.read.get(j.k), r: Reading | null = null
  try {
    if (!ms) {
      ms = await readGame(game, j.side, leads, (at, q) => ask(game.branch(at), q), live, progress)
      if (!live()) return 'paused'
      add(game, ms, leads, j.side); a.read.set(j.k, ms)
    }
    if (rank && !j.noRank) { r = await readRank(game, j.side, ranksOf(a, j.k), ask, live); if (!live()) return 'paused' }
  } catch (e) {
    console.error('automatic review', e)
    a.fails.set(j.k, (a.fails.get(j.k) ?? 0) + 1); a.wait = Date.now() + RETRY_MS
    return 'failed'
  }
  rank?.(r)
  reviewed(a, j.k, j.id)
  return ms
}

const isJob = (j: unknown): j is Job => !!j && typeof j === 'object' && typeof (j as Job).k === 'string' && typeof (j as Job).sgf === 'string'
  && ((j as Job).side === 1 || (j as Job).side === -1) && Number.isFinite((j as Job).t) && ['undefined', 'string'].includes(typeof (j as Job).id)

/** The stored queue; a bad entry (or a record that no longer loads) costs that entry only. */
export function loadQueue(st: Storage = localStorage): Job[] {
  try {
    const j = JSON.parse(st.getItem(QUEUE_KEY) ?? '[]')
    return Array.isArray(j) ? j.filter(x => { try { return isJob(x) && !!loadSgf(x.sgf) } catch { return false } }).slice(-CAP) : []
  } catch { return [] } // storage disabled or garbage: nothing waits
}

export function saveQueue(q: Job[], st: Storage = localStorage) {
  try { st.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* full or private mode: this session only */ }
}
