import { describe, expect, it, vi } from 'vitest'
import { Game, type Sign, type Vertex } from '../game'
import type { Analysis } from '../katago'
import { loadSgf, saveSgf } from '../sgf'
import { CAP, eligible, enqueue, posOf, ranksOf, loadQueue, MAX_FAILS, newAuto, nextJob, QUEUE_KEY, RETRY_MS, reviewed, runJob, saveQueue, type Job } from './autoReview'
import { addReview, emptyDeck, recordKey, reviewKey } from './deck'
import { PROFILES } from '../rank'

// the classifier is tested on its own: here no move needs a deeper search, and no rank is known
vi.mock('../classify', async orig => ({ judgeable: (await orig<typeof import('../classify')>()).judgeable, parseRank: () => null, deepCandidates: () => [], sacrificed: () => 0 }))
// no opening book unless a test loads one
const bk = vi.hoisted(() => ({ load: () => Promise.reject(new Error('no book')) as Promise<unknown> }))
vi.mock('../book', () => ({ loadBook: () => bk.load(), bookMoves: (g: { moves: unknown[] }) => g.moves.map((_, i) => i < 2) }))

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
/** n alternating moves from Black on a 9×9, starting at point `from` (distinct games for distinct `from`). */
const game = (n: number, size = 9, from = 0) => Game.fromRecord({ size },
  Array.from({ length: n }, (_, i) => ({ sign: (i % 2 ? -1 : 1) as Sign, vertex: [(from + i) % size, Math.floor((from + i) / size)] as Vertex })))

describe('the queue', () => {
  it('takes games whose player is known, on readable boards, with 10 real moves or more', () => {
    expect(eligible(game(10), 1)).toBe(true)
    expect(eligible(game(10), 0)).toBe(false)
    expect(eligible(game(9), -1)).toBe(false)
    expect(eligible(game(30, 21), 1)).toBe(false)
    expect(eligible(loadSgf('(;SZ[9];B[aa];W[ba];B[ca];C[x];W[da];B[ea];W[fa];B[ga];W[ha];B[ia])'), 1)).toBe(false) // 9 real moves
  })
  it('keeps one job per record, skips reviewed ones, and drops the oldest past CAP', () => {
    const a = newAuto([])
    a.queue = enqueue(a, game(12), 1, 1)
    expect(enqueue(a, game(12), -1, 2)).toBe(a.queue) // the same record, even from another Game
    expect(enqueue(a, game(5), 1, 2)).toBe(a.queue)
    reviewed(a, a.queue[0].k)
    expect([a.queue, enqueue(a, game(12), 1, 3)]).toEqual([[], []])
    for (let i = 0; i < CAP + 2; i++) a.queue = enqueue(a, game(12, 9, i + 1), 1, i)
    expect(a.queue.length).toBe(CAP)
    expect(a.queue.map(j => j.t)).toEqual(Array.from({ length: CAP }, (_, i) => i + 2))
    expect(nextJob(a, 0)?.t).toBe(2) // the oldest first
  })
  it('keeps one job per library entry: the same moves under two ids are two jobs, each dropped on its own', () => {
    const a = newAuto([])
    a.queue = enqueue(a, game(12), 1, 1, { id: 'file-a' })
    a.queue = enqueue(a, game(12), 1, 2, { id: 'ogs-1' })
    expect(a.queue.map(j => j.id)).toEqual(['file-a', 'ogs-1'])
    expect(enqueue(a, game(12), 1, 3, { id: 'ogs-1' })).toBe(a.queue)
    reviewed(a, a.queue[0].k, 'file-a')
    expect(a.queue.map(j => j.id)).toEqual(['ogs-1'])
    expect(enqueue(a, game(12), 1, 4, { id: 'file-a' })).toBe(a.queue) // reviewed this session
  })
  it('snapshots the record: moves added later are not in the job', () => {
    const a = newAuto([]), g = game(12)
    a.queue = enqueue(a, g, 1, 0)
    g.play([8, 8])
    expect(loadSgf(a.queue[0].sgf).moves.length).toBe(12)
    expect(a.queue[0].k).not.toBe(recordKey(g))
  })
  it('uses the key of the deck’s reviewed games', () => {
    const g = game(12)
    expect(addReview(emptyDeck(), g, [], [], 1, 0).games[0].k).toBe(recordKey(g))
  })
  it('keys a job by the review\'s layout: a comment node elsewhere is another review (its positions are per node)', () => {
    const moves = Array.from({ length: 12 }, (_, i) => `;${i % 2 ? 'W' : 'B'}[${'abcdefghi'[i % 9]}${'abcdefghi'[Math.floor(i / 9) + 2]}]`)
    const at = (k: number) => loadSgf(`(;SZ[9]${[...moves.slice(0, k), ';C[x]', ...moves.slice(k)].join('')})`)
    const [a, b] = [at(3), at(6)], ka = enqueue(newAuto([]), a, 1, 0)[0].k, kb = enqueue(newAuto([]), b, 1, 0)[0].k
    expect(recordKey(a)).toBe(recordKey(b))
    expect([ka, kb]).toEqual([reviewKey(a), reviewKey(b)])
    expect(ka).not.toBe(kb)
  })
  it('loads what is sound, entry by entry, and survives garbage', () => {
    const ok: Job = { k: 'x', sgf: saveSgf(game(10)), side: -1, t: 5 }
    const st = mem({ [QUEUE_KEY]: JSON.stringify([ok, { ...ok, side: 0 }, { ...ok, sgf: '(' }, null, { ...ok, t: 'x' }, ok]) })
    expect(loadQueue(st)).toEqual([ok, ok])
    expect(loadQueue(mem({ [QUEUE_KEY]: '{"a":1}' }))).toEqual([])
    expect(loadQueue(mem({ [QUEUE_KEY]: 'nope' }))).toEqual([])
    expect(loadQueue(mem())).toEqual([])
    const out = mem()
    saveQueue([ok], out)
    expect(loadQueue(out)).toEqual([ok])
  })
  it('carries the library id; queues saved before the library still load', () => {
    const a = newAuto([])
    a.queue = enqueue(a, game(12), 1, 0, { id: 'ai-abc' })
    expect(a.queue[0].id).toBe('ai-abc')
    expect(enqueue(newAuto([]), game(12), 1, 0)[0]).not.toHaveProperty('id')
    const old: Job = { k: 'x', sgf: saveSgf(game(10)), side: 1, t: 5 }, kept = { ...old, k: 'y', id: 'ogs-7' }
    expect(loadQueue(mem({ [QUEUE_KEY]: JSON.stringify([old, kept, { ...old, id: 7 }]) }))).toEqual([old, kept])
  })
})

