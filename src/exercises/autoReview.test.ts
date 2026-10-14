import { describe, expect, it } from 'vitest'
import { Game, type Sign, type Vertex } from '../game'
import type { Analysis } from '../katago'
import { loadSgf, saveSgf } from '../sgf'
import { CAP, eligible, enqueue, leadsOf, loadQueue, MAX_FAILS, newAuto, nextJob, QUEUE_KEY, RETRY_MS, reviewed, runJob, saveQueue, type Job } from './autoReview'
import { addReview, emptyDeck, recordKey } from './deck'

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
})

describe('a background run', () => {
  // Black's 5th move (index 4) loses 6 points
  const leadAt = (at: number) => (at > 4 ? -6 : 0)
  const fake = (asked: number[], fail = () => false) => async (g: Game, q: object) => {
    asked.push(g.moves.length)
    if (fail()) throw new Error('engine down')
    void q
    return { scoreLead: leadAt(g.moves.length), pv: [[8, 8], [7, 7]], ownership: null } as unknown as Analysis
  }
  const setup = () => {
    const a = newAuto([]); a.queue = enqueue(a, game(12), 1, 0)
    const added: unknown[][] = []
    return { a, j: a.queue[0], added, add: (...x: unknown[]) => void added.push(x) }
  }

  it('adds the moments once and drops the job when complete', async () => {
    const { a, j, added, add } = setup(), asked: number[] = []
    const ms = await runJob(a, j, fake(asked), () => true, () => {}, add)
    expect(Array.isArray(ms) && ms.map(m => m.at)).toEqual([4])
    expect(added.length).toBe(1)
    expect(added[0][3]).toBe(1)
    expect([a.queue, a.reviewed.has(j.k), enqueue(a, game(12), 1, 9)]).toEqual([[], true, []])
  })
  it('keeps an interrupted job and resumes from the cached leads', async () => {
    const { a, j, added, add } = setup(), asked: number[] = []
    let n = 0
    expect(await runJob(a, j, fake(asked), () => n++ < 6, () => {}, add)).toBe('paused')
    expect([added.length, a.queue.length]).toEqual([0, 1])
    const before = new Set(asked), known = leadsOf(a, j.k).filter(x => x !== undefined).length
    expect([known > 0, known < 13, known]).toEqual([true, true, before.size])
    asked.length = 0
    expect(Array.isArray(await runJob(a, j, fake(asked), () => true, () => {}, add))).toBe(true)
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
})
