import GoBoard from '@sabaki/go-board'
import { beforeAll, describe, expect, it } from 'vitest'
import { TAG, validate, type JosekiDb } from '../../src/joseki/db'
import { CONTEXT, MIRROR, N, REGION, ROOTS, canonical, code, fnv, invert, point, positionKey, sym, type Pt } from '../../src/joseki/sym'
import { cached, generate, PROFILES, type Resp } from './tree'

const COLS = 'ABCDEFGHJKLMNOPQRST'
const fromGtp = (g: string) => code([COLS.indexOf(g[0]), N - +g.slice(1)])
const gtp = ([x, y]: Pt) => `${COLS[x]}${N - y}`
const h = (s: string) => parseInt(fnv(s), 16)
const mirror = (m: string) => code(sym(MIRROR, point(m)))
const all: Pt[] = Array.from({ length: N * N }, (_, i) => [i % N, Math.floor(i / N)])
const replay = (moves: string[]) => moves.reduce((b, m, i) => b.makeMove(i % 2 ? -1 : 1, point(m)), GoBoard.fromDimensions(N))

// Fake engine. Black's score = weighted stone count, with weights symmetric under MIRROR so mirror images agree.
const w = (v: Pt) => 1 + h([code(v), mirror(code(v))].sort()[0]) % 9
const lead = (b: GoBoard) => all.reduce((a, v) => a + b.get(v)! * w(v), -6.5)
function fake(log: Record<string, unknown>[] = []) {
  return async (q: Record<string, unknown>): Promise<Resp> => {
    log.push(q)
    const moves = (q.moves as string[][]).map(([, g]) => fromGtp(g)), b = replay(moves), sign = moves.length % 2 ? -1 : 1
    const empty = all.filter(v => b.get(v) === 0), here = lead(b)
    const policy = Array.from({ length: N * N + 1 }, (_, i) => i < N * N && empty.some(v => v[1] * N + v[0] === i) ? 1 / empty.length : -1)
    const profile = (q.overrideSettings as { humanSLProfile?: string } | undefined)?.humanSLProfile
    if (profile) {
      // humans play near the last move, each level its own favourites, and 10 % elsewhere
      const tier = profile.startsWith('proyear') ? 'pro' : /[0-9]k/.test(profile) && +profile.slice(5, -1) >= 10 ? 'ddk' : 'sdk'
      const [lx, ly] = point(moves.at(-1)!), near = empty.filter(([x, y]) => Math.max(Math.abs(x - lx), Math.abs(y - ly)) <= 2 && REGION([x, y]))
      const wt = near.map(v => (h(`${tier}|${code(v)}|${moves.length}`) % 100) ** 4), sum = wt.reduce((a, x) => a + x, 0) || 1
      const hp = policy.map(p => p < 0 ? -1 : 0)
      near.forEach((v, i) => { hp[v[1] * N + v[0]] = 0.9 * wt[i] / sum })
      hp[3 * N + 9] = hp[3 * N + 9] < 0 ? -1 : 0.1 // J16, outside REGION
      return { rootInfo: { scoreLead: here }, moveInfos: [], humanPolicy: hp }
    }
    const scored = empty.map(v => ({ v, l: here + sign * w(v) })).sort((x, y) => sign * (y.l - x.l) || h(code(x.v)) - h(code(y.v))).slice(0, 12)
    return {
      rootInfo: { scoreLead: here }, policy,
      moveInfos: scored.map(({ v, l }, i) => ({ move: gtp(v), visits: 100 - 7 * i, scoreLead: l, order: i, pv: [gtp(v), 'pass'] })),
    }
  }
}
const opts = { roots: ROOTS.slice(0, 2), visits: 800, budget: 80, komi: 6.5, build: { date: 'test' } }

/** Boards of every node, in its stored frame, by walking the edges from the roots. */
function walk(db: JosekiDb) {
  const boards: GoBoard[] = [], ply: number[] = []
  for (const r of db.roots) { boards[r.node] = replay([...CONTEXT, r.m]); ply[r.node] = 1 }
  db.nodes.forEach((n, i) => {
    for (const [m, c, , , , k] of n.e) {
      let b = boards[i].makeMove(ply[i] % 2 ? 1 : -1, point(m))
      if (k) b = new GoBoard(b.signMap.map((row, y) => row.map((_, x) => { const [a, z] = sym(invert(k), [x, y]); return b.signMap[z][a] })))
      boards[c] ??= b; ply[c] = ply[i] + 1
    }
  })
  return { boards, ply }
}

