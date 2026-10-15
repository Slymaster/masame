// The mentor: after each of the player's moves against the AI, a quick read of what the move cost; a move that costs the
// threshold or more stops the game until the player tries again or keeps it. Driven through `ask` (tested with a fake).
import type { Game, GameNode } from './game'
import type { Analysis } from './katago'

/** Points a move may cost before the mentor stops it: 2 on 9×9, 3 on 13×13, 4 on 19×19 (not configurable). */
export const threshold = (size: number) => (size <= 9 ? 2 : size <= 13 ? 3 : 4)
/** The mentor adds at most this long (ms) to a move; past it the move passes unexamined. */
export const BUDGET = 1000
/** 100 visits, the search after the move at most 0.75 s so it fits the budget. Below the AI's own query: a search given
 * up at the budget yields to it. */
export const MENTOR_QUERY = { maxVisits: 100, overrideSettings: { maxTime: 0.75 }, priority: -1 }
/** The position before the move, read while the player thinks: it has the time to reach its visits. */
export const MENTOR_WARM_QUERY = { ...MENTOR_QUERY, overrideSettings: { maxTime: 5 } }
/** A move whose position before was never read while the player thought (a game restored or resumed on a stopped move)
 * gets this long: the engine may be starting, and the stop must hold again. */
export const COLD_BUDGET = 10_000
/** A move the search before it never looked at is judged by comparing two short searches, only when each read at least this much. */
export const MIN_VISITS = 30

export type Read = Pick<Analysis, 'scoreLead' | 'moves'>
const visits = (a: Read) => a.moves.reduce((s, c) => s + c.visits, 0)

export class Mentor {
  /** How many times the mentor stopped the player in this game. */
  stops = 0
  /** Checks given up at the budget in a row (the engine is too busy); an answer in time resets it. */
  late = 0
  private reads = new WeakMap<GameNode, Promise<Read>>() // the search of each position
  private checks = new WeakMap<GameNode, Promise<number | null>>() // per move: its cost when it stopped, else null

  /** `ask`: the search of the position shown by the game it is given (Black's leads); `warm` while the player thinks. */
  constructor(private ask: (g: Game, warm: boolean) => Promise<Read>, private budget = BUDGET, private coldBudget = COLD_BUDGET) {}

  private read(g: Game, i: number, warm = false) {
    const n = g.nodes[i]
    let p = this.reads.get(n)
    if (!p) { p = this.ask(g.branch(i), warm); p.catch(() => {}); this.reads.set(n, p) }
    return p
  }

  /** Reads the position shown at the end of the line, while the player thinks. */
  prefetch(g: Game) { void this.read(g, g.cursor, true) }

  /**
   * What move `i` cost its player. Read inside the one search before it when the engine looked at the move (its best
   * move costs 0); otherwise the searches before and after are compared, and only when both read enough, else 'late'
   * (the engine too busy to judge: the player is told, as for a search past the budget).
   */
  private async cost(g: Game, i: number): Promise<number | 'late'> {
    const m = g.moves[i - 1], v = m.vertex!, same = (c: Read['moves'][number]) => c.v?.[0] === v[0] && c.v?.[1] === v[1]
    const first = this.read(g, i - 1), later = this.read(g, i) // asked at once: both fit the budget only side by side
    const before = await first, mine = before.moves.find(same)
    if (mine) return m.sign * (before.moves[0].scoreLead - mine.scoreLead)
    if (visits(before) < MIN_VISITS) return 'late'
    const after = await later
    return visits(after) < MIN_VISITS ? 'late' : m.sign * (before.scoreLead - after.scoreLead)
  }

  /**
   * The points the move leading to the shown position cost its player when they reach the threshold (counted once as a
   * stop), else null: under it, a pass, kept, or not read enough within the budget (then `late` counts it). Asked again, a move gets the same answer.
   */
  check(g: Game): Promise<number | null> {
    const i = g.cursor, n = g.nodes[i], m = g.moves[i - 1]
    let c = this.checks.get(n)
    if (c) return c
    const cold = i > 0 && !this.reads.has(g.nodes[i - 1])
    c = !m?.vertex ? Promise.resolve(null) : Promise.race([
      this.cost(g, i),
      new Promise<'late'>(r => setTimeout(r, cold ? this.coldBudget : this.budget, 'late')),
    ]).then(loss => {
      this.late = loss === 'late' ? this.late + 1 : 0
      if (loss === 'late' || loss < threshold(g.info.size)) return null
      if (!cold) this.stops++ // a cold stop is one counted before the game was closed (the entry's count comes back)
      return loss
    }, () => null) // the engine failed: the move passes
    this.checks.set(n, c)
    return c
  }

  /** "Keep": the stopped move stands and is never examined again. */
  keep(n: GameNode) { this.checks.set(n, Promise.resolve(null)) }
}
