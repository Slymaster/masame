import * as sgf from '@sabaki/sgf'
import type { SgfNode } from '@sabaki/sgf'
import { round1 } from './scoring'
import { Game, type GameNode, type Sign, type Vertex } from './game'
import { LocalizedError } from './i18n'

import { version } from '../package.json'

/** Characters; far beyond any game record. The Rust side caps the files the OS opens at the same figure, in bytes. */
export const MAX_SGF = 5 * 1024 * 1024

const vertices = (values: string[] = []) => values.filter(Boolean).flatMap(v => sgf.parseCompressedVertices(v))
const signOf = (pl?: string): Sign | undefined => (pl === 'W' ? -1 : pl === 'B' ? 1 : undefined)

/** The whole tree: B/W become moves, AE/AB/AW setup stones, any other node a pseudo-move keeping (or setting, with PL) the side to play. */
export function loadSgf(text: string): Game {
  const root = sgf.parse(text)[0]
  if (!root) throw new LocalizedError(l => l.sgfEmpty)
  const d = root.data
  if (!Object.keys(d).length) throw new LocalizedError(l => l.sgfNotGame)
  const size = parseInt(d.SZ?.[0] ?? '19', 10)
  if (!(size >= 2 && size <= 25)) throw new LocalizedError(l => l.sgfBadSize(d.SZ?.[0]))
  const komi = parseFloat(d.KM?.[0] ?? '')
  const off = ([x, y]: Vertex) => x < 0 || y < 0 || x >= size || y >= size
  const setup = { black: vertices(d.AB), white: vertices(d.AW) }
  if ([...setup.black, ...setup.white].some(off)) throw new LocalizedError(l => l.sgfSetupOff)

  // a move in the root goes into a new first child
  const { B, W, ...data } = d
  const top: SgfNode[] = B || W ? [{ data: B ? { B } : { W: W! }, children: root.children }] : root.children
  let first: SgfNode | undefined = top[0]
  while (first && !first.data.B && !first.data.W) first = first.children[0]
  const firstSign: Sign = signOf(d.PL?.[0]) ?? (first ? first.data.B ? 1 : -1 : setup.black.length > 0 && setup.white.length === 0 ? -1 : 1)

  const tree: GameNode = { data, children: [] }
  const stack: [SgfNode, GameNode, Sign][] = top.map(n => [n, tree, firstSign] as [SgfNode, GameNode, Sign]).reverse()
  while (stack.length) { // no recursion: a long record would overflow the call stack
    const [s, parent, side] = stack.pop()!
    const node: GameNode = { data: s.data, children: [] }
    parent.children.push(node)
    const stones = ([['AE', 0], ['AB', 1], ['AW', -1]] as const).flatMap(([k, c]) => vertices(s.data[k]).map(v => [v, c] as [Vertex, Sign]))
    if (stones.some(([v]) => off(v))) throw new LocalizedError(l => l.sgfSetupOff)
    if (stones.length) node.stones = stones
    const key = s.data.B ? 'B' : s.data.W ? 'W' : null, v = key ? s.data[key][0] : undefined
    if (key && v !== undefined) {
      // Empty value is a pass; "tt" is the legacy pass on boards up to 19×19.
      const pass = v === '' || (v === 'tt' && size <= 19)
      const vertex: Vertex | null = pass ? null : sgf.parseVertex(v)
      if (vertex && off(vertex)) throw new LocalizedError(l => l.sgfMoveOff(v))
      node.move = { sign: key === 'B' ? 1 : -1, vertex }
    } else node.move = { sign: -(signOf(s.data.PL?.[0]) ?? side) as Sign, vertex: null, setup: true }
    for (let i = s.children.length - 1; i >= 0; i--) stack.push([s.children[i], node, -node.move.sign as Sign])
  }

  return Game.fromTree({
    size, komi: Number.isFinite(komi) ? komi : 6.5,
    playerBlack: d.PB?.[0] ?? '', playerWhite: d.PW?.[0] ?? '', setup, firstSign, result: d.RE?.[0] || undefined,
  }, tree)
}

/** Every node's properties as read (comments, marks, unknown ones), with the root's game info and each move from the tree. */
export function saveSgf(game: Game): string {
  const { size, komi, playerBlack, playerWhite, setup, firstSign, result } = game.info
  const placed = setup.black.length || setup.white.length
  const data: Record<string, string[]> = {
    ...game.root.data, GM: ['1'], FF: ['4'], CA: ['UTF-8'], AP: [`Masame:${version}`], SZ: [String(size)], KM: [String(komi)],
    PB: [playerBlack], PW: [playerWhite], RE: [result ?? ''], AB: setup.black.map(sgf.stringifyVertex), AW: setup.white.map(sgf.stringifyVertex),
    PL: placed ? [firstSign === 1 ? 'B' : 'W'] : [],
  }
  for (const k of ['PB', 'PW', 'RE', 'AB', 'AW', 'PL']) if (!data[k].filter(Boolean).length) delete data[k]
  const out: SgfNode = { data, children: [] }
  const stack: [GameNode, SgfNode][] = [[game.root, out]]
  while (stack.length) {
    const [n, s] = stack.pop()!
    for (const c of n.children) {
      const { B, W, ...rest } = c.data, m = c.move!
      const child: SgfNode = { data: m.setup ? rest : { [m.sign === 1 ? 'B' : 'W']: [m.vertex ? sgf.stringifyVertex(m.vertex) : ''], ...rest }, children: [] }
      s.children.push(child)
      stack.push([c, child])
    }
  }
  return sgf.stringify([out])
}

/** SGF RE values: a counted game ("B+3.5", "W+0.5", "0" for a draw) or a resignation ("W+R"). */
export const scoreResult = (lead: number) => (round1(lead) === 0 ? '0' : `${lead > 0 ? 'B' : 'W'}+${Math.abs(round1(lead))}`)
export const resignResult = (winner: Sign) => `${winner === 1 ? 'B' : 'W'}+R`
export const timeResult = (winner: Sign) => `${winner === 1 ? 'B' : 'W'}+T`
