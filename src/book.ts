// Opening book for the move classification ("Théorique"): a move is book while the game follows the fuseki tree.
import type { Game } from './game'
import { loadJoseki, type JosekiDb } from './joseki/db'
import { ALL, CONTEXT, N, point, positionKey, REGION, sym } from './joseki/sym'

/** The fuseki tree; `joseki` (the corner tree) is attached by loadBook when it loads. */
export type FusekiDb = JosekiDb & { joseki?: JosekiDb }

let book: Promise<FusekiDb> | undefined
/** Both trees, fetched once on first use (shared with the trainer's loader); a missing corner tree leaves fuseki only. */
export const loadBook = (): Promise<FusekiDb> => book ??= Promise.all([loadJoseki('fuseki'), loadJoseki('joseki').catch(() => undefined)])
  .then(([f, joseki]) => ({ ...f, joseki }), e => { book = undefined; throw e })

/** A move costing more than this many points (edge loss is stored ×10) leaves the book. */
const MAX_LOSS = 12
const indexes = new WeakMap<FusekiDb, Map<string, number>>()

/**
 * Per move index: true while every move so far is a book move. Only an even 19×19 game from the empty board, Black
 * first, qualifies; a pass, a setup node or one move off the tree ends the book for the rest of the game.
 */
export function bookMoves(game: Game, db: FusekiDb): boolean[] {
  const out = game.moves.map(() => false)
  const b0 = game.boards[0]
  if (game.info.size !== 19 || game.moves[0]?.sign !== 1 || b0.signMap.some(row => row.some(s => s))) return out
  const byKey = keysOf(db)
  let at: number | undefined // node before move i (undefined before the first move: the roots)
  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i], b = game.boards[i + 1]
    if (m.setup || !m.vertex || !b) break
    const next = byKey.get(positionKey(b.signMap, i + 1, ALL))
    if (next === undefined) break
    // the child may be reached by a symmetric twin of the played move: same position, same loss
    const ok = at === undefined ? db.roots.some(r => r.node === next) : db.nodes[at].e.some(e => e[1] === next && e[2] <= MAX_LOSS)
    if (!ok) break
    out[i] = true
    at = next
  }
  if (db.joseki) corners(game, db.joseki, out)
  return out
}

const keysOf = (db: JosekiDb) => {
  let m = indexes.get(db)
  if (!m) indexes.set(db, m = new Map(db.nodes.map((n, i) => [n.k, i])))
  return m
}
const context = Array.from({ length: N }, () => Array<number>(N).fill(0))
CONTEXT.forEach((c, i) => { const [x, y] = point(c); context[y][x] = i % 2 ? -1 : 1 })

/**
 * Corner joseki, marked into out: each corner seen through the symmetry k that brings it to the stored top-right region,
 * rebuilt on the tree's own board (its context stones, the corner's stones, colours set so its first stone is White) and
 * looked up whole. A corner leaves the book for good at its first stone off the tree (or a tenuki, a capture: the
 * stored tenuki stones and the stone count stop matching), so it never matches with a stone the tree position lacks.
 * shortcut: the rest of the game board is ignored, as the tree's own context is fixed; the joseki holds no tenuki line.
 */
function corners(game: Game, db: JosekiDb, out: boolean[]) {
  const byKey = keysOf(db), roots = new Set(db.roots.map(r => r.node))
  for (const k of [0, 1, 2, 3]) { // 1 flips x, 2 flips y: the four corners
    const inv = k // flips are their own inverse
    let at: number | undefined, swap = 0, n = 0
    for (let i = 0; i < game.moves.length; i++) {
      const m = game.moves[i]
      if (m.setup || !m.vertex) break
      if (!REGION(sym(k, m.vertex))) continue
      if (n === 0) swap = m.sign === 1 ? -1 : 1 // the tree's root stone is White
      const b = context.map(r => [...r]), signs = game.boards[i + 1].signMap
      let stones = 0
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const [gx, gy] = sym(inv, [x, y])
        if (REGION([x, y]) && signs[gy][gx]) { b[y][x] = signs[gy][gx] * swap; stones++ }
      }
      n++
      const next = stones === n ? byKey.get(positionKey(b, n)) : undefined
      const ok = next !== undefined && (at === undefined ? roots.has(next) : db.nodes[at].e.some(e => e[1] === next && e[2] <= MAX_LOSS))
      if (!ok) break
      out[i] = true
      at = next
    }
  }
}
