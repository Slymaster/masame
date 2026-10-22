import { beforeEach, describe, expect, it, vi } from 'vitest'
import { judgeable, type Levels, type Pos } from './classify'
import { Game, type Move, type Sign, type Vertex } from './game'
import type { Analysis } from './katago'
import { loadSgf } from './sgf'
import { DEEP, GREAT_DEEP, gradeTry, leadsOf, losses, lessonBoard, levelsOf, MAX_DEEP, MIN_LOSS, momentAt, ownershipOf, phaseLosses, phaseOf, pickMoments, readGame, reviewEnd, scanQuery, shift, toPos, verdict, type Moment } from './review'

// the classifier is tested on its own (classify.test.ts): here its two pipeline calls are stand-ins each test steers
const cl = vi.hoisted(() => ({ deep: (() => []) as (...a: unknown[]) => number[], sac: (() => 0) as (...a: unknown[]) => number }))
vi.mock('./classify', async orig => ({
  judgeable: (await orig<typeof import('./classify')>()).judgeable,
  deepCandidates: (...a: unknown[]) => cl.deep(...a).slice(0, a[5] as number), sacrificed: (...a: unknown[]) => cl.sac(...a),
  parseRank: (s?: string | null) => (s === '3k' ? -2 : s === '2d' ? 2 : null),
}))
beforeEach(() => { cl.deep = () => []; cl.sac = () => 0 })
const LV: Levels = { black: -4, white: -4 }

/** Alternating moves from Black; null = pass. */
const record = (vs: (Vertex | null)[]): Move[] => vs.map((vertex, i) => ({ sign: (i % 2 ? -1 : 1) as Sign, vertex }))
const row = (n: number): (Vertex | null)[] => Array.from({ length: n }, (_, i) => [i % 9, Math.floor(i / 9)] as Vertex)
const moment = (o: Partial<Moment> = {}): Moment =>
  ({ at: 4, sign: 1, loss: 6, lead: -3, punish: [[3, 3], [4, 4]], better: [[5, 5]], lost: null, kept: null, ...o })

describe('pickMoments', () => {
  const moves = record(row(8))
  it('measures the loss from the mover’s side and filters by colour', () => {
    // move 2 (Black) drops Black's lead by 5, move 5 (White) raises it by 3, move 6 (Black) loses 1
    const leads = [0, 0, 0, -5, -5, -5, -2, -3, -3]
    expect(pickMoments(leads, moves, 0, 19)).toEqual([2])
    expect(pickMoments(leads, moves, 0, 9)).toEqual([2]) // 5 is too close
    expect(pickMoments(leads, moves, 1, 3)).toEqual([2])
    expect(pickMoments(leads, moves, -1, 3)).toEqual([5])
    expect(pickMoments(leads, moves, 0, 3)).toEqual([2, 5])
  })
  it('sorts worst first, keeps picks apart, respects max', () => {
    const many = record(row(30))
    const leads = Array.from({ length: 31 }, () => 0)
    const drop = (i: number, by: number) => { for (let j = i + 1; j < leads.length; j++) leads[j] += many[i].sign * -by }
    drop(2, 3); drop(4, 8); drop(12, 5); drop(20, 2); drop(28, 4)
    expect(pickMoments(leads, many, 0, 9)).toEqual([4, 12, 28, 20]) // 2 is within 5 plies of 4
    expect(pickMoments(leads, many, 0, 19)).toEqual([4, 28]) // 10 plies apart on 19×19
    expect(pickMoments(leads, many, 0, 3, 2)).toEqual([4, 12])
  })
  it('skips missing leads and the game-ending pass, keeps a first pass', () => {
    const passes = record([[0, 0], null, null])
    expect(pickMoments([0, 0, 5, 9], passes, 0, 3)).toEqual([1]) // White's first pass gave Black 5
    expect(pickMoments([0, 0, 0, -9], passes, 0, 3)).toEqual([]) // Black's game-ending pass
    expect(pickMoments([0, undefined, 9, 9], passes, 0, 3)).toEqual([])
    expect(pickMoments([0, -MIN_LOSS + 0.1, 0, 0], passes, 0, 3)).toEqual([])
  })
  it('counts no move once both players have passed (a game resumed after a dispute)', () => {
    const g = loadSgf('(;SZ[9];B[cc];W[gg];B[];W[];B[ee];W[ff])'), leads = [0, 0, 0, 0, 10, 0, 0]
    expect(pickMoments(leads, g.moves, 0, 3)).toEqual([])
    expect(phaseLosses(leads, g.moves, 1, 9)).toEqual([0, 0, 0]) // Black's E5 would lose 10
    expect(phaseLosses(leads, g.moves, -1, 9)).toEqual([0, 0, 0]) // so would White's game-ending pass
    expect(pickMoments([0, 0, 0, 0, 0, 0, 9], g.moves, 0, 3)).toEqual([]) // nor the second resumed move, White's F4
    expect(phaseLosses([0, 0, 0, 0, 0, 0, 9], g.moves, -1, 9)).toEqual([0, 0, 0])
  })
  it('counts the moves classify judges, on random records of moves, passes and pseudo-moves', () => {
    for (let n = 0; n < 2000; n++) {
      const moves = record(Array.from({ length: 10 }, () => (Math.random() < 0.4 ? null : [0, 0]))).map(m => (Math.random() < 0.15 ? { ...m, setup: true as const } : m))
      expect(losses(Array(11).fill(0), moves, 0).map(([i]) => i)).toEqual(judgeable(moves).flatMap((x, i) => (x ? [i] : [])))
    }
  })
})