describe('a background run', () => {
  // Black's 5th move (index 4) loses 6 points
  const leadAt = (at: number) => (at > 4 ? -6 : 0)
  const fake = (asked: number[], fail = () => false) => async (g: Game, q: object) => {
    asked.push(g.moves.length)
    if (fail()) throw new Error('engine down')
    void q
    // the human policy favours the played move under rank_5k
    const p = (q as { overrideSettings?: { humanSLProfile?: string } }).overrideSettings?.humanSLProfile
    const humanPolicy = p && Array.from({ length: 82 }, () => (p === 'rank_5k' ? 0.5 : 0.1))
    return { scoreLead: leadAt(g.moves.length), pv: [[8, 8], [7, 7]], ownership: [0], humanPolicy, moves: [] } as unknown as Analysis
  }
  const setup = (n = 12) => {
    const a = newAuto([]); a.queue = enqueue(a, game(n), 1, 0)
    const added: unknown[][] = []
    return { a, j: a.queue[0], added, add: (...x: unknown[]) => void added.push(x) }
  }

  it('adds the moments once and drops the job when complete', async () => {
    const { a, j, added, add } = setup(), asked: number[] = []
    const ms = await runJob(a, j, fake(asked), () => true, () => {}, add)
    expect(typeof ms === 'object' && ms.moments.map(m => m.at)).toEqual([4])
    expect(added.length).toBe(1)
    expect(added[0][3]).toBe(1)
    expect([a.queue, a.reviewed.has(j.k), enqueue(a, game(12), 1, 9)]).toEqual([[], true, []])
  })
  it('gives readGame the opening book like the foreground, none when it fails to load', async () => {
    const run = async () => { const { a, j, add } = setup(), ms = await runJob(a, j, fake([]), () => true, () => {}, add); return typeof ms === 'object' ? ms.facts.map(f => f.book) : ms }
    expect((await run()).slice(0, 3)).toEqual([false, false, false])
    bk.load = () => Promise.resolve({})
    try { expect((await run()).slice(0, 3)).toEqual([true, true, false]) } finally { bk.load = () => Promise.reject(new Error('no book')) }
  })
  it('keeps an interrupted job and resumes from the cached positions', async () => {
    const { a, j, added, add } = setup(), asked: number[] = []
    let n = 0
    expect(await runJob(a, j, fake(asked), () => n++ < 6, () => {}, add)).toBe('paused')
    expect([added.length, a.queue.length]).toEqual([0, 1])
    const before = new Set(asked), known = posOf(a, j.k).filter(x => x !== undefined).length
    expect([known > 0, known < 13, known]).toEqual([true, true, before.size])
    asked.length = 0
    expect(typeof await runJob(a, j, fake(asked), () => true, () => {}, add)).toBe('object')
    const scans = asked.slice(0, 13 - known)
    expect([new Set(scans).size, scans.some(x => before.has(x))]).toEqual([13 - known, false]) // only the positions not read before
    expect(added.length).toBe(1)
  })
  it('keeps a failed job, waits RETRY_MS, and leaves it for the next launch after MAX_FAILS', async () => {
    const { a, j, added, add } = setup()
    for (let i = 1; i <= MAX_FAILS; i++) {
      const t0 = Date.now()
      expect(await runJob(a, j, fake([], () => true), () => true, () => {}, add)).toBe('failed')
      expect(nextJob(a, t0)).toBeUndefined()
      expect(nextJob(a, a.wait)).toBe(i < MAX_FAILS ? j : undefined)
      expect(a.wait).toBeGreaterThanOrEqual(t0 + RETRY_MS)
    }
    expect([a.queue, added.length]).toEqual([[j], 0])
  })
  it('reads the rank after the moments, reports it, then drops the job', async () => {
    const { a, j, added, add } = setup(60), asked: number[] = [], got: unknown[] = [] // Black's 30 moves: MIN_GAME
    const ms = await runJob(a, j, fake(asked), () => true, () => {}, add, r => got.push(r))
    expect(typeof ms === 'object').toBe(true)
    expect(got).toEqual([{ all: 15, n: 30, phases: [null, null, null] }]) // all read as 5k; on 9×9 each phase has under MIN_PHASE
    expect(asked.length).toBe(61 + 2 + 30 * PROFILES.length) // the scan, one deep pair, the rank
    expect([added.length, a.queue, a.ranks.size, a.read.size]).toEqual([1, [], 0, 0])
  })
  it('keeps a job interrupted while ranking, and resumes without reading the moments again', async () => {
    const { a, j, added, add } = setup(60), asked: number[] = [], got: unknown[] = []
    expect(await runJob(a, j, fake(asked), () => asked.length < 61 + 2 + 20, () => {}, add, r => got.push(r))).toBe('paused') // 20 rank queries in
    expect([added.length, got.length, a.queue.length]).toEqual([1, 0, 1])
    const known = ranksOf(a, j.k).size
    expect(known).toBeGreaterThan(0)
    asked.length = 0
    expect(typeof await runJob(a, j, fake(asked), () => true, () => {}, add, r => got.push(r))).toBe('object')
    expect([asked.length, added.length, got.length, a.queue.length]).toEqual([30 * PROFILES.length - known, 1, 1, 0])
  })
  it('reads no rank for a mentor game, still adding its moments; the flags survive a relaunch', async () => {
    const a = newAuto([]); a.queue = enqueue(a, game(60), 1, 0, { noRank: true, noAdjust: true })
    const j = a.queue[0], asked: number[] = [], got: unknown[] = [], added: unknown[] = []
    expect([j.noRank, j.noAdjust]).toEqual([true, true])
    const st = mem(); saveQueue(a.queue, st)
    expect(loadQueue(st)[0]).toEqual(j)
    const ms = await runJob(a, j, fake(asked), () => true, () => {}, (...x) => void added.push(x), r => got.push(r))
    expect([typeof ms === 'object', added.length]).toEqual([true, 1])
    expect(got).toEqual([null]) // reported without a reading: nothing to store
    expect(asked.length).toBe(61 + 2) // the scan and the deep pair, no rank query
  })
})
