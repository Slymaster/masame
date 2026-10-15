import GoBoard from '@sabaki/go-board'
import { beforeAll, describe, expect, it } from 'vitest'
import { validate, type JosekiDb } from '../../src/joseki/db'
import { ALL, N, canonical, code, fnv, point, positionKey, stones, sym, type Pt } from '../../src/joseki/sym'
import { cached, FUSEKI, fuseki, PROFILES, SHIPPED, type Resp } from './tree'

const COLS = 'ABCDEFGHJKLMNOPQRST'
const fromGtp = (g: string) => code([COLS.indexOf(g[0]), N - +g.slice(1)])
const gtp = ([x, y]: Pt) => `${COLS[x]}${N - y}`
const h = (s: string) => parseInt(fnv(s), 16)
const all: Pt[] = Array.from({ length: N * N }, (_, i) => [i % N, Math.floor(i / N)])
const replay = (moves: string[]) => moves.reduce((b, m, i) => b.makeMove(i % 2 ? -1 : 1, point(m), { preventOverwrite: true, preventSuicide: true, preventKo: true }), GoBoard.fromDimensions(N))
const fromStones = (s: string) => new GoBoard(Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => 'o.x'.indexOf(s[y * N + x]) - 1)))
const orbit = (v: Pt) => ALL.map(k => code(sym(k, v))).sort()[0]
const lines = ([x, y]: Pt) => [x, y].map(v => Math.min(v, N - 1 - v) + 1).sort((a, b) => a - b).join('-')

// Fake engine, a function of the board alone. Humans like the corner points (each profile its own taste, and the
// 2010 pros love tengen, which no shipped profile plays); the judge counts stones with weights the 8 symmetries keep.
const LIKE: Record<string, number> = { '4-4': 10, '3-4': 8, '3-3': 3, '4-5': 2, '3-5': 1.5 }
// narrow: everyone, KataGo included, plays the first free point of one line
const LINE = ['pd', 'dp', 'pp', 'dd', 'qj', 'cj', 'jc', 'jq', 'jj', 'qq', 'cc', 'qc', 'cq'].map(point)
const narrowMove = (b: GoBoard) => LINE.find(v => b.get(v) === 0)!
function humanPolicy(b: GoBoard, profile: string, narrow = false) {
  const n = all.filter(v => b.get(v) !== 0).length
  const wt = all.map(v => {
    if (b.get(v) !== 0) return 0
    if (narrow) return code(v) === code(narrowMove(b)) ? 1 : 0
    if (profile === 'proyear_2010' && code(v) === 'jj') return 500
    return (LIKE[lines(v)] ?? 0.01) * (1 + h(`${profile}|${code(v)}|${n}`) % 4)
  })
  const sum = wt.reduce((a, x) => a + x, 0) || 1
  return [...wt.map((x, i) => b.get(all[i]) !== 0 ? -1 : x / sum), 0]
}
const w = (v: Pt) => 1 + h(orbit(v)) % 9
const lead = (b: GoBoard) => all.reduce((a, v) => a + b.get(v)! * w(v), -6.5)
const toMove = (b: GoBoard) => all.filter(v => b.get(v) !== 0).length % 2 ? -1 : 1
function judgeOf(b: GoBoard) {
  const sign = toMove(b), here = lead(b)
  return all.filter(v => b.get(v) === 0).map(v => ({ v, l: here + sign * w(v) }))
    .sort((x, y) => sign * (y.l - x.l) || h(code(x.v)) - h(code(y.v))).slice(0, 12)
}
function fake(log: Record<string, unknown>[] = [], narrow = false) {
  return async (q: Record<string, unknown>): Promise<Resp> => {
    log.push(q)
    const b = replay((q.moves as string[][]).map(([, g]) => fromGtp(g)))
    const profile = (q.overrideSettings as { humanSLProfile?: string } | undefined)?.humanSLProfile
    if (profile) return { rootInfo: { scoreLead: lead(b) }, moveInfos: [], humanPolicy: humanPolicy(b, profile, narrow) }
    const scored = narrow ? [{ v: narrowMove(b), l: lead(b) }] : judgeOf(b)
    return { rootInfo: { scoreLead: lead(b) }, moveInfos: scored.map(({ v, l }, i) => ({ move: gtp(v), visits: 100 - 7 * i, scoreLead: l, order: i, pv: [gtp(v), 'pass'] })) }
  }
}
const opts = { visits: 800, komi: 6.5, cap: 120, build: { date: 'test' } }

/** Boards of every node in its stored frame, walking the edges from the roots with legal moves only. */
function walk(db: JosekiDb) {
  const boards: GoBoard[] = [], ply: number[] = [], parents: Set<number>[] = db.nodes.map(() => new Set())
  for (const r of db.roots) { boards[r.node] = replay([r.m]); ply[r.node] = 1 }
  db.nodes.forEach((n, i) => {
    for (const [m, c, , , , k = 0] of n.e) {
      const b = fromStones(stones(boards[i].makeMove(toMove(boards[i]), point(m), { preventOverwrite: true, preventSuicide: true, preventKo: true }).signMap, k))
      if (boards[c]) expect(stones(b.signMap)).toBe(stones(boards[c].signMap))
      boards[c] ??= b; ply[c] = ply[i] + 1; parents[c].add(i)
    }
  })
  return { boards, ply, parents }
}

