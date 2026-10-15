// "Rejouer de mémoire": the game's moves placed again in order, both sides, from the empty board (handicap and setup
// stones kept). A wrong move is refused; a second wrong try on the same move shows it and counts as a help. Pure.
import type { Game, Vertex } from '../game'

/** k: moves of the record placed so far (pseudo-moves included); fails: wrong tries on move k. */
export interface Run { k: number; fails: number; recalled: number; helps: number }
export type Try = 'right' | 'wrong' | 'help' | 'over'

const same = (a: Vertex | null, b: Vertex | null) => a === b || !!a && !!b && a[0] === b[0] && a[1] === b[1]
/** Setup pseudo-moves (AB/AW inside the record) are placed by themselves: only real moves are asked. */
const skip = (g: Game, k: number) => { while (g.moves[k]?.setup) k++; return k }

/** The real moves of the record: what the score counts. */
export const total = (g: Game) => g.moves.filter(m => !m.setup).length
export const begin = (g: Game): Run => ({ k: skip(g, 0), fails: 0, recalled: 0, helps: 0 })
export const over = (g: Game, r: Run) => r.k >= g.moves.length
/** At least one move placed (found or helped): before that, leaving keeps nothing (setup nodes may start k past 0). */
export const replayed = (r: Run) => r.recalled + r.helps > 0
/** The move asked now (null: a pass), undefined once the record is done. */
export const expected = (g: Game, r: Run) => (over(g, r) ? undefined : g.moves[r.k].vertex)

/** One try at the asked move: right (found, a first wrong try forgiven), wrong (once), or help (the second wrong try). */
export function attempt(g: Game, r: Run, v: Vertex | null): [Try, Run] {
  if (over(g, r)) return ['over', r]
  if (same(g.moves[r.k].vertex, v)) return ['right', { k: skip(g, r.k + 1), fails: 0, recalled: r.recalled + 1, helps: r.helps }]
  if (r.fails === 0) return ['wrong', { ...r, fails: 1 }]
  return ['help', { k: skip(g, r.k + 1), fails: 0, recalled: r.recalled, helps: r.helps + 1 }]
}

/** The best of two runs on the same game: more moves found, then fewer helps. */
export const better = (a: { recalled: number; helps: number } | undefined, b: { recalled: number; helps: number }) =>
  !a || b.recalled > a.recalled || b.recalled === a.recalled && b.helps < a.helps
