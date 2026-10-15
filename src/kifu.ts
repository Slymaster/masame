// The kifu: the record as numbered diagrams, 100 moves each, as Go books print them. A move played on a point already
// shown in its diagram is listed under it ("112 at 87"); a stone from before the diagram that gets taken and played on
// again is lettered (A, B…) and named the same way.
import { drawGrid, geom } from './board/BoardView'
import type { Game, Sign, Vertex } from './game'

export const PER = 100

export interface Diagram {
  from: number; to: number // move numbers shown, 1-based and inclusive (to < from: no move, the position alone)
  start: Sign[][] // the position before the diagram's first move
  numbers: { v: Vertex; n: number; sign: Sign }[] // drawn on the board
  letters: { v: Vertex; label: string }[] // stones of `start` played on again
  notes: { n: number; at: string | null }[] // under the board: "n at <at>", a pass when at is null
}

const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

/** The shown line's moves cut into diagrams of `per` moves; a game without moves gives one diagram of its position. */
export function diagrams(game: Game, per = PER): Diagram[] {
  const out: Diagram[] = []
  let d: Diagram | null = null, shown = new Map<number, string>(), n = 0
  game.moves.forEach((m, i) => {
    if (m.setup) return
    n++
    if (!d || n > d.from + per - 1) {
      out.push(d = { from: n, to: n, start: game.boards[i].signMap, numbers: [], letters: [], notes: [] })
      shown = new Map()
    }
    d.to = n
    if (!m.vertex) return void d.notes.push({ n, at: null })
    const [x, y] = m.vertex, k = y * game.info.size + x
    let at = shown.get(k)
    if (at === undefined && d.start[y][x]) { // a stone from before this diagram, taken since
      at = LETTERS[d.letters.length % LETTERS.length]
      d.letters.push({ v: m.vertex, label: at })
      shown.set(k, at)
    }
    if (at === undefined) { d.numbers.push({ v: m.vertex, n, sign: m.sign }); shown.set(k, String(n)) }
    else d.notes.push({ n, at })
  })
  return out.length ? out : [{ from: 1, to: 0, start: game.board.signMap, numbers: [], letters: [], notes: [] }]
}

/** masame-kifu-<date>-<black>-<white>.png: names reduced to letters, digits and dashes. */
export const kifuName = (date: string, black: string, white: string) =>
  ['masame-kifu', date, black, white].map(s => s.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('-') + '.png'

// ---------- drawing: the 2D board's grid and coordinates, flat stones and numbers as in print ----------
export const PAPER = '#FCFAF5', INK = '#2A2118'

/** One diagram, S CSS px square at ratio k (S·k device px), on a transparent ground (the page's paper shows through). */
export function drawDiagram(d: Diagram, S = 800, k = 2): HTMLCanvasElement {
  const N = d.start.length, c = Object.assign(document.createElement('canvas'), { width: S * k, height: S * k }), x = c.getContext('2d')!
  x.setTransform(k, 0, 0, k, 0, 0)
  const g = geom(S, N, true, k)
  drawGrid(x, g, true)
  const r = g.r * 0.98
  const stone = ([X, Y]: Vertex, s: Sign) => {
    x.beginPath(); x.arc(g.P[X], g.P[Y], r, 0, Math.PI * 2)
    x.fillStyle = s === 1 ? '#1E1A16' : '#FFFFFF'; x.fill()
    x.lineWidth = 1.1; x.strokeStyle = '#1E1A16'; x.stroke()
  }
  const label = ([X, Y]: Vertex, s: Sign, text: string, italic = false) => {
    x.font = `${italic ? 'italic ' : ''}600 ${(g.cell * (text.length > 2 ? 0.41 : 0.5)).toFixed(1)}px Manrope, system-ui, sans-serif`
    x.fillStyle = s === 1 ? '#FFFFFF' : INK; x.textAlign = 'center'; x.textBaseline = 'middle'
    x.save(); x.translate(g.P[X], g.P[Y] + g.cell * 0.03)
    x.fillText(text, 0, 0); x.restore()
  }
  d.start.forEach((row, Y) => row.forEach((s, X) => { if (s) stone([X, Y], s) }))
  for (const { v, label: l } of d.letters) label(v, d.start[v[1]][v[0]], l, true)
  for (const { v, n, sign } of d.numbers) { stone(v, sign); label(v, sign, String(n)) }
  return c
}