describe('whole-board symmetries', () => {
  const b = replay(['pd', 'dp', 'qf', 'cd'])
  it('give the 8 images of a position one key, and a transposed move order the same node', () => {
    const images = ALL.map(k => fromStones(stones(b.signMap, k)))
    expect(new Set(images.map(x => stones(x.signMap))).size).toBe(8)
    expect(new Set(images.map(x => positionKey(x.signMap, 4, ALL))).size).toBe(1)
    expect(positionKey(replay(['qf', 'cd', 'pd', 'dp']).signMap, 4, ALL)).toBe(positionKey(b.signMap, 4, ALL))
    expect(positionKey(replay(['pd', 'dp', 'qf', 'ce']).signMap, 4, ALL)).not.toBe(positionKey(b.signMap, 4, ALL))
  })
  it('keep the joseki’s corner logic: by default only the MIRROR image merges', () => {
    expect(canonical(b.signMap).k === 0 || canonical(b.signMap).k === 7).toBe(true)
    expect(new Set(ALL.map(k => positionKey(fromStones(stones(b.signMap, k)).signMap, 4))).size).toBeGreaterThan(1)
  })
})

describe('fuseki', () => {
  const log: Record<string, unknown>[] = []
  let text: string, db: JosekiDb, boards: GoBoard[], ply: number[], parents: Set<number>[]
  beforeAll(async () => {
    text = await fuseki(opts, fake(log))
    db = validate(JSON.parse(text));
    ({ boards, ply, parents } = walk(db))
  })

  it('stores each position once, in its canonical frame, under its whole-board key', () => {
    db.nodes.forEach((n, i) => {
      expect(canonical(boards[i].signMap, ALL).k).toBe(0)
      expect(n.k).toBe(positionKey(boards[i].signMap, ply[i], ALL))
    })
    expect(parents.some(p => p.size > 1)).toBe(true) // transpositions merged
  })
  it('opens with one root per kind of first move: the corner points and KataGo’s best, not tengen', () => {
    const best = lines(judgeOf(replay([]))[0].v)
    expect(best).toBe('1-3') // the fake judge's taste, kept by the best-move rule alone
    expect(db.roots.map(r => r.name).sort()).toEqual(['3-3', '3-4', '4-4', '5-3', '5-4', best].sort())
    expect(new Set(db.roots.map(r => r.node)).size).toBe(db.roots.length)
    expect(db.roots[0].name).toBe('3-4') // most frequent first: 8 points of it
  })
  it('keeps exactly the moves a shipped profile plays 4 % of the time, and KataGo’s best', () => {
    const expanded = db.nodes.map((_, i) => i).filter(i => db.nodes[i].e.length)
    expect(expanded.length).toBeGreaterThan(5)
    let byBestOnly = 0
    for (const i of expanded) {
      const b = boards[i], pol = SHIPPED.map((_, p) => humanPolicy(b, PROFILES[p])), cls = new Map<string, number[]>()
      for (const v of all) if (b.get(v) === 0) {
        const k = positionKey(b.makeMove(toMove(b), v).signMap, ply[i] + 1, ALL)
        cls.set(k, pol.map((p, j) => (cls.get(k)?.[j] ?? 0) + p[v[1] * N + v[0]]))
      }
      const best = positionKey(b.makeMove(toMove(b), judgeOf(b)[0].v).signMap, ply[i] + 1, ALL)
      const want = [...cls].filter(([k, f]) => k === best || Math.max(...f) >= FUSEKI.threshold).map(([k]) => k)
      expect(new Set(db.nodes[i].e.map(e => db.nodes[e[1]].k))).toEqual(new Set(want))
      if (Math.max(...cls.get(best)!) < FUSEKI.threshold) byBestOnly++
    }
    expect(byBestOnly).toBeGreaterThan(0)
  })
  it('stops at the node cap, the most likely lines first', () => {
    expect(db.nodes.length).toBeLessThanOrEqual(opts.cap)
    expect(db.nodes.length).toBeGreaterThan(opts.cap - 30)
    expect(log.filter(q => (q.maxVisits as number) > 1).length).toBe(db.nodes.length + 1) // each position judged once, and the empty board
    expect(Math.max(...ply)).toBeGreaterThan(2)
  })
  it('measures the loss from the mover’s side', () => {
    for (const [i, n] of db.nodes.entries()) if (n.e.length) {
      const s = toMove(boards[i]), V = n.e.map(e => lead(boards[e[1]]))
      const best = Math.max(...V.map(v => s * v))
      n.e.forEach((e, j) => expect(e[2]).toBe(Math.round((best - s * V[j]) * 10)))
    }
  })
  it('goes 12 moves deep and no further', async () => {
    const line = validate(JSON.parse(await fuseki({ ...opts, cap: FUSEKI.cap }, fake([], true))))
    expect(line.nodes).toHaveLength(FUSEKI.maxPly)
    expect(line.nodes.filter(n => n.e.length)).toHaveLength(FUSEKI.maxPly - 1)
    expect(line.nodes.at(-1)!.pv).toBeTruthy()
  })
  it('gives identical bytes on a rerun, and after a killed run resumed from the cache', async () => {
    expect(await fuseki(opts, fake())).toBe(text)
    const store = new Map<string, Resp>(), key = (q: object) => JSON.stringify(q), engine = fake()
    let calls = 0
    const dying = async (q: Record<string, unknown>) => { if (++calls > 200) throw new Error('killed'); return engine(q) }
    await expect(fuseki(opts, cached(dying, key, store, () => {}))).rejects.toThrow('killed')
    expect(await fuseki(opts, cached(engine, key, store, () => {}))).toBe(text)
  })
})