describe('phases', () => {
  it('scales the opening and the endgame by board area', () => {
    expect([50, 51, 150, 151].map(mv => phaseOf(mv, 19))).toEqual([0, 1, 1, 2])
    expect([23, 24, 70, 71].map(mv => phaseOf(mv, 13))).toEqual([0, 1, 1, 2])
    expect([11, 12, 34, 35].map(mv => phaseOf(mv, 9))).toEqual([0, 1, 1, 2])
  })
  it('sums one side’s signed losses per phase, by real move number', () => {
    // 9×9: moves 1–11 opening, 12–34 middle game; a pseudo-move at index 10 does not count as a move
    const moves: Move[] = [...record(row(10)), { sign: 1, vertex: null, setup: true }, ...record(row(30).slice(10)).map(m => ({ ...m, sign: -m.sign as Sign }))]
    moves.push({ sign: -moves.at(-1)!.sign as Sign, vertex: null }, { sign: moves.at(-1)!.sign, vertex: null })
    const leads = moves.map(() => 0).concat(0)
    const at = (i: number, by: number) => { for (let j = i + 1; j < leads.length; j++) leads[j] += moves[i].sign * -by }
    at(0, 3) // Black, move 1: opening
    at(10, 9) // the pseudo-move: no one's
    at(11, 2) // White, move 11: opening
    at(12, 4) // Black, move 12: middle game
    at(14, -1.5) // Black, move 14: a "gain" stays signed
    at(moves.length - 1, 5) // Black's game-ending pass
    expect(moves[12].sign).toBe(1)
    expect(phaseLosses(leads, moves, 1, 9)).toEqual([3, 2.5, 0])
    expect(phaseLosses(leads, moves, -1, 9)).toEqual([2, 0, 0])
  })
})

