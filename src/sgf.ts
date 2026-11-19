import * as sgf from '@sabaki/sgf'
import type { SgfNode } from '@sabaki/sgf'
import { round1 } from './scoring'
import { Game, type GameNode, type Sign, type Vertex } from './game'
import { LocalizedError } from './i18n'

import { version } from '../package.json'

/** Characters; far beyond any game record. The Rust side caps the files the OS opens at the same figure, in bytes. */
export const MAX_SGF = 5 * 1024 * 1024

// Refuse a lossy decode before the editor could save replacement characters over the original names or notes.
export function decodeSgf(bytes: Uint8Array | ArrayBuffer): string {
  if (bytes.byteLength > MAX_SGF) throw new LocalizedError(d => d.sgfTooBig)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new LocalizedError(d => d.failures.open_encoding) }
}

const vertices = (values: string[] = []) => values.filter(Boolean).flatMap(v => sgf.parseCompressedVertices(v))
const signOf = (pl?: string): Sign | undefined => (pl === 'W' ? -1 : pl === 'B' ? 1 : undefined)

// Only the displayed game is edited. Keep the other games in their original text, including
// properties and board shapes that the editor does not interpret.
const collections = new WeakMap<Game, { count: number; rest: string }>()
export const sgfGameCount = (game: Game) => collections.get(game)?.count ?? 1

function collectionTail(text: string): string {
  let depth = 0
  for (const token of sgf.tokenizeIter(text)) {
    if (token.type !== 'parenthesis') continue
    if (token.value === '(') depth++
    else if (--depth === 0) return text.slice(token.pos + 1).trimStart()
  }
  throw new LocalizedError(l => l.sgfNotGame)
}

/** The whole tree: B/W become moves, AE/AB/AW setup stones, any other node a pseudo-move keeping (or setting, with PL) the side to play. */
export function loadSgf(text: string): Game {
  const roots = sgf.parse(text), root = roots[0]
  if (!root) throw new LocalizedError(l => l.sgfEmpty)
  const d = root.data
  if (!Object.keys(d).length) throw new LocalizedError(l => l.sgfNotGame)
  if (d.GM && d.GM[0] !== '1') throw new LocalizedError(l => l.sgfNotGo)
  const shape = d.SZ?.[0] ?? '19'
  const dimensions = /^(\d+)(?::(\d+))?$/.exec(shape)
  const size = dimensions ? Number(dimensions[1]) : NaN
  if (!(size >= 2 && size <= 25) || (dimensions?.[2] && Number(dimensions[2]) !== size)) {
    throw new LocalizedError(l => l.sgfBadSize(shape))
  }
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

  const game = Game.fromTree({
    size, komi: Number.isFinite(komi) ? komi : 6.5,
    playerBlack: d.PB?.[0] ?? '', playerWhite: d.PW?.[0] ?? '', setup, firstSign, result: d.RE?.[0] || undefined,
    rules: d.RU?.[0],
  }, tree)
  if (roots.length > 1) collections.set(game, { count: roots.length, rest: collectionTail(text) })
  return game
}

/** Every node's properties as read (comments, marks, unknown ones), with the root's game info and each move from the tree. */
export function saveSgf(game: Game): string {
  const { size, komi, playerBlack, playerWhite, setup, firstSign, result } = game.info
  const placed = setup.black.length || setup.white.length
  const data: Record<string, string[]> = {
    ...game.root.data, GM: ['1'], FF: ['4'], CA: ['UTF-8'], AP: [`Masame:${version}`], SZ: [String(size)], KM: [String(komi)],
    PB: [playerBlack], PW: [playerWhite], RE: [result ?? ''], AB: setup.black.map(sgf.stringifyVertex), AW: setup.white.map(sgf.stringifyVertex),
    PL: placed || firstSign === -1 || game.root.data.PL ? [firstSign === 1 ? 'B' : 'W'] : [],
    ...game.info.rules && { RU: [game.info.rules] },
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
  return sgf.stringify([out]) + (collections.get(game)?.rest ?? '')
}

/** SGF RE values: a counted game ("B+3.5", "W+0.5", "0" for a draw) or a resignation ("W+R"). */
export const scoreResult = (lead: number) => (round1(lead) === 0 ? '0' : `${lead > 0 ? 'B' : 'W'}+${Math.abs(round1(lead))}`)
export const resignResult = (winner: Sign) => `${winner === 1 ? 'B' : 'W'}+R`
export const timeResult = (winner: Sign) => `${winner === 1 ? 'B' : 'W'}+T`
/** RE read back: who won and how ('' when RE says no more, as "B+" or "?"); a draw is a score of 0, "Void" a cancelled game. */
export const readResult = (re: string): { winner: Sign | 0; how: string; points?: number } => {
  const r = re.trim(), m = /^([BW])\+(.*)$/i.exec(r)
  if (!m) return /^(0|draw|jigo)$/i.test(r) ? { winner: 0, how: 'score', points: 0 } : { winner: 0, how: /^void$/i.test(r) ? 'cancel' : '' }
  const winner = m[1].toUpperCase() === 'B' ? 1 : -1, x = m[2].toUpperCase()
  return x[0] === 'R' ? { winner, how: 'resign' } : x[0] === 'T' ? { winner, how: 'time' } : x[0] === 'F' ? { winner, how: 'forfeit' }
    : x && Number.isFinite(+x) ? { winner, how: 'score', points: +x } : { winner, how: '' }
}
