import { describe, expect, it } from 'vitest'
import { Game, type Move, type Vertex } from '../game'
import { loadSgf } from '../sgf'
import { attempt, begin, better, expected, over, replayed, total, type Run, type Try } from './memory'

const rec = (vs: (Vertex | null)[]) => Game.fromRecord({ size: 9 }, vs.map((vertex, i): Move => ({ sign: i % 2 ? -1 : 1, vertex })))

describe('replaying from memory', () => {
  it('a right move stays and counts; a wrong one is refused once', () => {
    const g = rec([[2, 2], [6, 6], [2, 6]])
    let r = begin(g), k: Try
    ;[k, r] = attempt(g, r, [2, 2]); expect(k).toBe('right')
    ;[k, r] = attempt(g, r, [0, 0]); expect(k).toBe('wrong'); expect(r.k).toBe(1)
    ;[k, r] = attempt(g, r, [6, 6]); expect(k).toBe('right') // found on the second try: no help
    expect(r).toEqual({ k: 2, fails: 0, recalled: 2, helps: 0 })
  })
  it('the second failure on the same move shows it and counts as a help', () => {
    const g = rec([[2, 2], [6, 6], null])
    let r = begin(g), k: Try
    ;[k, r] = attempt(g, r, [1, 1]); expect(k).toBe('wrong')
    ;[k, r] = attempt(g, r, [1, 2]); expect(k).toBe('help'); expect(r).toEqual({ k: 1, fails: 0, recalled: 0, helps: 1 })
    ;[k, r] = attempt(g, r, [6, 6]); expect(k).toBe('right')
    expect(expected(g, r)).toBeNull() // a pass is asked like a move
    ;[k, r] = attempt(g, r, null); expect(k).toBe('right')
    expect(over(g, r)).toBe(true); expect(attempt(g, r, [0, 0])[0]).toBe('over')
    expect([r.recalled, total(g), r.helps]).toEqual([2, 3, 1])
  })
  it('keeps the handicap and setup stones, and places pseudo-moves by itself', () => {
    const g = loadSgf('(;SZ[9]HA[2]AB[cc][gg]PL[W];W[gc];AB[ee];W[cg];B[eg])')
    expect(g.boards[0].get([2, 2])).toBe(1); expect(g.boards[0].get([6, 6])).toBe(1) // the empty board keeps them
    expect(total(g)).toBe(3)
    let r: Run = begin(g)
    expect(expected(g, r)).toEqual([6, 2])
    ;[, r] = attempt(g, r, [6, 2])
    expect(g.moves[1].setup).toBe(true)
    expect(r.k).toBe(2) // AB[ee] placed by itself
    expect(g.boards[r.k].get([4, 4])).toBe(1)
    ;[, r] = attempt(g, r, [2, 6]); [, r] = attempt(g, r, [4, 6])
    expect(over(g, r)).toBe(true); expect(r.recalled).toBe(3)
  })
  it('counts nothing replayed before the first move placed, even when setup nodes come first', () => {
    const g = loadSgf('(;SZ[9];AB[cc];AW[gg];B[ee];W[cg])'), r = begin(g)
    expect(r.k).toBeGreaterThan(0)
    expect(replayed(r)).toBe(false)
    expect(replayed(attempt(g, attempt(g, r, [0, 0])[1], [0, 0])[1])).toBe(true) // helped: placed
  })
  it('the best run finds more moves, then needs fewer helps', () => {
    expect(better(undefined, { recalled: 1, helps: 9 })).toBe(true)
    expect(better({ recalled: 5, helps: 2 }, { recalled: 6, helps: 9 })).toBe(true)
    expect(better({ recalled: 5, helps: 2 }, { recalled: 5, helps: 1 })).toBe(true)
    expect(better({ recalled: 5, helps: 2 }, { recalled: 5, helps: 2 })).toBe(false)
    expect(better({ recalled: 5, helps: 2 }, { recalled: 4, helps: 0 })).toBe(false)
  })
})
