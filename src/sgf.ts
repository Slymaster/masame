import * as sgf from '@sabaki/sgf'
import type { SgfNode } from '@sabaki/sgf'
import { round1 } from './scoring'
import { Game, type Move, type Sign, type Vertex } from './game'
import { LocalizedError } from './i18n'

const vertices = (values: string[] = []) => values.flatMap(v => sgf.parseCompressedVertices(v))

/** shortcut: reads the main line only (first child at each node) and ignores setup stones after the root; upgrade with the variations tree. */
export function loadSgf(text: string): Game {
  const root = sgf.parse(text)[0]
  if (!root) throw new LocalizedError(l => l.sgfEmpty)
  const d = root.data
  if (!Object.keys(d).length) throw new LocalizedError(l => l.sgfNotGame)
  const size = parseInt(d.SZ?.[0] ?? '19', 10)
  if (!(size >= 2 && size <= 25)) throw new LocalizedError(l => l.sgfBadSize(d.SZ?.[0]))
  const komi = parseFloat(d.KM?.[0] ?? '')
  const setup = { black: vertices(d.AB), white: vertices(d.AW) }
  for (const [x, y] of [...setup.black, ...setup.white]) {
    if (x < 0 || y < 0 || x >= size || y >= size) throw new LocalizedError(l => l.sgfSetupOff)
  }

  const moves: Move[] = []
  for (let n: SgfNode | undefined = root; n; n = n.children[0]) {
    for (const [key, sign] of [['B', 1], ['W', -1]] as const) {
      const v = n.data[key]?.[0]
      if (v === undefined) continue
      // Empty value is a pass; "tt" is the legacy pass on boards up to 19×19.
      const pass = v === '' || (v === 'tt' && size <= 19)
      const vertex: Vertex | null = pass ? null : sgf.parseVertex(v)
      if (vertex && (vertex[0] < 0 || vertex[1] < 0 || vertex[0] >= size || vertex[1] >= size)) throw new LocalizedError(l => l.sgfMoveOff(v))
      moves.push({ sign, vertex })
    }
  }

  const pl = d.PL?.[0]
  const firstSign: Sign = pl === 'W' ? -1 : pl === 'B' ? 1 : moves[0] ? moves[0].sign : setup.black.length > 0 && setup.white.length === 0 ? -1 : 1
  return Game.fromRecord({
    size, komi: Number.isFinite(komi) ? komi : 6.5,
    playerBlack: d.PB?.[0] ?? '', playerWhite: d.PW?.[0] ?? '', setup, firstSign, result: d.RE?.[0] || undefined,
  }, moves)
}

export function saveSgf(game: Game): string {
  const { size, komi, playerBlack, playerWhite, setup, firstSign, result } = game.info
  const data: Record<string, string[]> = { GM: ['1'], FF: ['4'], CA: ['UTF-8'], AP: ['Masame:0.1'], SZ: [String(size)], KM: [String(komi)] }
  if (playerBlack) data.PB = [playerBlack]
  if (playerWhite) data.PW = [playerWhite]
  if (result) data.RE = [result]
  if (setup.black.length) data.AB = setup.black.map(sgf.stringifyVertex)
  if (setup.white.length) data.AW = setup.white.map(sgf.stringifyVertex)
  if (setup.black.length || setup.white.length) data.PL = [firstSign === 1 ? 'B' : 'W']
  const root: SgfNode = { data, children: [] }
  let tail = root
  for (const m of game.moves) {
    const node: SgfNode = { data: { [m.sign === 1 ? 'B' : 'W']: [m.vertex ? sgf.stringifyVertex(m.vertex) : ''] }, children: [] }
    tail.children.push(node)
    tail = node
  }
  return sgf.stringify([root])
}

/** SGF RE values: a counted game ("B+3.5", "W+0.5", "0" for a draw) or a resignation ("W+R"). */
export const scoreResult = (lead: number) => (round1(lead) === 0 ? '0' : `${lead > 0 ? 'B' : 'W'}+${Math.abs(round1(lead))}`)
export const resignResult = (winner: Sign) => `${winner === 1 ? 'B' : 'W'}+R`
