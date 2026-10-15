import { describe, expect, it } from 'vitest'
import { loadSgf, saveSgf } from '../sgf'
import { edit, empty, resize, toGame } from './position'

describe('position editor', () => {
  it('places, removes, swaps colour and erases', () => {
    let m = edit(empty(9), [2, 3], 1)
    expect(m[3][2]).toBe(1)
    expect(edit(m, [2, 3], 1)[3][2]).toBe(0) // same colour again: removed
    expect(edit(m, [2, 3], -1)[3][2]).toBe(-1) // the other tool replaces it
    expect(edit(m, [2, 3], 1, true)[3][2]).toBe(-1) // shift: the other colour
    expect(edit(m, [2, 3], 0)[3][2]).toBe(0) // erase
    expect(edit(empty(9), [0, 0], 0)[0][0]).toBe(0)
    m = edit(m, [4, 4], -1)
    expect(m.flat().filter(Boolean)).toHaveLength(2)
    expect(empty(9).flat().every(c => c === 0)).toBe(true) // Clear
  })

  it('keeps the stones that fit when the size changes', () => {
    const m = edit(edit(empty(19), [2, 2], 1), [15, 15], -1)
    const s = resize(m, 9)
    expect(s).toHaveLength(9)
    expect(s[2][2]).toBe(1)
    expect(s.flat().filter(Boolean)).toHaveLength(1)
    expect(resize(s, 13)[2][2]).toBe(1)
  })

  it('becomes a game whose SGF reads back identical', () => {
    let m = empty(19)
    for (const [v, c] of [[[3, 3], 1], [[15, 3], 1], [[2, 15], -1], [[16, 16], -1], [[4, 2], -1]] as const) m = edit(m, [v[0], v[1]], c)
    const g = toGame(m, -1)
    expect(g.toPlay).toBe(-1)
    expect(g.board.signMap).toEqual(m)
    const sgf = saveSgf(g)
    expect(sgf).toContain('PL[W]')
    expect(sgf).toContain('AB[dd][pd]')
    const back = loadSgf(sgf)
    expect(back.info.size).toBe(19)
    expect(back.info.firstSign).toBe(-1)
    expect(back.toPlay).toBe(-1)
    expect(back.board.signMap).toEqual(m)
    expect(saveSgf(back)).toBe(sgf)
    // Black to play is written too, and a move from the position plays on it
    const b = loadSgf(saveSgf(toGame(m, 1)))
    expect(b.toPlay).toBe(1)
    expect(b.play([9, 9])).toBe('ok')
    expect(loadSgf(saveSgf(b)).board.signMap[9][9]).toBe(1)
  })
})
