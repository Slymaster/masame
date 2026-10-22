import { describe, expect, it } from 'vitest'
import { bookMoves, type FusekiDb } from './book'
import { Game, type Move } from './game'
import { reach, validate, type JosekiDb } from './joseki/db'
import { pathTo, position, shown, walk } from './joseki/practice'
import { point, REGION, sym } from './joseki/sym'
import { loadSgf } from './sgf'
import raw from '../public/assets/joseki/fuseki.v1.json'
import josekiRaw from '../public/assets/joseki/joseki.v1.json'
import index from '../public/assets/classics/index.json'

const db: FusekiDb = { ...validate(structuredClone(raw)), family: 'fuseki' }
const joseki: JosekiDb = validate(structuredClone(josekiRaw))
const both: FusekiDb = { ...db, joseki }
const files = import.meta.glob('../public/assets/classics/*.sgf', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const moves = (line: string, k = 0): Move[] =>
  line.split(' ').map((c, i) => ({ sign: i % 2 ? -1 : 1, vertex: c === 'tt' ? null : sym(k, point(c)) }))
const game = (line: string, k = 0, info: { size?: number; setup?: { black: [number, number][]; white: [number, number][] } } = {}) =>
  Game.fromRecord({ size: 19, ...info }, moves(line, k))
const count = (b: boolean[]) => b.filter(Boolean).length

// four star points, then a Chinese-style approach: all common openings
const OPENING = 'pd dp pp dd'

describe('the opening book', () => {
  it('keeps a standard fuseki in the book for its known plies', () => {
    expect(bookMoves(game(OPENING), db)).toEqual([true, true, true, true])
  })
  it('ends the book at the first move off the tree, for the rest of the game', () => {
    // 2: tengen answers a 4-4 corner... off any book line; the later 4-4 does not bring the book back
    const b = bookMoves(game('pd jj dp pp dd'), db)
    expect(b[0]).toBe(true)
    expect(b.slice(1)).toEqual([false, false, false, false])
  })
  it('stays book under every rotation and mirror of the board', () => {
    for (let k = 0; k < 8; k++) expect(bookMoves(game(OPENING, k), db)).toEqual([true, true, true, true])
  })
  it('never applies to small boards, handicap or setup positions, or after a pass', () => {
    expect(count(bookMoves(Game.fromRecord({ size: 13 }, [{ sign: 1, vertex: [9, 3] }, { sign: -1, vertex: [3, 9] }]), db))).toBe(0)
    expect(count(bookMoves(Game.fromRecord({ size: 9 }, [{ sign: 1, vertex: [6, 2] }]), db))).toBe(0)
    expect(count(bookMoves(game('dp pp dd', 0, { setup: { black: [[15, 3]], white: [] } }), db))).toBe(0)
    // White first (a handicap-style record without the stones)
    expect(count(bookMoves(Game.fromRecord({ size: 19 }, moves(OPENING).map(m => ({ ...m, sign: -m.sign as 1 | -1 }))), db))).toBe(0)
    const p = bookMoves(game('pd tt dp pp'), db)
    expect(p).toEqual([true, false, false, false])
  })
  it('reports how long the classics stay in the book', () => {
    const games = index.map(c => loadSgf(files[`../public/assets/classics/${c.file}`]))
    const plies = games.map(g => { const b = bookMoves(g, db); return b.indexOf(false) < 0 ? b.length : b.indexOf(false) })
    const corner = games.map(g => count(bookMoves(g, both)) - count(bookMoves(g, db)))
    console.log('corner moves at:', games.map(g => bookMoves(g, both).flatMap((x, i) => x ? [i + 1] : []).join(',')).join(' | '))
    console.log('classics in fuseki book (plies):', plies.join(' '), '| extra corner joseki moves:', corner.join(' '))
    expect(plies.length).toBe(21)
    expect(plies.some(n => n > 0)).toBe(true)
    expect(corner.every(n => n >= 0)).toBe(true)
  })
})

describe('corner joseki', () => {
  // a real stored line: the most common way to reach the deepest node played wholly in the corner, without a capture
  const R = reach(joseki), P = joseki.profiles.length - 1
  const lines = joseki.nodes.map((_, i) => walk(joseki, pathTo(joseki, R, P, i)))
  const line = lines
    .filter(w => w.moves.every(m => REGION(point(m))) && position(shown(w.moves, { k: 0, swap: false }, [])).signMap.flat().filter(Boolean).length === w.moves.length
      && w.nodes.every((n, j) => !j || joseki.nodes[w.nodes[j - 1]].e.some(e => e[1] === n && e[2] <= 12)))
    .sort((a, b) => b.moves.length - a.moves.length)[0]
  const corner = (k: number, before: Move[] = [], swap = false) => Game.fromRecord({ size: 19 }, [...before, ...shown(line.moves, { k, swap }, [])])

  it('follows a stored joseki in every corner and both reflections', () => {
    expect(line.moves.length).toBeGreaterThanOrEqual(6)
    for (let k = 0; k < 8; k++) expect(bookMoves(corner(k), both)).toEqual(line.moves.map(() => true))
    expect(count(bookMoves(corner(0), db))).toBeLessThan(line.moves.length) // the fuseki alone does not hold it
  })
  it('follows it with White starting the corner, after other corners were taken', () => {
    // Black takes a lower corner first, so White plays the stored line's first stone
    const g = Game.fromRecord({ size: 19 }, [{ sign: 1, vertex: [3, 15] }, ...shown(line.moves, { k: 0, swap: true }, [])])
    expect(bookMoves(g, both).slice(1)).toEqual(line.moves.map(() => true))
  })
  it('stops for good when the corner holds a stone the tree lacks', () => {
    // a stray Black stone on the 2-2 point of that corner before the line starts
    const stray = sym(0, point('rb'))
    const b = bookMoves(corner(0, [{ sign: 1, vertex: [3, 15] }, { sign: -1, vertex: stray }, { sign: 1, vertex: [15, 15] }], true), both)
    expect(b.slice(3).every(x => !x)).toBe(true)
    // control: the same moves with that stone far away keep the corner in the book
    const far = bookMoves(corner(0, [{ sign: 1, vertex: [3, 15] }, { sign: -1, vertex: [3, 3] }, { sign: 1, vertex: [15, 15] }], true), both)
    expect(far.slice(3)).toEqual(line.moves.map(() => true))
  })
})
