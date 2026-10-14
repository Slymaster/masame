import { describe, expect, it } from 'vitest'
import { RANKS } from './bot'
import { Game, type Sign, type Vertex } from './game'
import type { Analysis } from './katago'
import { rankLabel } from './ogs'
import { anchored, BAD, BAND, CAP, curve, FLOOR, KEY, loadRanks, localRank, MIN_GAME, MIN_PHASE, peak, phaseRanks, PROFILES, rankName, readRank, reading,
  saveRanks, WINDOW, withReading, type Read } from './rank'
import { loadSgf } from './sgf'

const XS = PROFILES.map(p => RANKS.indexOf(p))
const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('peak', () => {
  it('is the best profile at an edge', () => {
    expect(XS).toEqual([0, 5, 10, 15, 20, 24])
    expect(peak(XS, [-1, -2, -3, -4, -5, -6])).toBe(0)
    expect(peak(XS, [-6, -5, -4, -3, -2, -1])).toBe(24)
  })
  it('refines with the parabola, symmetric neighbours giving the profile itself', () => {
    expect(peak(XS, [-9, -5, -1, -5, -9, -12])).toBe(10)
    expect(peak(XS, [-9, -4, -1, -2, -9, -12])).toBeGreaterThan(10)
    expect(peak(XS, [-9, -2, -1, -4, -9, -12])).toBeLessThan(10)
    // uneven spacing (20 → 24): the vertex of the true parabola l = −(x − 21)²
    expect(peak(XS, XS.map(x => -((x - 21) ** 2)))).toBeCloseTo(21)
  })
  it('stays between the neighbours', () => {
    const p = peak(XS, [-100, -100, -1, -1.0001, -100, -100])
    expect(p).toBeGreaterThanOrEqual(10); expect(p).toBeLessThanOrEqual(15)
    expect(peak(XS, [-1, -1, -1, -1, -1, -1])).toBe(0) // flat: the first
  })
})

describe('reading', () => {
  const at = (j: number) => PROFILES.map((_, i) => (i === j ? 0.5 : 0.05))
  it('is null under MIN_GAME moves; reads the likeliest profile; phases need MIN_PHASE moves', () => {
    expect(reading([], [])).toBeNull()
    expect(reading(Array(MIN_GAME - 1).fill(at(1)), Array(MIN_GAME - 1).fill(1))).toBeNull()
    const probs = [...Array(MIN_PHASE).fill(at(1)), ...Array(MIN_PHASE - 1).fill(at(4))]
    const r = reading(probs, [...Array(MIN_PHASE).fill(0), ...Array(MIN_PHASE - 1).fill(2)])!
    expect(r.n).toBe(2 * MIN_PHASE - 1)
    expect(r.phases[0]).toBe(5) // its neighbours tie: the profile itself
    expect(r.phases.slice(1)).toEqual([null, null])
  })
  it('floors a move’s probability: one unthinkable move does not decide', () => {
    const probs = [...Array(MIN_GAME).fill(at(2)), PROFILES.map((_, i) => (i === 2 ? 0 : 0.5))]
    expect(Math.round(reading(probs, Array(MIN_GAME + 1).fill(1))!.all)).toBe(10)
    expect(FLOOR).toBeGreaterThan(0)
  })
})

/** n alternating moves from Black on a 9×9 along the rows. */
const game = (n: number) => Game.fromRecord({ size: 9 },
  Array.from({ length: n }, (_, i) => ({ sign: (i % 2 ? -1 : 1) as Sign, vertex: [i % 9, Math.floor(i / 9)] as Vertex })))

