// Joseki tree builder. Pure: the engine is injected (`ask` sends one KataGo analysis query and returns its raw
// response), so tests drive it with a fake engine. Output format: see src/joseki/db.ts.

import GoBoard from '@sabaki/go-board'
import { TAG } from '../../src/joseki/db.ts'
import { CONTEXT, MIRROR, N, REGION, canonical, code, fnv, point, stones, sym, type Pt } from '../../src/joseki/sym.ts'

/** Human SL profiles queried per node; the first 7 are shipped, proyear_2010 only feeds the "classic" tag. */
export const PROFILES = ['rank_20k', 'rank_15k', 'rank_10k', 'rank_5k', 'rank_1d', 'rank_5d', 'proyear_2023', 'proyear_2010']
export const SHIPPED = ['20k', '15k', '10k', '5k', '1d', '5d', 'pro']
const KYU = [0, 1, 2, 3], PRO = 6, CLASSIC = 7
const MAIN = 4, KYU_MOVES = 2, BATCH = 8, PER_NODE = MAIN + KYU_MOVES + 1 // judge queries an expansion can cost

interface Info { move: string; visits: number; scoreLead: number; order: number; pv?: string[]; isSymmetryOf?: string }
export interface Resp { rootInfo: { scoreLead: number }; moveInfos: Info[]; policy?: number[]; humanPolicy?: number[] }
export type Ask = (query: Record<string, unknown>) => Promise<Resp>
export interface Opts {
  roots: { name: string; m: string }[]
  visits: number; budget: number; komi: number
  build: Record<string, unknown> // written as is (date, networks…), so the output depends only on opts and the engine
  maxPly?: number
}

interface Node {
  s: string; ply: number; path: string[] // canonical stones; moves from the context on, in this node's (canonical) frame
  judge: Resp; lastTenuki: boolean; expandable: boolean
  edges?: Edge[]; settled?: boolean; reach: number[]
}
interface Edge { m: string; child: Node; loss: number; freq: number[]; tags: number; mirrored: boolean }

const COLS = 'ABCDEFGHJKLMNOPQRST'
const gtp = (c: string) => { const [x, y] = point(c); return `${COLS[x]}${N - y}` }
const fromGtp = (s: string) => { const x = COLS.indexOf(s[0]), y = N - +s.slice(1); return x >= 0 && y >= 0 && y < N ? code([x, y]) : null }
const flip = (c: string) => code(sym(MIRROR, point(c)))
const idx = (c: string) => { const [x, y] = point(c); return y * N + x }

function boardOf(path: string[]) {
  let b = GoBoard.fromDimensions(N)
  path.forEach((c, i) => { b = b.makeMove(i % 2 ? -1 : 1, point(c)) })
  return b
}
/** The position after `m` (in the frame of `path`), or null if illegal. */
function play(path: string[], board: GoBoard, m: string) {
  let b: GoBoard
  try { b = board.makeMove(path.length % 2 ? -1 : 1, point(m), { preventOverwrite: true, preventSuicide: true, preventKo: true }) } catch { return null }
  const { s, mirrored } = canonical(b.signMap)
  return { s, mirrored, path: [...path, m].map(c => mirrored ? flip(c) : c) }
}

