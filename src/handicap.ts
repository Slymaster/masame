// Handicap against the bot: GTP fixed placement and a proposal from the rank gap.
import { RANKS } from './bot'
import type { Vertex } from './game'

/** GTP fixed handicap: corners, then (odd counts) tengen, then side points; y = 0 is the top. */
export function handicapStones(size: number, n: number): Vertex[] {
  if (n < 2) return []
  const e = size >= 13 ? 3 : 2, f = size - 1 - e, m = (size - 1) / 2
  const s: Vertex[] = [[e, f], [f, e], [e, e], [f, f]].slice(0, n) as Vertex[]
  if (n >= 6) s.push([e, m], [f, m])
  if (n >= 8) s.push([m, f], [m, e])
  if (n >= 5 && n % 2) s.push([m, m])
  return s
}

/** Stones for the rank gap (the bot stronger), scaled by board area like resignFrom; fewer than 2 is none. */
export function proposeHandicap(myRank: string, aiRank: string, size: number): number {
  const n = Math.round(((RANKS.indexOf(aiRank) - RANKS.indexOf(myRank)) * size * size) / 361)
  return n < 2 ? 0 : Math.min(9, n)
}

/** One step through 0, 2…9 (a single stone is no handicap). */
export const stepHandicap = (h: number, d: number) => Math.min(9, Math.max(0, h + d === 1 ? h + 2 * d : h + d))