describe('reviewEnd', () => {
  it('is the whole record, or stops before a move onto an occupied point', () => {
    const g = new Game({ size: 9 })
    for (const v of row(5)) g.play(v)
    expect(reviewEnd(g)).toBe(5)
    const bad = Game.fromRecord({ size: 9 }, record([[0, 0], [1, 1], [0, 0], [2, 2]]))
    expect(reviewEnd(bad)).toBe(2)
    // White B9, Black F4, White A8, Black A9 (lone-stone suicide), White G3
    const suicide = Game.fromRecord({ size: 9 }, [[-1, [1, 0]], [1, [5, 5]], [-1, [0, 1]], [1, [0, 0]], [-1, [6, 6]]]
      .map(([sign, vertex]) => ({ sign, vertex }) as Move))
    expect(reviewEnd(suicide)).toBe(3)
    const twice = Game.fromRecord({ size: 9 }, [{ sign: 1, vertex: [2, 2] }, { sign: 1, vertex: [6, 6] }, { sign: -1, vertex: [4, 4] }])
    expect(reviewEnd(twice)).toBe(1)
  })
  it('stops at setup stones, skips empty and comment-only nodes', () => {
    expect(reviewEnd(loadSgf('(;SZ[9];B[ee];W[cc];AB[aa];W[gg])'))).toBe(2)
    const empty = loadSgf('(;GM[1]SZ[19]KM[6.5];;B[pd];W[dp];B[pp];W[dd])')
    expect([reviewEnd(empty), empty.moveNumber(), empty.moveNumber(1)]).toEqual([5, 4, 0])
    const notes = loadSgf('(;SZ[19];B[pd]C[nice];W[dp];C[just a comment];B[pp];W[dd])')
    expect([reviewEnd(notes), notes.moveNumber()]).toEqual([5, 4])
  })
  it('gives pseudo-moves no lesson and asks nothing for them', async () => {
    const g = loadSgf('(;SZ[9];B[aa];W[ii];C[x];B[ba];W[hi])')
    const asked: number[] = [], leads = [0, 0, 0, 0, -9, -9] // Black's B[ba] (index 3) loses 9
    const { moments: ms } = await readGame(g, 0, [], async (at, q) => {
      if ((q as { maxVisits: number }).maxVisits === scanQuery(6).maxVisits) asked.push(at)
      return { scoreLead: leads[at], pv: [[4, 4]], ownership: null, moves: [] } as unknown as Analysis
    }, () => true, () => {}, { levels: LV })
    expect([asked.sort(), ms.map(m => m.at)]).toEqual([[0, 1, 2, 4, 5], [3]])
    expect(pickMoments([9, 9, 9, 0, 0], record([[0, 0], [1, 1], null, [2, 2]]).map((m, i) => (i === 2 ? { ...m, setup: true as const } : m)), 0, 3)).toEqual([])
  })
})

describe('shift', () => {
  it('keeps only the points that changed hands, with one mask for both maps', () => {
    expect(shift([1, 0.2, -1, 0.5], [-1, 0.3, -1, 0])).toEqual({ lost: [-1, 0, 0, 0], kept: [1, 0, 0, 0.5] })
    expect(shift(null, [1])).toEqual({ lost: null, kept: null })
    expect(shift([1], null)).toEqual({ lost: null, kept: null })
  })
})

describe('grading a try', () => {
  it('is 0 on the punishment itself and never negative, for both colours', () => {
    const b = moment() // Black's mistake: after the punishment Black leads by -3
    expect(gradeTry(b, [3, 3], 10)).toBe(0)
    expect(gradeTry(b, [0, 0], -1.5)).toBe(1.5)
    expect(gradeTry(b, [0, 0], -5)).toBe(0)
    expect(gradeTry(b, null, 3)).toBe(6)
    const w = moment({ sign: -1, lead: 3 })
    expect(gradeTry(w, [0, 0], 1)).toBe(2)
    expect(gradeTry(w, [0, 0], 4)).toBe(0)
  })
  it('found under 1 point, missed when less than 1 point is recovered, short otherwise', () => {
    const m = moment({ loss: 6 })
    expect(verdict(m, 0)).toBe('found')
    expect(verdict(m, 0.99)).toBe('found')
    expect(verdict(m, 1)).toBe('short')
    expect(verdict(m, 5)).toBe('short')
    expect(verdict(m, 5.01)).toBe('missed')
  })
})

describe('lessonBoard', () => {
  it('starts each step at its position and leaves the game untouched', () => {
    const g = new Game({ size: 9, result: 'B+R' })
    for (const v of row(8)) g.play(v)
    g.info.result = 'B+R'
    g.goTo(3)
    const m = moment({ at: 4, sign: 1, punish: [[3, 3], [4, 4], [0, 0], [5, 5]], better: [[6, 6]] }) // [0,0] is occupied
    const tr = lessonBoard(g, m, 'try')
    expect([tr.cursor, tr.moves.length]).toEqual([5, 5])
    const pu = lessonBoard(g, m, 'punish')
    expect([pu.cursor, pu.moves.length, pu.lastMove?.vertex]).toEqual([6, 7, [3, 3]])
    const be = lessonBoard(g, m, 'better')
    expect([be.cursor, be.moves.length, be.lastMove?.vertex]).toEqual([5, 5, [6, 6]])
    expect([g.cursor, g.moves.length, g.info.result]).toEqual([3, 8, 'B+R'])
  })
})

