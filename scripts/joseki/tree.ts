// Joseki tree builder. Pure: the engine is injected (`ask` sends one KataGo analysis query and returns its raw
// response), so tests drive it with a fake engine. Output format: see src/joseki/db.ts.

import GoBoard from '@sabaki/go-board'
import { TAG } from '../../src/joseki/db.ts'
import { ALL, CONTEXT, MIRROR, N, REGION, canonical, code, nodeKey as outKey, point, stones, sym } from '../../src/joseki/sym.ts'

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
  s: string; ply: number; k: string; path: string[] // canonical stones; moves from the context on, in this node's (canonical) frame
  judge: Resp; lastTenuki: boolean; expandable: boolean
  edges?: Edge[]; settled?: boolean; reach: number[]
}
interface Edge { m: string; child: Node; loss: number; freq: number[]; tags: number; flag: number } // flag: the stored e[5], 0 = none

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
/** The position after `m` (in the frame of `path`), canonical under the symmetries ks, or null if illegal. */
function play(path: string[], board: GoBoard, m: string, ks?: number[]) {
  let b: GoBoard
  try { b = board.makeMove(path.length % 2 ? -1 : 1, point(m), { preventOverwrite: true, preventSuicide: true, preventKo: true }) } catch { return null }
  const { s, k, mirrored } = canonical(b.signMap, ks)
  return { s, k, mirrored, path: [...path, m].map(c => code(sym(k, point(c)))) }
}
const query = (komi: number, path: string[]) => ({ rules: 'japanese', komi, boardXSize: N, boardYSize: N, moves: path.map((c, i) => [i % 2 ? 'W' : 'B', gtp(c)]) })
const humanQueries = (ask: Ask, komi: number, path: string[]) =>
  Promise.all(PROFILES.map(p => ask({ ...query(komi, path), maxVisits: 1, includePolicy: true, overrideSettings: { humanSLProfile: p, ignorePreRootHistory: false } })))
const mass = (pol: number[][], ms: string[]) => pol.map(p => ms.reduce((a, m) => a + Math.max(0, p[idx(m)]), 0))
const tagsOf = (f: number[], loss: number) => (f[CLASSIC] >= 0.1 ? TAG.classic : 0) | (f[PRO] >= 0.1 ? TAG.pro : 0)
  | (loss <= 0.5 && f[PRO] < 0.03 && f[CLASSIC] < 0.03 ? TAG.ai : 0) | (loss <= 0.5 ? TAG.verified : 0)
  | ((f[CLASSIC] >= 0.1 || f[PRO] >= 0.1) && loss > 1 ? TAG.contested : 0)
const pct = (f: number[]) => f.slice(0, SHIPPED.length).map(v => Math.floor(v * 100))
const bestOf = (r: Resp) => r.moveInfos.find(i => i.order === 0)

/** The JosekiDb text: nodes by ply (edges point forward), one per line. */
function serialize(nodes: Iterable<Node>, roots: { name: string; m: string; node: Node; f: number[] }[], build: Record<string, unknown>) {
  const list = [...nodes].sort((a, b) => a.ply - b.ply || (a.k < b.k ? -1 : 1))
  const at = new Map(list.map((n, i) => [n, i]))
  const pvOf = (n: Node) => {
    let pv = ''
    for (const g of bestOf(n.judge)?.pv ?? []) { const m = fromGtp(g); if (!m) break; pv += m }
    return pv
  }
  const lines = list.map(n => JSON.stringify({
    k: n.k,
    e: (n.edges ?? []).sort((a, b) => a.loss - b.loss || (a.m < b.m ? -1 : 1))
      .map(e => [e.m, at.get(e.child)!, Math.round(e.loss * 10), pct(e.freq), e.tags, ...e.flag ? [e.flag] : []]),
    ...n.settled ? { s: 1 } : {}, ...n.edges ? {} : { pv: pvOf(n) },
  }))
  const head = JSON.stringify({ v: 1, build, profiles: SHIPPED, roots: roots.map(r => ({ name: r.name, m: r.m, node: at.get(r.node)!, f: pct(r.f) })) })
  return `${head.slice(0, -1)},"nodes":[\n${lines.join(',\n')}\n]}\n`
}

