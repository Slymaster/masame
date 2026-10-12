import { describe, expect, it } from 'vitest'
import { Game, type Vertex } from './game'
import { loadSgf, resignResult, saveSgf, scoreResult } from './sgf'

/** Plays alternating moves starting with Black; null = pass. */
function playAll(g: Game, moves: (Vertex | null)[]) {
  for (const m of moves) expect(g.play(m)).toBe('ok')
}

describe('rules', () => {
  it('captures a stone and counts it', () => {
    const g = new Game({ size: 9 })
    // White stone on [1,0] gets surrounded: B [0,0], W [1,0], B [2,0], W pass, B [1,1]
    playAll(g, [[0, 0], [1, 0], [2, 0], null, [1, 1]])
    expect(g.board.get([1, 0])).toBe(0)
    expect(g.board.getCaptures(1)).toBe(1)
  })

  it('rejects suicide', () => {
    const g = new Game({ size: 9 })
    playAll(g, [[1, 0], [5, 5], [0, 1]])
    expect(g.play([0, 0])).toBe('suicide') // White into Black's corner
    expect(g.moves.length).toBe(3)
  })

  it('rejects an immediate ko recapture, allows it after a move elsewhere', () => {
    const g = new Game({ size: 9 })
    // Ko shape around [1,1]/[2,1]: Black takes at [2,1], White may not retake at [1,1] at once.
    playAll(g, [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2], [8, 8], [1, 1], [2, 1]])
    expect(g.board.get([1, 1])).toBe(0)
    expect(g.play([1, 1])).toBe('ko')
    playAll(g, [[7, 7], [7, 8]]) // ko threat and answer
    expect(g.play([1, 1])).toBe('ok')
  })

  it('truncates the future when playing from history', () => {
    const g = new Game({ size: 9 })
    playAll(g, [[2, 2], [6, 6], [2, 6]])
    g.goTo(1)
    expect(g.play([4, 4])).toBe('ok')
    expect(g.moves.map(m => m.vertex)).toEqual([[2, 2], [4, 4]])
  })

  it('ends the game after two passes', () => {
    const g = new Game({ size: 9 })
    playAll(g, [[2, 2], null, null])
    expect(g.ended).toBe(true)
    expect(g.play([4, 4])).toBe('ended')
  })
})

describe('sgf', () => {
  it('round-trips size, komi, players, setup, moves and passes', () => {
    const g = new Game({ size: 13, komi: 0.5, playerBlack: 'Noir [test]', playerWhite: 'Blanc', setup: { black: [[3, 3], [9, 9]], white: [] }, firstSign: -1 })
    playAll(g, [[9, 3], [3, 9], null, [6, 6]])
    const text = saveSgf(g)
    const h = loadSgf(text)
    expect(h.info).toEqual(g.info)
    expect(h.moves).toEqual(g.moves)
    expect(h.cursor).toBe(4)
    expect(h.board.signMap).toEqual(g.board.signMap)
    expect(saveSgf(h)).toBe(text)
  })

  it('reads AB/AW lists and the legacy tt pass', () => {
    const g = loadSgf('(;GM[1]SZ[19]KM[6.5]AB[dd][pp]AW[dp:dq];B[tt];W[qd])')
    expect(g.info.setup.white).toEqual([[3, 15], [3, 16]])
    expect(g.moves[0].vertex).toBeNull()
    expect(g.board.get([16, 3])).toBe(-1)
  })
})

describe('sgf robustness', () => {
  const rt = (t: string) => saveSgf(loadSgf(t))
  it('round-trips PL with setup stones', () => {
    expect(loadSgf(rt('(;SZ[9]AB[cc]PL[B])')).toPlay).toBe(1)
    expect(loadSgf(rt('(;SZ[9]AB[cc]PL[W])')).toPlay).toBe(-1)
  })
  it('takes the first player from the first move, without PL', () => {
    const g = loadSgf('(;SZ[9]AB[cc];B[gg];W[cg])')
    g.goTo(0)
    expect(g.toPlay).toBe(1)
    expect(rt('(;SZ[9]AB[cc];B[gg];W[cg])')).toContain('PL[B]')
    expect(rt('(;SZ[9];B[gg])')).not.toContain('PL[')
  })
  it('rejects out-of-range setup stones', () => {
    expect(() => loadSgf('(;SZ[9]AB[zz])')).toThrow()
    expect(() => loadSgf('(;SZ[9]AB[aa:zz])')).toThrow()
  })
  it('rejects invalid moves but keeps passes', () => {
    expect(() => loadSgf('(;SZ[9];B[a])')).toThrow()
    expect(loadSgf('(;SZ[9];B[];W[tt])').moves).toHaveLength(2)
  })
  it('rejects non-SGF input', () => {
    expect(() => loadSgf('garbage')).toThrow()
  })
  it('records the result (RE)', () => {
    const g = new Game({ size: 9 })
    g.info.result = scoreResult(-4.5)
    expect(saveSgf(g)).toContain('RE[W+4.5]')
    expect(loadSgf(saveSgf(g)).info.result).toBe('W+4.5')
    expect([scoreResult(2.5), scoreResult(0), resignResult(1), resignResult(-1)]).toEqual(['B+2.5', '0', 'B+R', 'W+R'])
  })
  it('keeps RE through navigation, drops it when the record changes', () => {
    const g = loadSgf('(;SZ[9]RE[B+R];B[ee];W[cc])')
    g.goTo(0); g.goTo(2)
    expect(saveSgf(g)).toContain('RE[B+R]')
    g.goTo(1)
    expect(g.play([3, 3])).toBe('ok') // a different continuation
    expect(g.info.result).toBeUndefined()
    const h = loadSgf('(;SZ[9]RE[B+R];B[ee];W[cc])')
    h.undo()
    expect(h.info.result).toBeUndefined()
  })
  it('does not leak a loaded RE into an extended game', () => {
    const g = loadSgf('(;SZ[9]RE[W+R];B[ee];W[cc])')
    g.play(null); g.play(null)
    expect(saveSgf(g)).not.toContain('RE[')
  })
  it('rounds float noise out of the score margin', () => {
    expect(scoreResult(-7.299999999999997)).toBe('W+7.3')
    expect(scoreResult(-0.04)).toBe('0')
  })
})

describe('branch', () => {
  it('shares the record up to a position, and playing on it truncates only the branch', () => {
    const g = new Game({ size: 9 })
    playAll(g, [[0, 0], [1, 1], [2, 2], [3, 3]])
    g.info.result = 'W+R'
    const b = g.branch(2, [[5, 5], [0, 0], [6, 6]]) // [0,0] is occupied: the line stops there
    expect(b.boards.slice(0, 3)).toEqual(g.boards.slice(0, 3))
    expect(b.boards[2]).toBe(g.boards[2])
    expect([b.cursor, b.moves.map(m => m.vertex)]).toEqual([3, [[0, 0], [1, 1], [5, 5]]])
    b.goTo(1)
    expect(b.play([7, 7])).toBe('ok')
    expect(b.moves.length).toBe(2)
    expect([g.moves.length, g.cursor, g.info.result, g.board.get([7, 7])]).toEqual([4, 4, 'W+R', 0])
  })
})
