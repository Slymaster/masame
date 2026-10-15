// The mentor: after each of the player's moves against the AI, a quick read of the score before and after; a move that
// costs the threshold or more stops the game until the player tries again or keeps it. Driven through `ask` (tested with a fake).
import type { Game, GameNode } from './game'
import { scanQuery } from './review'

/** Points a move may cost before the mentor stops it: 2 on 9×9, 3 on 13×13, 4 on 19×19 (not configurable). */
export const threshold = (size: number) => (size <= 9 ? 2 : size <= 13 ? 3 : 4)
/** The mentor adds at most this long (ms) to a move; past it the move passes unexamined. */
export const BUDGET = 1000
/** 100 visits, each search at most 0.5 s: the position before the move is usually read while the player thinks. */
export const MENTOR_QUERY = scanQuery(240)

export class Mentor {
  /** How many times the mentor stopped the player in this game. */
  stops = 0
  private leads = new WeakMap<GameNode, Promise<number>>() // Black's lead per position
  private checks = new WeakMap<GameNode, Promise<number | null>>() // per move: its cost when it stopped, else null

  /** `ask`: Black's lead in the position shown by the game it is given. */
  constructor(private ask: (g: Game) => Promise<number>, private budget = BUDGET) {}

  private lead(g: Game, i: number) {
    const n = g.nodes[i]
    let p = this.leads.get(n)
    if (!p) { p = this.ask(g.branch(i)); p.catch(() => {}); this.leads.set(n, p) }
    return p
  }

  /** Reads the position shown at the end of the line, while the player thinks. */
  prefetch(g: Game) { void this.lead(g, g.cursor) }

  /**
   * The points the move leading to the shown position cost its player when they reach the threshold (counted once as a
   * stop), else null: under it, a pass, kept, or not read within the budget. Asked again, a move gets the same answer.
   */
  check(g: Game): Promise<number | null> {
    const i = g.cursor, n = g.nodes[i], m = g.moves[i - 1]
    let c = this.checks.get(n)
    if (c) return c
    c = !m?.vertex ? Promise.resolve(null) : Promise.race([
      Promise.all([this.lead(g, i - 1), this.lead(g, i)]).then(([before, after]) => m.sign * (before - after)),
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