/** A fake engine: Black's lead per position, pvs and ownership for the deep checks, optional failure. */
function fakeEngine(leads: number[], opts: { failAt?: number; deep?: Record<number, Partial<Analysis>>; great?: Record<number, Partial<Analysis>> } = {}) {
  let inFlight = 0, max = 0
  const calls: { at: number; query: Record<string, unknown> }[] = []
  const ask = async (at: number, query: object): Promise<Analysis> => {
    const id = calls.push({ at, query: query as Record<string, unknown> })
    inFlight++; max = Math.max(max, inFlight)
    await new Promise(r => setTimeout(r, 1))
    inFlight--
    if (id === opts.failAt) throw new Error('engine_stopped')
    const deep = query === DEEP ? opts.deep?.[at] : query === GREAT_DEEP ? opts.great?.[at] : undefined
    return { winrate: 0.5, scoreLead: leads[at], topMove: '', pv: [[at % 9, 8]], ownership: [at % 2 ? 0.9 : -0.9, 0.1], humanPolicy: null,
      moves: [{ v: [at % 9, 8], scoreLead: leads[at], visits: 90, prior: 0.4 }], ...deep }
  }
  return { ask, calls, max: () => max }
}

const scansOf = <C extends { query: object }>(calls: C[]) => calls.filter(c => c.query !== DEEP && c.query !== GREAT_DEEP)
const read = (game: Game, side: Sign | 0, pos: (Pos | undefined)[], ask: Parameters<typeof readGame>[3], live = () => true, progress = (_: number) => {}, book?: boolean[]) =>
  readGame(game, side, pos, ask, live, progress, { levels: LV, book })