export async function generate(opts: Opts, ask: Ask): Promise<string> {
  const { komi, visits, budget, maxPly = 30 } = opts
  const base = (path: string[]) => query(komi, path)
  const humans = (path: string[]) => humanQueries(ask, komi, path)
  const nodes = new Map<string, Node>(), keys = new Set<string>()
  const judged = new Map<string, Promise<Resp>>()
  let used = 0
  const judge = (key: string, path: string[]) => {
    if (!judged.has(key)) { used++; judged.set(key, ask({ ...base(path), maxVisits: visits, includePolicy: true, analysisPVLen: 8 })) }
    return judged.get(key)!
  }
  const nodeKey = (ply: number, s: string) => `${ply}|${s}`
  const node = (ply: number, c: { s: string; path: string[] }, judge: Resp, lastTenuki: boolean) => {
    const k = nodeKey(ply, c.s)
    if (!nodes.has(k)) {
      const n: Node = { s: c.s, ply, path: c.path, judge, lastTenuki, expandable: false, reach: [], k: outKey(ply, c.s) }
      if (keys.has(n.k)) throw new Error(`position key collision: ${n.k} at ply ${ply}`)
      keys.add(n.k); nodes.set(k, n)
    }
    return nodes.get(k)!
  }
  // human frequency of a move class: a mirror-symmetric position plays m and its mirror image to the same node
  const classOf = (board: GoBoard) => {
    const symmetric = stones(board.signMap) === stones(board.signMap, MIRROR)
    return (m: string) => symmetric && flip(m) !== m ? [m, flip(m)].sort() : [m]
  }

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
    const away = pol.map(p => p.reduce((a, v, i) => a + (i < N * N && !REGION([i % N, Math.floor(i / N)]) ? Math.max(0, v) : 0), 0))
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
      const tags = tagsOf(f, loss)
      const child = node(P.ply + 1, legal.get(c.moves[0])!, V[j], c.tenuki)
      if (loss <= (tags & (TAG.classic | TAG.pro) ? 2 : 1) && child.ply <= maxPly && !(c.tenuki && (P.ply === 1 || P.lastTenuki))) child.expandable = true
      for (const m of c.moves) P.edges!.push({ m, child, loss, freq: c.tenuki ? f : mass(pol, [m]), tags, flag: legal.get(m)!.mirrored ? 1 : 0 })
      if (c.tenuki) P.settled = loss <= 0.5
    })
  }

  const byPly = () => [...nodes.values()].sort((a, b) => a.ply - b.ply)
  for (;;) {
    // reach per profile: sum over paths of the products of move frequencies, from each root's own frequency
    for (const n of nodes.values()) n.reach = PROFILES.map(() => 0)
    for (const r of roots) r.node.reach = [...r.f]
    for (const n of byPly()) for (const e of n.edges ?? []) e.child.reach = e.child.reach.map((v, p) => v + n.reach[p] * e.freq[p])
    const frontier = [...nodes.values()].filter(n => n.expandable && !n.edges)
      .map(n => ({ n, prio: Math.max(...n.reach), k: n.k })).sort((a, b) => b.prio - a.prio || (a.k < b.k ? -1 : 1))
    const batch = frontier.slice(0, Math.max(0, Math.min(BATCH, Math.floor((budget - used) / PER_NODE)))).map(f => f.n)
    if (!batch.length) break
    for (const plan of await Promise.all(batch.map(expand))) integrate(plan)
  }

  return serialize(nodes.values(), roots, opts.build)
}

/** Fuseki family: from the empty board, 8 symmetries. A node's children are the moves some shipped profile plays at
 * least 4 % of the time, plus KataGo's best move; the tree grows the most likely lines first, until maxPly or cap nodes. */
export const FUSEKI = { maxPly: 12, cap: 2500, threshold: 0.04 }
export interface FusekiOpts { visits: number; komi: number; build: Record<string, unknown>; maxPly?: number; cap?: number }
const NAMES: Record<string, string> = { '3-5': '5-3', '4-5': '5-4', '10-10': 'tengen' } // as the joseki roots read

