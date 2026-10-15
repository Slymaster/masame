// The mentor: after each of the player's moves against the AI, a quick read of what the move cost; a move that costs the
// threshold or more stops the game until the player tries again or keeps it. Driven through `ask` (tested with a fake).
import type { Game, GameNode } from './game'
import type { Analysis } from './katago'
import { scanQuery } from './review'

/** Points a move may cost before the mentor stops it: 2 on 9×9, 3 on 13×13, 4 on 19×19 (not configurable). */
export const threshold = (size: number) => (size <= 9 ? 2 : size <= 13 ? 3 : 4)
/** The mentor adds at most this long (ms) to a move; past it the move passes unexamined. */
export const BUDGET = 1000
/** 100 visits, each search at most 0.5 s: the position before the move is usually read while the player thinks. */
export const MENTOR_QUERY = scanQuery(240)
/** A move the search before it never looked at is judged by comparing two short searches, only when each read at least this much. */
export const MIN_VISITS = 30

export type Read = Pick<Analysis, 'scoreLead' | 'moves'>
const visits = (a: Read) => a.moves.reduce((s, c) => s + c.visits, 0)

export class Mentor {
  /** How many times the mentor stopped the player in this game. */
  stops = 0
  private reads = new WeakMap<GameNode, Promise<Read>>() // the search of each position
  private checks = new WeakMap<GameNode, Promise<number | null>>() // per move: its cost when it stopped, else null

  /** `ask`: the search of the position shown by the game it is given (Black's leads). */
  constructor(private ask: (g: Game) => Promise<Read>, private budget = BUDGET) {}

  private read(g: Game, i: number) {
    const n = g.nodes[i]
    let p = this.reads.get(n)
    if (!p) { p = this.ask(g.branch(i)); p.catch(() => {}); this.reads.set(n, p) }
    return p
  }

  /** Reads the position shown at the end of the line, while the player thinks. */
  prefetch(g: Game) { void this.read(g, g.cursor) }

  /**
   * What move `i` cost its player. Read inside the one search before it when the engine looked at the move (its best
   * move costs 0); otherwise the searches before and after are compared, and only when both read enough, else null.
   */
  private async cost(g: Game, i: number): Promise<number | null> {
    const m = g.moves[i - 1], v = m.vertex!, same = (c: Read['moves'][number]) => c.v?.[0] === v[0] && c.v?.[1] === v[1]
    const first = this.read(g, i - 1), later = this.read(g, i) // asked at once: both fit the budget only side by side
    const before = await first, mine = before.moves.find(same)
    if (mine) return m.sign * (before.moves[0].scoreLead - mine.scoreLead)
    if (visits(before) < MIN_VISITS) return null
    const after = await later
    return visits(after) < MIN_VISITS ? null : m.sign * (before.scoreLead - after.scoreLead)
  }

  /**
   * The points the move leading to the shown position cost its player when they reach the threshold (counted once as a
   * stop), else null: under it, a pass, kept, or not read within the budget. Asked again, a move gets the same answer.
   */
  check(g: Game): Promise<number | null> {
    const i = g.cursor, n = g.nodes[i], m = g.moves[i - 1]
    let c = this.checks.get(n)
    if (c) return c
    c = !m?.vertex ? Promise.resolve(null) : Promise.race([
      this.cost(g, i),
      new Promise<null>(r => setTimeout(r, this.budget, null)),
    ]).then(loss => {
      if (loss === null || loss < threshold(g.info.size)) return null
      this.stops++
      return loss
    }, () => null) // the engine failed: the move passes
    this.checks.set(n, c)
    return c
  }

  /** "Keep": the stopped move stands and is never examined again. */
  keep(n: GameNode) { this.checks.set(n, Promise.resolve(null)) }
}
