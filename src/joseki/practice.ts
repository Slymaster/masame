// The joseki and fuseki trainers' logic, pure: walking the tree in any orientation, cards, grading, the opponent, the programme.
// The fuseki (db.family) is the same book read from the empty board: no context stones, no tenuki, no programme.
import GoBoard from '@sabaki/go-board'
import type { Move, Sign, Vertex } from '../game'
import type { Card, Rating } from './fsrs'
import type { Book, Edge, JosekiDb } from './db'
import { code, compose, CONTEXT, invert, N, point, REGION, sym } from './sym'
import { NEW_PER_DAY } from './store'

/** How a line is shown: a board symmetry and whether colours are swapped. */
export interface Orient { k: number; swap: boolean }
/** The explorer: the data's own frame, colours swapped so the corner stone is Black. */
export const EXPLORE: Orient = { k: 0, swap: true }
export const isFuseki = (db: JosekiDb) => db.family === 'fuseki'
/** The fuseki's explorer keeps the colours: with komi, Black always plays first. */
export const exploreOf = (db: JosekiDb): Orient => isFuseki(db) ? { k: 0, swap: false } : EXPLORE
/** Turned at random; the joseki's colours too, never the fuseki's (komi: Black plays first). */
export const randomOrient = (book: Book, rand = Math.random): Orient => ({ k: Math.floor(rand() * 8), swap: book === 'joseki' && rand() < 0.5 })
/** The stones played before the roots. */
export const contextOf = (db: JosekiDb) => isFuseki(db) ? [] : CONTEXT
/** A line: a root, then the edge index picked at each node. */
export interface Path { root: number; picks: number[] }
/** Nodes along a path, the frame each is stored in (relative to the root's), and the moves in the root's frame. */
export interface Walk { nodes: number[]; frames: number[]; moves: string[] }

/** The frame of an edge's child: it is stored as the image, under symmetry e[5], of the position played. */
const through = (f: number, e: Edge) => compose(f, invert(e[5] ?? 0))

export function walk(db: JosekiDb, { root, picks }: Path): Walk {
  const r = db.roots[root], w: Walk = { nodes: [r.node], frames: [0], moves: [r.m] }
  for (const i of picks) {
    const f = w.frames.at(-1)!, e = db.nodes[w.nodes.at(-1)!].e[i]
    w.moves.push(code(sym(f, point(e[0]))))
    w.nodes.push(e[1])
    w.frames.push(through(f, e))
  }
  return w
}
export const node = (w: Walk) => w.nodes.at(-1)!
const frame = (w: Walk) => w.frames.at(-1)!

/** The whole game (context first) as shown. */
export const shown = (moves: string[], o: Orient, context = CONTEXT): Move[] =>
  [...context, ...moves].map((c, i) => ({ sign: ((i % 2 ? -1 : 1) * (o.swap ? -1 : 1)) as Sign, vertex: sym(o.k, point(c)) }))
export const position = (ms: Move[]) => ms.reduce((b, m) => b.makeMove(m.sign, m.vertex!), GoBoard.fromDimensions(N))
/** A stored move at the walk's end, as shown, and back. */
export const shownAt = (w: Walk, o: Orient, m: string): Vertex => sym(compose(o.k, frame(w)), point(m))
export const storedAt = (w: Walk, o: Orient, v: Vertex) => code(sym(invert(compose(o.k, frame(w))), v))
/** A stored move in the root's frame (extra stones are kept that way). */
export const rooted = (w: Walk, m: string) => code(sym(frame(w), point(m)))
export const isTenuki = (db: JosekiDb, m: string) => !isFuseki(db) && !REGION(point(m))
/** The corner shown, as [x0, y0, x1, y1]; the fuseki shows the whole board. */
export function focus(db: JosekiDb, o: Orient): [number, number, number, number] | null {
  if (isFuseki(db)) return null
  const [a, b] = [sym(o.k, [7, 0]), sym(o.k, [18, 11])]
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
}