export async function fuseki(opts: FusekiOpts, ask: Ask): Promise<string> {
  const { komi, visits, maxPly = FUSEKI.maxPly, cap = FUSEKI.cap } = opts
  const nodes = new Map<string, Node>()
  const judge = (path: string[]) => ask({ ...query(komi, path), maxVisits: visits, includePolicy: true, analysisPVLen: 8 })
  const shipped = (f: number[]) => Math.max(...f.slice(0, SHIPPED.length))

  // classes of moves that reach the same position (orbits under the symmetries the board keeps), kept by the rule
  async function plan(P: { path: string[]; judge: Resp }) {
    const board = boardOf(P.path), here = stones(board.signMap)
    const keeps = ALL.filter(k => stones(board.signMap, k) === here)
    const pol = (await humanQueries(ask, komi, P.path)).map(h => h.humanPolicy!)
    const best = fromGtp(bestOf(P.judge)?.move ?? '')
    const seen = new Set<string>(), cands: { moves: string[]; freq: number[]; c: NonNullable<ReturnType<typeof play>> }[] = []
    for (let i = 0; i < N * N; i++) {
      const m = code([i % N, Math.floor(i / N)])
      // a move under 0.5 % cannot lift its class (at most 8 moves) to 4 %, unless it is the best one
      if (seen.has(m) || (m !== best && shipped(pol.map(p => p[i])) < FUSEKI.threshold / 8)) continue
      const moves = [...new Set(keeps.map(k => code(sym(k, point(m)))))].sort()
      moves.forEach(x => seen.add(x))
      const freq = mass(pol, moves), c = play(P.path, board, m, ALL)
      if (c && (shipped(freq) >= FUSEKI.threshold || moves.includes(best!))) cands.push({ moves, freq, c })
    }
    return { pol, cands, legal: (m: string) => play(P.path, board, m, ALL)! }
  }
  const key = (ply: number, s: string) => `${ply}|${s}`

  // the empty board is not stored: its classes become the roots
  const empty = { path: [] as string[], judge: await judge([]) }
  const top = await plan(empty)
  let pending: Promise<unknown>[] = []
  const add = (ply: number, c: { s: string; path: string[] }) => {
    const k = key(ply, c.s)
    if (!nodes.has(k)) {
      const n: Node = { s: c.s, ply, path: c.path, judge: undefined!, lastTenuki: false, expandable: ply < maxPly, reach: [], k: outKey(ply, c.s) }
      if ([...nodes.values()].some(x => x.k === n.k)) throw new Error(`position key collision: ${n.k} at ply ${ply}`)
      nodes.set(k, n)
      pending.push(judge(c.path).then(r => { n.judge = r }))
    }
    return nodes.get(k)!
  }
  const fits = (ply: number, cands: { c: { s: string } }[]) => nodes.size + new Set(cands.map(x => x.c.s).filter(s => !nodes.has(key(ply, s)))).size <= cap
  if (!fits(1, top.cands)) throw new Error('the cap does not hold the first moves')
  const roots = top.cands.map(x => {
    const node = add(1, x.c), [a, b] = [x.moves[0]].map(m => point(m).map(v => Math.min(v, N - 1 - v) + 1).sort((p, q) => p - q))[0]
    return { name: NAMES[`${a}-${b}`] ?? `${a}-${b}`, m: x.c.path[0], node, f: x.freq }
  }).sort((p, q) => q.f.reduce((s, v) => s + v, 0) - p.f.reduce((s, v) => s + v, 0) || (p.m < q.m ? -1 : 1))
  await Promise.all(pending)

  const byPly = () => [...nodes.values()].sort((a, b) => a.ply - b.ply)
  for (let full = false; !full;) {
    // reach per profile: sum over move orders of the products of move frequencies, from each first move's own
    for (const n of nodes.values()) n.reach = PROFILES.map(() => 0)
    for (const r of roots) r.node.reach = [...r.f]
    for (const n of byPly()) for (const e of n.edges ?? []) e.child.reach = e.child.reach.map((v, p) => v + n.reach[p] * e.freq[p])
    const batch = [...nodes.values()].filter(n => n.expandable && !n.edges)
      .sort((a, b) => shipped(b.reach) - shipped(a.reach) || (a.k < b.k ? -1 : 1)).slice(0, BATCH)
    if (!batch.length) break
    const plans = await Promise.all(batch.map(plan))
    pending = []
    const taken: [Node, typeof plans[number]][] = []
    for (const [i, P] of batch.entries()) {
      if (!fits(P.ply + 1, plans[i].cands)) { full = true; break }
      plans[i].cands.forEach(x => add(P.ply + 1, x.c))
      taken.push([P, plans[i]])
    }
    await Promise.all(pending)
    for (const [P, { pol, cands, legal }] of taken) {
      const s = P.path.length % 2 ? -1 : 1, V = cands.map(x => nodes.get(key(P.ply + 1, x.c.s))!)
      const best = Math.max(...V.map(v => s * v.judge.rootInfo.scoreLead))
      P.edges = cands.flatMap((x, j) => {
        const loss = best - s * V[j].judge.rootInfo.scoreLead, tags = tagsOf(x.freq, loss)
        return x.moves.map(m => ({ m, child: V[j], loss, freq: mass(pol, [m]), tags, flag: legal(m).k }))
      })
    }
  }
  return serialize(nodes.values(), roots, opts.build)
}

/** Memoises `ask` in `store`; `save` sees every engine answer, so a killed run resumes where it stopped. */
export function cached(ask: Ask, key: (q: Record<string, unknown>) => string, store: Map<string, Resp>, save: (k: string, r: Resp) => void): Ask {
  return async q => {
    const k = key(q)
    if (!store.has(k)) { const r = await ask(q); store.set(k, r); save(k, r) }
    return store.get(k)!
  }
}