describe('readGame', () => {
  const game = new Game({ size: 9 })
  for (const v of row(22)) game.play(v)
  // mistakes, by index: Black's 2 (−4), White's 9 (−6), Black's 14 (−3), Black's 20 (−2.5)
  const leads = Array.from({ length: 23 }, (_, i) => (i > 2 ? -4 : 0) + (i > 9 ? 6 : 0) + (i > 14 ? -3 : 0) + (i > 20 ? -2.5 : 0))
  it('scans with two queries at most, then confirms candidates in game order', async () => {
    const e = fakeEngine(leads, { deep: { 3: { scoreLead: -1 } } }) // the deep check sees move 2 lose only 1
    const pct: number[] = []
    const { moments: ms } = await read(game, 0, [], e.ask, () => true, p => pct.push(p))
    expect(e.max()).toBe(2)
    const scans = scansOf(e.calls)
    expect(scans.map(c => c.at)).toEqual(Array.from({ length: 23 }, (_, i) => i))
    for (const c of scans) expect(c.query).toEqual(scanQuery(23))
    expect(scanQuery(23)).toMatchObject({ includeOwnership: true, analysisPVLen: 7 })
    expect(scanQuery(23).overrideSettings.maxTime).toBeCloseTo(120 / 23)
    expect(scanQuery(1000).overrideSettings.maxTime).toBe(0.25)
    expect(ms.map(m => [m.at, m.sign, m.loss])).toEqual([[9, -1, 6], [14, 1, 3], [20, 1, 2.5]]) // 2 is replaced by 20
    expect(ms[0].punish).toEqual([[1, 8]])
    expect(ms[0].better).toEqual([[0, 8]])
    expect([ms[0].lost, ms[0].kept]).toEqual([[-0.9, 0], [0.9, 0]]) // the point that changed hands, from both sides
    expect(pct.every((p, i) => p <= 99 && (i === 0 || p >= pct[i - 1]))).toBe(true)
  })
  it('drops a moment whose better move is the mistake itself', async () => {
    const e = fakeEngine(leads, { deep: { 2: { pv: [[2, 0]] } } }) // game.moves[2] is [2, 0]
    expect((await read(game, 0, [], e.ask)).moments.map(m => m.at)).toEqual([9, 14, 20])
  })
  it('keeps at most three moments and filters by colour', async () => {
    expect((await read(game, 0, [], fakeEngine(leads).ask)).moments.map(m => m.at)).toEqual([2, 9, 14])
    expect((await read(game, 1, [], fakeEngine(leads).ask)).moments.map(m => m.at)).toEqual([2, 14, 20])
  })
  it('does not ask again for cached positions', async () => {
    const cache: (Pos | undefined)[] = leads.slice(0, 20).map(lead => toPos({ winrate: 0.5, scoreLead: lead, topMove: '', pv: [], ownership: [0, 0], humanPolicy: null, moves: [] }))
    const e = fakeEngine(leads)
    await read(game, 0, cache, e.ask)
    expect(scansOf(e.calls).map(c => c.at)).toEqual([20, 21, 22])
    expect(leadsOf(cache)).toEqual(leads)
  })
  it('reads again positions restored from the sidecar (no ownership in memory), so their sacrifices come back', async () => {
    cl.sac = (...a) => (a[4] === -1 ? 2 : 0)
    const pos: (Pos | undefined)[] = []
    await read(game, 0, pos, fakeEngine(leads).ask)
    const restored: (Pos | undefined)[] = JSON.parse(JSON.stringify(pos)), e = fakeEngine(leads)
    const { facts } = await read(game, 0, restored, e.ask)
    expect(scansOf(e.calls).map(c => c.at)).toEqual(Array.from({ length: 23 }, (_, i) => i))
    expect(facts[1].sac).toBe(2)
  })
  it('rejects on the first error and starts nothing after it', async () => {
    const e = fakeEngine(leads, { failAt: 3 })
    const cache: (Pos | undefined)[] = []
    await expect(read(game, 0, cache, e.ask)).rejects.toThrow('engine_stopped')
    expect(e.calls.length).toBe(4) // the 4th was already in flight, and has settled
    expect(cache[3]?.lead).toBe(leads[3])
    expect(cache.filter(x => x !== undefined).length).toBe(3)
  })
  it('stops when no longer live', async () => {
    let n = 0
    const e = fakeEngine(leads)
    const { moments } = await read(game, 0, [], (at, q) => { n++; return e.ask(at, q) }, () => n < 4)
    expect(n).toBe(4)
    expect(moments).toEqual([])
  })
  it('keeps a Pos per position: lead, uncertainty, candidates with priors, the top line', async () => {
    const pos: (Pos | undefined)[] = []
    await read(game, 0, pos, fakeEngine(leads).ask)
    expect(pos.length).toBe(23)
    expect(pos[9]).toEqual({ lead: leads[9], u: expect.closeTo(0.5, 6), cands: [{ v: [0, 8], lead: leads[9], visits: 90, prior: 0.4 }], pv: [[0, 8]] })
    expect(JSON.stringify(pos[9])).not.toContain('0.9') // the ownership stays in memory, out of the sidecar
    expect(ownershipOf(pos[9])).toEqual([0.9, 0.1])
  })
  it('gives each move its sacrifice from the ownerships around it, and its book flag', async () => {
    const seen: unknown[][] = []
    cl.sac = (...a) => { seen.push(a); return a[4] === -1 ? 2 : 0 }
    const book = Array.from({ length: 22 }, (_, i) => i < 3)
    const { facts } = await read(game, 0, [], fakeEngine(leads).ask, () => true, () => {}, book)
    expect(facts.length).toBe(22)
    expect(facts.slice(0, 4)).toEqual([{ sac: 0, book: true }, { sac: 2, book: true }, { sac: 0, book: true }, { sac: 2, book: false }])
    const [before, after, ownB, ownA, mover] = seen[1]
    expect([before, after, ownB, ownA, mover]).toEqual([game.boards[1].signMap, game.boards[2].signMap, [0.9, 0.1], [-0.9, 0.1], -1])
  })
  it('re-reads at most MAX_DEEP candidates deeper, both positions, and recomputes their sacrifice', async () => {
    let args: unknown[] = []
    cl.deep = (...a) => { args = a; return [1, 2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 20] } // 12: two too many
    cl.sac = (...a) => ((a[2] as number[])[1] === 0.7 ? 5 : 0) // only the deep ownership gives a sacrifice
    const pos: (Pos | undefined)[] = []
    const e = fakeEngine(leads, { great: { 7: { ownership: [0.9, 0.7], scoreLead: 42 } } })
    const pct: number[] = []
    const { facts } = await read(game, 0, pos, e.ask, () => true, p => pct.push(p))
    expect(args.slice(2)).toEqual([facts, LV, 22, MAX_DEEP])
    const great = e.calls.filter(c => c.query === GREAT_DEEP).map(c => c.at)
    expect(great).toEqual(Array.from({ length: 18 }, (_, i) => i + 1)) // shared positions asked once; 19 and 20 are past MAX_DEEP
    expect(great.every(i => pos[i]?.deep)).toBe(true)
    expect(pos.filter(p => p?.deep).length).toBe(great.length)
    expect([pos[7]?.lead, facts[7].sac, facts[6].sac]).toEqual([42, 5, 0]) // move 7 starts from the deep map
    expect(pct.every((p, i) => p <= 99 && (i === 0 || p >= pct[i - 1]))).toBe(true)
    e.calls.length = 0; cl.deep = () => [17, 19]
    await read(game, 0, pos, e.ask)
    expect(e.calls.filter(c => c.query === GREAT_DEEP).map(c => c.at)).toEqual([19, 20]) // 17 and 18 already deep
    expect(scansOf(e.calls)).toEqual([])
  })
  it('with saved facts, trusts sidecar positions as they are and asks only the moments’ deep checks', async () => {
    cl.deep = () => [1, 2]
    const pos: (Pos | undefined)[] = []
    await read(game, 0, pos, fakeEngine(leads).ask)
    const restored: (Pos | undefined)[] = JSON.parse(JSON.stringify(pos)), e = fakeEngine(leads)
    const facts = game.moves.map(() => ({ sac: 7, book: false }))
    const got = await readGame(game, 1, restored, e.ask, () => true, () => {}, { levels: LV, facts })
    expect(e.calls.every(c => c.query === DEEP)).toBe(true)
    expect([got.facts, got.moments.map(m => m.at)]).toEqual([facts, [2, 14, 20]])
  })
  it('asks the position a pseudo-move copies, not the copy', async () => {
    const g = loadSgf('(;SZ[9];B[aa];W[ii];C[x];B[ba];W[hi])') // index 2 is a pseudo-move: position 3 = position 2
    cl.deep = () => [3]
    const pos: (Pos | undefined)[] = []
    const e = fakeEngine([0, 0, 0, 0, 0, 0])
    await read(g, 0, pos, e.ask)
    expect(e.calls.filter(c => c.query === GREAT_DEEP).map(c => c.at)).toEqual([2, 4])
    expect([pos[2]?.deep, pos[3] === pos[2]]).toEqual([true, true])
  })
})