/** The played move's probability is highest under `best`; counts queries and those in flight. */
function fakeEngine(g: Game, best: string | ((at: number) => string), opts: { failAt?: number; noPolicyAt?: number } = {}) {
  let inFlight = 0, max = 0
  const calls: { at: number; q: { overrideSettings: { humanSLProfile: string } } }[] = []
  const ask = async (b: Game, q: object): Promise<Analysis> => {
    const id = calls.push({ at: b.moves.length, q: q as never })
    inFlight++; max = Math.max(max, inFlight)
    await new Promise(r => setTimeout(r, 1))
    inFlight--
    if (id === opts.failAt) throw new Error('engine_stopped')
    const p = (q as { overrideSettings: { humanSLProfile: string } }).overrideSettings.humanSLProfile, v = g.moves[b.moves.length].vertex!
    const n = g.info.size, policy = Array(n * n + 1).fill(0.001), at = b.moves.length
    policy[v[1] * n + v[0]] = p === `rank_${typeof best === 'string' ? best : best(at)}` ? 0.6 : 0.1
    return { winrate: 0.5, scoreLead: 0, topMove: '', pv: [], ownership: null, moves: [], humanPolicy: b.moves.length === opts.noPolicyAt ? null : policy }
  }
  return { ask, calls, max: () => max }
}

describe('readRank', () => {
  const g = game(60) // 30 moves a side: MIN_GAME
  it('asks each of the side’s moves with each profile, two at a time, and reads the favoured profile', async () => {
    const e = fakeEngine(g, '5k')
    const r = await readRank(g, -1, new Map(), e.ask, () => true)
    expect(e.max()).toBe(2)
    expect(e.calls.length).toBe(30 * PROFILES.length)
    expect(new Set(e.calls.map(c => c.at))).toEqual(new Set(Array.from({ length: 30 }, (_, i) => 2 * i + 1)))
    expect(e.calls[0].q).toEqual({ maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: 'rank_20k', ignorePreRootHistory: false } })
    expect([r!.all, r!.n]).toEqual([15, 30])
    expect(r!.phases).toEqual([null, null, null]) // 9×9: 5, 12 and 13 of White's moves by phase, all under MIN_PHASE
  })
  it('splits moves by phase on real move numbers', async () => {
    const big = Game.fromRecord({ size: 19 }, Array.from({ length: 200 }, (_, i) => ({ sign: (i % 2 ? -1 : 1) as Sign, vertex: [i % 19, Math.floor(i / 19)] as Vertex })))
    const e = fakeEngine(big, at => (at < 50 ? '20k' : at < 150 ? '1d' : '5d')) // moves 1–50, 51–150, then the endgame
    const r = await readRank(big, 1, new Map(), e.ask, () => true)
    expect(r!.phases).toEqual([0, 19.5, 24]) // 1d's neighbours tie: the vertex is halfway between 5k and 5d
    expect(r!.n).toBe(100)
  })
  it('skips passes, pseudo-moves and moves without a human policy', async () => {
    const s = loadSgf('(;SZ[9];B[aa];W[ba];B[ca];C[x];W[];B[ea];W[fa])')
    const e = fakeEngine(s, '10k', { noPolicyAt: 6 }), cache = new Map<string, number>()
    const r = await readRank(s, -1, cache, (b, q) => (s.moves[b.moves.length].vertex ? e.ask(b, q) : Promise.reject(new Error('pass asked'))), () => true)
    expect(new Set(e.calls.map(c => c.at))).toEqual(new Set([1, 6])) // W[ba]; W[fa] (index 6 after the pseudo-move); not the pass
    expect(PROFILES.every(p => Number.isNaN(cache.get(`6|${p}`)) && cache.get(`1|${p}`)! > 0)).toBe(true) // no human policy: skipped
    expect(r).toBeNull() // one move read: under MIN_GAME
  })
  it('resumes from the cache, and returns null when interrupted', async () => {
    const cache = new Map<string, number>()
    let k = 0
    const e = fakeEngine(g, '10k')
    expect(await readRank(g, 1, cache, e.ask, () => k++ < 20)).toBeNull()
    const known = cache.size
    expect(known).toBeGreaterThan(0)
    const e2 = fakeEngine(g, '10k')
    expect((await readRank(g, 1, cache, e2.ask, () => true))!.all).toBe(10)
    expect(e2.calls.length).toBe(30 * PROFILES.length - known)
  })
  it('throws on an engine error once nothing is in flight', async () => {
    const e = fakeEngine(g, '10k', { failAt: 3 })
    await expect(readRank(g, 1, new Map(), e.ask, () => true)).rejects.toThrow('engine_stopped')
    expect(e.calls.length).toBeLessThan(6)
  })
})

