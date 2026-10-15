// The position editor's board: stones placed by hand, then a Game whose setup they are (SGF AB/AW, PL for the side to play).
import { Game, type Sign, type Vertex } from '../game'

export type Stones = Sign[][]
export const empty = (n: number): Stones => Array.from({ length: n }, () => Array<Sign>(n).fill(0))

/** A click with the tool (1 Black, -1 White, 0 erase); shift places the other colour. Clicking a stone of that colour removes it. */
export function edit(map: Stones, [x, y]: Vertex, tool: Sign, shift = false): Stones {
  const c = (shift ? -tool : tool) as Sign
  const next = map.map(row => [...row])
  next[y][x] = map[y][x] === c ? 0 : c
  return next
}

/** Another size: the stones that still fit stay. */
export const resize = (map: Stones, n: number): Stones => Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => map[y]?.[x] ?? 0))

/** The position as a game with no move yet: its stones as setup, `toPlay` moves first. */
export function toGame(map: Stones, toPlay: Sign): Game {
  const black: Vertex[] = [], white: Vertex[] = []
  map.forEach((row, y) => row.forEach((c, x) => { if (c) (c === 1 ? black : white).push([x, y]) }))
  return new Game({ size: map.length, setup: { black, white }, firstSign: toPlay })
}