describe('generate', () => {
  const log: Record<string, unknown>[] = []
  let text: string, db: JosekiDb, boards: GoBoard[], ply: number[], expanded: number[]
  beforeAll(async () => {
    text = await generate(opts, fake(log))
    db = validate(JSON.parse(text));
    ({ boards, ply } = walk(db))
    expanded = db.nodes.map((_, i) => i).filter(i => db.nodes[i].e.length)
  })

  it('stores each node once, in its canonical frame, under its position key', () => {
    db.nodes.forEach((n, i) => {
      expect(boards[i]).toBeDefined()
      expect(canonical(boards[i].signMap).mirrored).toBe(false)
      expect(n.k).toBe(positionKey(boards[i].signMap, ply[i]))
    })
    expect(new Set(db.nodes.map(n => n.k)).size).toBe(db.nodes.length)
    expect(text.split('\n').length).toBe(db.nodes.length + 3) // one node per line
  })
  it('measures the loss from the mover’s side, for Black and for White', () => {
    expect(new Set(expanded.map(i => ply[i] % 2))).toEqual(new Set([0, 1]))
    for (const i of expanded) {
      const s = ply[i] % 2 ? 1 : -1, V = db.nodes[i].e.map(([m]) => lead(boards[i].makeMove(s, point(m))))
      const best = Math.max(...V.map(v => s * v))
      db.nodes[i].e.forEach((e, j) => expect(e[2]).toBe(Math.round((best - s * V[j]) * 10)))
      expect(Math.min(...db.nodes[i].e.map(e => e[2]))).toBe(0)
    }
  })
  it('adds exactly one tenuki, a real stone outside REGION, and marks settled nodes', () => {
    for (const i of expanded) {
      const t = db.nodes[i].e.filter(([m]) => !REGION(point(m)))
      expect(t).toHaveLength(1)
      expect(db.nodes[i].s === 1).toBe(t[0][2] <= 5)
    }
  })
  it('caps the candidates and tags them consistently', () => {
    for (const i of expanded) expect(new Set(db.nodes[i].e.map(e => e[1])).size).toBeLessThanOrEqual(4 + 2 + 1)
    for (const [, , loss, , tags] of db.nodes.flatMap(n => n.e)) {
      expect(!!(tags & TAG.verified)).toBe(loss <= 5)
      if (tags & TAG.ai) expect(loss).toBeLessThanOrEqual(5)
      expect(!!(tags & TAG.contested)).toBe(!!(tags & (TAG.classic | TAG.pro)) && loss > 10)
    }
    expect(db.nodes.flatMap(n => n.e).some(e => e[4] & TAG.pro)).toBe(true)
  })
  it('does not expand mistakes but keeps their punishment line', () => {
    const ok = new Set(db.nodes.flatMap(n => n.e.filter(e => e[2] <= 10).map(e => e[1])))
    const mistakes = db.nodes.flatMap(n => n.e.filter(e => e[2] > 20 && !ok.has(e[1])).map(e => e[1]))
    expect(mistakes.length).toBeGreaterThan(0)
    for (const c of mistakes) { expect(db.nodes[c].e).toEqual([]); expect(db.nodes[c].pv!.length).toBeGreaterThan(0) }
  })
  it('respects the judge budget', () => {
    expect(log.filter(q => (q.maxVisits as number) > 1).length).toBeLessThanOrEqual(opts.budget)
    expect(log.filter(q => q.maxVisits === 1).length % PROFILES.length).toBe(0)
  })
  it('sends mirrored approaches of a symmetric corner to one node', () => {
    const root = db.nodes[db.roots[0].node].e, pairs = root.filter(([m]) => mirror(m) !== m && REGION(point(m)))
    expect(pairs.length).toBeGreaterThan(0)
    for (const [m, c] of pairs) expect(root.find(e => e[0] === mirror(m))?.[1]).toBe(c)
  })
  it('gives identical bytes on a rerun, and after a killed run resumed from the cache', async () => {
    expect(await generate(opts, fake())).toBe(text)
    const store = new Map<string, Resp>(), key = (q: object) => JSON.stringify(q), engine = fake()
    let calls = 0
    const dying = async (q: Record<string, unknown>) => { if (++calls > 150) throw new Error('killed'); return engine(q) }
    await expect(generate(opts, cached(dying, key, store, () => {}))).rejects.toThrow('killed')
    const before = store.size
    expect(await generate(opts, cached(engine, key, store, () => {}))).toBe(text)
    expect(before).toBeGreaterThan(0)
  })
})