describe('momentAt', () => {
  const game = new Game({ size: 9 })
  for (const v of row(6)) game.play(v)
  it('deep-checks one move: a moment from its two positions, or null under MIN_LOSS', async () => {
    const e = fakeEngine([0, 0, 0, -5, -5, -5, -5])
    expect(await momentAt(game, 2, e.ask)).toEqual({ at: 2, sign: 1, loss: 5, lead: -5, punish: [[3, 8]], better: [[2, 8]], lost: [0.9, 0], kept: [-0.9, 0] })
    expect(e.calls.map(c => [c.at, c.query === DEEP])).toEqual([[2, true], [3, true]])
    expect(await momentAt(game, 3, e.ask)).toBeNull()
  })
  it('takes a lower floor for Retry: a 0.8-point loss is a moment only with min 0.5', async () => {
    const e = fakeEngine([0, 0, 0, -0.8, -0.8, -0.8, -0.8])
    expect(await momentAt(game, 2, e.ask)).toBeNull()
    expect(await momentAt(game, 2, e.ask, 0.5)).toMatchObject({ at: 2, sign: 1, loss: expect.closeTo(0.8, 6) })
  })
})

describe('toPos and levelsOf', () => {
  const a = (o: Partial<Analysis>): Analysis => ({ winrate: 0.5, scoreLead: 1, topMove: '', pv: [], ownership: null, humanPolicy: null, moves: [], ...o })
  it('keeps 6 candidates and 7 moves of the line; no ownership counts as wide open', () => {
    const moves = Array.from({ length: 9 }, (_, i) => ({ v: [i, 0] as Vertex, scoreLead: i, visits: 10 - i }))
    const p = toPos(a({ moves, pv: row(10) }), true)
    expect([p.cands.length, p.cands[5], p.pv.length, p.u, p.deep]).toEqual([6, { v: [5, 0], lead: 5, visits: 5, prior: 0 }, 7, 1, true])
    expect(toPos(a({ ownership: [1, -1, 0, 0.5] })).u).toBeCloseTo(0.375)
    expect('deep' in toPos(a({}))).toBe(false)
  })
  it('reads the SGF ranks, else the fallback, else 5k', () => {
    expect(levelsOf(loadSgf('(;SZ[9]BR[3k]WR[2d])'))).toEqual({ black: -2, white: 2 })
    expect(levelsOf(loadSgf('(;SZ[9]WR[2d])'), '3k')).toEqual({ black: -2, white: 2 })
    expect(levelsOf(loadSgf('(;SZ[9])'))).toEqual({ black: -4, white: -4 })
  })
})