export type Tone = 'best' | 'ok' | 'mistake'
export const tone = (loss: number): Tone => loss <= 0.5 ? 'best' : loss <= 1 ? 'ok' : 'mistake'
/** Again past 1 point (or off the tree), Hard past ½, else Good. */
export const grade = (loss: number | undefined): Rating => loss === undefined || loss > 1 ? 1 : loss > 0.5 ? 2 : 3
/** Answers worth Good or Hard. */
export const accepted = (db: JosekiDb, n: number) => db.nodes[n].e.flatMap((e, i) => e[2] <= 10 ? [i] : [])
/**
 * A card: a position with one to three right answers (mirror twins count once). The fuseki's openings are close in value
 * (a dozen moves within a point is common), so there any book move within a point answers: stay in the book.
 */
export function isCard(db: JosekiDb, n: number) {
  const k = new Set(accepted(db, n).map(i => db.nodes[n].e[i][1])).size
  return k >= 1 && (k <= 3 || isFuseki(db))
}

/** Up to `max` moves (root frame) of the best local line from a node, ending in KataGo's own line where the tree stops. */
export function continuation(db: JosekiDb, n: number, f: number, max = 8): string[] {
  const out: string[] = []
  while (out.length < max) {
    const x = db.nodes[n], e = x.e.find(e => !isTenuki(db, e[0]))
    if (!x.e.length) for (let i = 0; i < (x.pv?.length ?? 0) && out.length < max; i += 2) out.push(code(sym(f, point(x.pv!.slice(i, i + 2)))))
    if (!e) break
    out.push(code(sym(f, point(e[0]))))
    n = e[1]; f = through(f, e)
  }
  return out
}

/** The opponent: one of the node's moves, drawn by how often players of profile p play it. */
export function sample(db: JosekiDb, n: number, p: number, rand: () => number) {
  const e = db.nodes[n].e, tot = e.reduce((a, x) => a + x[3][p], 0)
  if (!tot) return 0 // edges are sorted by loss: the best
  let r = rand() * tot
  for (let i = 0; i < e.length; i++) if ((r -= e[i][3][p]) < 0) return i
  return e.length - 1
}

/** The likeliest way to each node at profile p (R = reach(db)). */
export function pathTo(db: JosekiDb, R: number[][], p: number, target: number): Path {
  const best = db.nodes.map(() => ({ s: -1, from: -1, pick: -1 }))
  db.nodes.forEach((x, i) => x.e.forEach((e, j) => { const s = R[i][p] * e[3][p]; if (s > best[e[1]].s) best[e[1]] = { s, from: i, pick: j } }))
  const picks: number[] = []
  for (let n = target; ;) {
    const root = db.roots.findIndex(r => r.node === n)
    if (root >= 0) return { root, picks: picks.reverse() }
    picks.push(best[n].pick); n = best[n].from
  }
}

/** Moves played to reach each node (the roots are 1). */
export function plies(db: JosekiDb): number[] {
  const out = db.nodes.map(() => 0)
  for (const r of db.roots) out[r.node] = 1
  db.nodes.forEach((x, i) => { for (const e of x.e) out[e[1]] ||= out[i] + 1 }) // nodes are sorted by ply
  return out
}
/**
 * What to practise next: the most overdue card, else the most common new one while today's quota lasts. side (the
 * fuseki's random colour): new cards where that colour plays come first, 0 = Black (an even number of moves played).
 */
export function nextCard(db: JosekiDb, R: number[][], p: number, cards: Record<string, Card>, fresh: number, now: number, side?: 0 | 1): number | null {
  let due: number | null = null
  const news: number[] = []
  db.nodes.forEach((x, i) => {
    if (!isCard(db, i)) return
    const c = cards[x.k]
    if (!c) news.push(i)
    else if (c.due <= now && (due === null || c.due < cards[db.nodes[due].k].due)) due = i
  })
  if (due !== null || fresh >= NEW_PER_DAY) return due
  const ply = side === undefined ? null : plies(db), off = (n: number) => ply && ply[n] % 2 !== side ? 1 : 0
  return news.sort((a, b) => off(a) - off(b) || R[b][p] - R[a][p])[0] ?? null
}
/** How many cards are due and still new today. */
export function counts(db: JosekiDb, cards: Record<string, Card>, fresh: number, now: number) {
  const due = db.nodes.filter((x, i) => cards[x.k] && cards[x.k].due <= now && isCard(db, i)).length
  return { due, fresh: Math.max(0, NEW_PER_DAY - fresh) }
}