export async function generate(opts: Opts, ask: Ask): Promise<string> {
  const { komi, visits, budget, maxPly = 30 } = opts
  const base = (path: string[]) => ({ rules: 'japanese', komi, boardXSize: N, boardYSize: N, moves: path.map((c, i) => [i % 2 ? 'W' : 'B', gtp(c)]) })
  const humans = (path: string[]) => Promise.all(PROFILES.map(p => ask({ ...base(path), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: p, ignorePreRootHistory: false } })))
  const nodes = new Map<string, Node>()
  const judged = new Map<string, Promise<Resp>>()
  let used = 0
  const judge = (key: string, path: string[]) => {
    if (!judged.has(key)) { used++; judged.set(key, ask({ ...base(path), maxVisits: visits, includePolicy: true, analysisPVLen: 8 })) }
    return judged.get(key)!
  }
  const nodeKey = (ply: number, s: string) => `${ply}|${s}`
  const node = (ply: number, c: { s: string; path: string[] }, judge: Resp, lastTenuki: boolean) => {
    const k = nodeKey(ply, c.s)
    if (!nodes.has(k)) nodes.set(k, { s: c.s, ply, path: c.path, judge, lastTenuki, expandable: false, reach: [] })
    return nodes.get(k)!
  }
  // human frequency of a move class: a mirror-symmetric position plays m and its mirror image to the same node
  const classOf = (board: GoBoard) => {
    const symmetric = stones(board.signMap) === stones(board.signMap, MIRROR)
    return (m: string) => symmetric && flip(m) !== m ? [m, flip(m)].sort() : [m]
  }
  const mass = (pol: number[][], ms: string[]) => pol.map(p => ms.reduce((a, m) => a + Math.max(0, p[idx(m)]), 0))

  // roots: White's corner stone in the context, Black to play
  const ctx = boardOf(CONTEXT), ctxPol = (await humans(CONTEXT)).map(h => h.humanPolicy!), ctxClass = classOf(ctx)
  const starts = opts.roots.map(r => play(CONTEXT, ctx, r.m)!), J = await Promise.all(starts.map(c => judge(nodeKey(1, c.s), c.path)))
  const roots = opts.roots.map((r, i) => {
    const n = node(1, starts[i], J[i], false)
    n.expandable = true
    return { name: r.name, m: starts[i].mirrored ? flip(r.m) : r.m, node: n, f: mass(ctxPol, ctxClass(r.m)) }
  })

  async function expand(P: Node) {
    const board = boardOf(P.path), cls = classOf(board)
    const pol = (await humans(P.path)).map(h => h.humanPolicy!)
    const s = P.ply % 2 ? 1 : -1, infos = P.judge.moveInfos
    const best = infos.find(i => i.order === 0)!
    const legal = new Map<string, NonNullable<ReturnType<typeof play>>>()
    const ok = (m: string) => { if (!legal.has(m)) { const c = play(P.path, board, m); if (c) legal.set(m, c) } return legal.has(m) }
    const reps = new Map<string, number[]>() // class representative → class frequency per profile
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const m = code([x, y]), c = cls(m)
      if (REGION([x, y]) && c[0] === m && c.every(ok)) reps.set(m, mass(pol, c))
    }
    const rep = (gm: string) => { const m = fromGtp(gm); return m && REGION(point(m)) ? cls(m)[0] : null }
    const pro = (m: string) => Math.max(reps.get(m)![PRO], reps.get(m)![CLASSIC])
    // judge moves: within 1 point of its best, among moves with enough visits for the score to mean something
    const judgeSet = new Set(infos.filter(i => i.visits >= best.visits / 20 && s * i.scoreLead >= s * best.scoreLead - 1)
      .map(i => rep(i.move)).filter((m): m is string => !!m && reps.has(m)))
    const top = rep(best.move)
    const main = [...reps.keys()].filter(m => m === top || judgeSet.has(m) || pro(m) >= 0.05)
      .sort((a, b) => +(b === top) - +(a === top) || pro(b) - pro(a) || (a < b ? -1 : 1)).slice(0, MAIN)
    const kyu = (m: string) => Math.max(...KYU.map(p => reps.get(m)![p]))
    const kyus = [...reps.keys()].filter(m => !main.includes(m) && kyu(m) >= 0.1)
      .sort((a, b) => kyu(b) - kyu(a) || (a < b ? -1 : 1)).slice(0, KYU_MOVES)
    // tenuki = a real stone: the judge's most-visited move outside REGION, and not the twin of a REGION move in a
    // symmetric whole board (after the 4-4 root, the 3-3 under White's D4 is the 3-3 here)
    const here = stones(board.signMap), twins = [1, 2, 3, 4, 5, 6].filter(k => stones(board.signMap, k) === here)
    const outside = (m: string | null): m is string => !!m && [0, ...twins].every(k => !REGION(sym(k, point(m)))) && ok(m)
    let tenuki = [...infos].sort((a, b) => b.visits - a.visits || a.order - b.order).map(i => fromGtp(i.move)).find(outside)
    if (!tenuki) {
      const p = P.judge.policy ?? []
      tenuki = Array.from({ length: N * N }, (_, i) => code([i % N, Math.floor(i / N)])).filter(m => outside(m))
        .sort((a, b) => p[idx(b)] - p[idx(a)] || (a < b ? -1 : 1))[0]
    }
    const away = pol.map(p => p.reduce((a, v, i) => a + (i === N * N || !REGION([i % N, Math.floor(i / N)]) ? Math.max(0, v) : 0), 0))
    const cands = [...main, ...kyus].map(m => ({ moves: cls(m), freq: reps.get(m)!, tenuki: false }))
    if (tenuki) cands.push({ moves: [tenuki], freq: away, tenuki: true })
    const V = await Promise.all(cands.map(c => { const r = legal.get(c.moves[0])!; return judge(nodeKey(P.ply + 1, r.s), r.path) }))
    return { P, pol, cands, V, legal }
  }

  function integrate({ P, pol, cands, V, legal }: Awaited<ReturnType<typeof expand>>) {
    const s = P.ply % 2 ? 1 : -1, top = Math.max(...V.map(v => s * v.rootInfo.scoreLead))
    P.edges = []
    cands.forEach((c, j) => {
      const loss = top - s * V[j].rootInfo.scoreLead, f = c.freq
      const tags = (f[CLASSIC] >= 0.1 ? TAG.classic : 0) | (f[PRO] >= 0.1 ? TAG.pro : 0)
        | (loss <= 0.5 && f[PRO] < 0.03 && f[CLASSIC] < 0.03 ? TAG.ai : 0) | (loss <= 0.5 ? TAG.verified : 0)
        | ((f[CLASSIC] >= 0.1 || f[PRO] >= 0.1) && loss > 1 ? TAG.contested : 0)
      const child = node(P.ply + 1, legal.get(c.moves[0])!, V[j], c.tenuki)
      if (loss <= (tags & (TAG.classic | TAG.pro) ? 2 : 1) && child.ply <= maxPly && !(c.tenuki && (P.ply === 1 || P.lastTenuki))) child.expandable = true
      for (const m of c.moves) P.edges!.push({ m, child, loss, freq: c.tenuki ? f : mass(pol, [m]), tags, mirrored: legal.get(m)!.mirrored })
      if (c.tenuki) P.settled = loss <= 0.5
    })
  }

  const byPly = () => [...nodes.values()].sort((a, b) => a.ply - b.ply)
  const keyOf = (n: Node) => fnv(`${n.ply}|${n.ply % 2 ? 'B' : 'W'}|${n.s}`) // = positionKey
  for (;;) {
    // reach per profile: sum over paths of the products of move frequencies, from each root's own frequency
    for (const n of nodes.values()) n.reach = PROFILES.map(() => 0)
    for (const r of roots) r.node.reach = [...r.f]
    for (const n of byPly()) for (const e of n.edges ?? []) e.child.reach = e.child.reach.map((v, p) => v + n.reach[p] * e.freq[p])
    const frontier = [...nodes.values()].filter(n => n.expandable && !n.edges)
      .map(n => ({ n, prio: Math.max(...n.reach), k: keyOf(n) })).sort((a, b) => b.prio - a.prio || (a.k < b.k ? -1 : 1))
    const batch = frontier.slice(0, Math.max(0, Math.min(BATCH, Math.floor((budget - used) / PER_NODE)))).map(f => f.n)
    if (!batch.length) break
    for (const plan of await Promise.all(batch.map(expand))) integrate(plan)
  }

  // output: nodes by ply (edges point forward), one per line
  const list = byPly().map(n => ({ n, k: keyOf(n) })).sort((a, b) => a.n.ply - b.n.ply || (a.k < b.k ? -1 : 1))
  const at = new Map(list.map(({ n }, i) => [n, i]))
  if (new Set(list.map(l => l.k)).size !== list.length) throw new Error('position key collision')
  const pct = (f: number[]) => f.slice(0, SHIPPED.length).map(v => Math.floor(v * 100))
  const pvOf = (n: Node) => {
    let pv = ''
    for (const g of n.judge.moveInfos.find(i => i.order === 0)?.pv ?? []) { const m = fromGtp(g); if (!m) break; pv += m }
    return pv
  }
  const lines = list.map(({ n, k }) => JSON.stringify({
    k,
    e: (n.edges ?? []).sort((a, b) => a.loss - b.loss || (a.m < b.m ? -1 : 1))
      .map(e => [e.m, at.get(e.child)!, Math.round(e.loss * 10), pct(e.freq), e.tags, ...e.mirrored ? [1] : []]),
    ...n.settled ? { s: 1 } : {}, ...n.edges ? {} : { pv: pvOf(n) },
  }))
  const head = JSON.stringify({ v: 1, build: opts.build, profiles: SHIPPED, roots: roots.map(r => ({ name: r.name, m: r.m, node: at.get(r.node)!, f: pct(r.f) })) })
  return `${head.slice(0, -1)},"nodes":[\n${lines.join(',\n')}\n]}\n`
}

/** Memoises `ask` in `store`; `save` sees every engine answer, so a killed run resumes where it stopped. */
export function cached(ask: Ask, key: (q: Record<string, unknown>) => string, store: Map<string, Resp>, save: (k: string, r: Resp) => void): Ask {
  return async q => {
    const k = key(q)
    if (!store.has(k)) { const r = await ask(q); store.set(k, r); save(k, r) }
    return store.get(k)!
  }
}