const read = (k: string, all: number, n = 10, t = 0): Read => ({ k, t, all, n, phases: [all, null, all + 1] })

describe('local rank', () => {
  it('weights the last WINDOW readings by moves', () => {
    expect(localRank([])).toBeNull()
    expect(localRank([read('a', 4, 10), read('b', 10, 30)])).toBe(8.5)
    const games = [read('old', 28, 1000), ...Array.from({ length: WINDOW }, (_, i) => read(`g${i}`, 6))]
    expect(localRank(games)).toBe(6)
    expect(localRank(games, 1)).toBe(28)
    expect(phaseRanks([read('a', 4), read('b', 8)])).toEqual([6, null, 7])
  })
  it('draws on OGS’s scale, the label naming the rounded rank', () => {
    const c = curve([read('a', 7.4, 10, 1), read('b', 7.8, 10, 2)])
    expect(c.map(p => p.t)).toEqual([1, 2])
    expect(rankLabel(c[0].rank)).toBe(rankName(7.4))
    expect(rankLabel(c[1].rank)).toBe(rankName(7.6))
    expect([rankName(7.4), rankName(7.6), rankName(-1), rankName(40)]).toEqual(['13k', '12k', '20k', '9d'])
  })
  it('keeps the AI level within BAND of it', () => {
    expect(BAND).toBe(2)
    expect([anchored(10, 13.4), anchored(20, 13.4), anchored(12, 13.6)]).toEqual([11, 15, 12])
    expect([anchored(5, 0.2), anchored(28, 28)]).toEqual([2, 28])
  })
})

describe('stored readings', () => {
  const r = { all: 7, phases: [6, 7, null], n: 40 }
  it('keeps one per record, newest last, CAP at most', () => {
    let p = withReading({ v: 1, games: [] }, 'a', r, 1)
    p = withReading(p, 'b', r, 2); p = withReading(p, 'a', { ...r, all: 9 }, 3)
    expect(p.games.map(g => [g.k, g.t, g.all])).toEqual([['b', 2, 7], ['a', 3, 9]])
    for (let i = 0; i < CAP + 5; i++) p = withReading(p, `k${i}`, r, i)
    expect(p.games.length).toBe(CAP)
    expect(p.games[0].k).toBe('k5')
  })
  it('loads what is sound entry by entry, keeps the raw text aside, and never overwrites a newer version', () => {
    const ok = { k: 'x', t: 1, ...r }
    const st = mem({ [KEY]: JSON.stringify({ v: 1, games: [ok, { ...ok, n: 0 }, { ...ok, phases: [1, 2] }, null, { ...ok, all: 'x' }, ok] }) })
    expect(loadRanks(st)).toEqual({ p: { v: 1, games: [ok, ok] }, readOnly: false })
    expect(st.m.has(BAD)).toBe(true)
    expect(loadRanks(mem({ [KEY]: 'nope' })).p.games).toEqual([])
    expect(loadRanks(mem()).p.games).toEqual([])
    const newer = mem({ [KEY]: JSON.stringify({ v: 2, games: [] }) }), s = loadRanks(newer)
    expect(s.readOnly).toBe(true)
    saveRanks({ ...s, p: { v: 1, games: [ok] } }, newer)
    expect(newer.m.get(KEY)).toContain('"v":2')
    const out = mem()
    saveRanks({ p: { v: 1, games: [ok] }, readOnly: false }, out)
    expect(loadRanks(out).p.games).toEqual([ok])
  })
})