/**
 * A practice line. ask: the learner's turn; reply: the opponent's; wrong / end: over. extra: stones shown past the
 * path (a wrong answer, then whatever was replayed); more: the line "See the punishment" or the continuation replays.
 * dev: the points the opponent's last move gave away, when it left the book.
 */
export interface Line {
  path: Path; o: Orient; answers: number; phase: 'ask' | 'reply' | 'wrong' | 'end'
  extra: string[]; more: string[]; dev: number | null; last: { rating: Rating; card: string | null } | null
}
export const MAX_ANSWERS = 8

/** At an unexpanded node the line ends with KataGo's continuation, unless the opponent just went off-book there. */
function settle(db: JosekiDb, l: Line): Line {
  const w = walk(db, l.path), x = db.nodes[node(w)]
  if (x.e.length || (l.dev !== null && x.pv)) return { ...l, phase: 'ask' }
  return { ...l, phase: 'end', more: continuation(db, node(w), frame(w)) }
}
export const startLine = (db: JosekiDb, path: Path, o: Orient): Line =>
  settle(db, { path, o, answers: 0, phase: 'ask', extra: [], more: [], dev: null, last: null })

/** The learner plays v (or tenuki, the stone the tree keeps for playing elsewhere). */
export function answer(db: JosekiDb, l: Line, v: Vertex | 'tenuki'): Line {
  const w = walk(db, l.path), n = node(w), x = db.nodes[n], m = v === 'tenuki' ? null : storedAt(w, l.o, v)
  const answers = l.answers + 1, mine = m ? [rooted(w, m)] : []
  if (!x.e.length) { // punishing a deviation the tree did not follow: KataGo's reply is the answer
    const line = continuation(db, n, frame(w)), ok = m === x.pv!.slice(0, 2)
    return { ...l, answers, phase: ok ? 'end' : 'wrong', extra: ok ? line.slice(0, 1) : mine, more: ok ? line.slice(1) : line, last: { rating: ok ? 3 : 1, card: null } }
  }
  const i = x.e.findIndex(e => m === null ? isTenuki(db, e[0]) : e[0] === m), e = x.e[i]
  const rating = grade(e && e[2] / 10), last = { rating, card: isCard(db, n) ? x.k : null }
  if (rating === 1) {
    const f = e ? through(frame(w), e) : frame(w)
    return { ...l, answers, phase: 'wrong', last, extra: e ? [rooted(w, e[0])] : mine, more: e ? continuation(db, e[1], f) : [] }
  }
  const next = settle(db, { ...l, path: { ...l.path, picks: [...l.path.picks, i] }, answers, last, dev: null, extra: [], more: [] })
  if (next.phase === 'end') return next
  return answers >= MAX_ANSWERS ? { ...next, phase: 'end', more: continuation(db, e[1], walk(db, next.path).frames.at(-1)!) } : { ...next, phase: 'reply' }
}

/** The opponent's move, at profile p. */
export function reply(db: JosekiDb, l: Line, p: number, rand: () => number): Line {
  const n = node(walk(db, l.path)), i = sample(db, n, p, rand), loss = db.nodes[n].e[i][2] / 10
  return settle(db, { ...l, path: { ...l.path, picks: [...l.path.picks, i] }, dev: loss > 1 ? loss : null })
}

/** A family: a root and Black's first approach. score: Σ reach × expected loss at p over its subtree. */
export interface Family { root: number; pick: number; reach: number; score: number }
export function programme(db: JosekiDb, R: number[][], p: number): Family[] {
  const expected = db.nodes.map(x => x.e.reduce((a, e) => a + e[3][p] / 100 * e[2] / 10, 0))
  const out: Family[] = []
  db.roots.forEach((r, root) => {
    const seen = new Set<number>()
    db.nodes[r.node].e.forEach(([m, c], pick) => {
      if (isTenuki(db, m) || seen.has(c)) return
      seen.add(c)
      let score = 0
      for (const st = [c], vis = new Set(st); st.length;) {
        const n = st.pop()!
        score += R[n][p] * expected[n]
        for (const e of db.nodes[n].e) if (!vis.has(e[1])) { vis.add(e[1]); st.push(e[1]) }
      }
      out.push({ root, pick, reach: R[c][p], score })
    })
  })
  return out.sort((a, b) => b.score - a.score)
}
