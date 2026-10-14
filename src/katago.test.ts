import { describe, expect, it } from 'vitest'
import type { Vertex } from './game'
import { candidates, gtp, parseAnalysis, positionQuery } from './katago'
import real from './katago.fixture.json'
import { loadSgf } from './sgf'

const raw = (pv: unknown, move: unknown = 'D4') => ({ rootInfo: { winrate: 0.5, scoreLead: 1 }, moveInfos: [{ move: 'A1', order: 1 }, { move, order: 0, pv }] })

describe('parseAnalysis', () => {
  it('reads the best line as vertices, round-tripping with gtp', () => {
    for (const n of [9, 19]) {
      const line: Vertex[] = [[0, 0], [n - 1, n - 1], [7, 2], [8, n - 1]]
      expect(parseAnalysis(raw(line.map(v => gtp(v, n))), n).pv).toEqual(line)
    }
  })
  it('reads passes as null and stops at the first unreadable move', () => {
    expect(parseAnalysis(raw(['pass', 'D4', 'PASS']), 9).pv).toEqual([null, [3, 5], null])
    for (const bad of ['I5', 'A0', 'A20', '', 7, 'D4x', 'Z1']) expect(parseAnalysis(raw(['D4', bad, 'E5']), 19).pv).toEqual([[3, 15]])
    expect(parseAnalysis(raw(['K10']), 9).pv).toEqual([])
    expect(parseAnalysis(raw(undefined), 9).pv).toEqual([])
    expect(parseAnalysis(raw('D4'), 9).pv).toEqual([])
  })
  it('keeps topMove as before', () => {
    expect(parseAnalysis(raw([], 'Q16'), 19).topMove).toBe('Q16')
    expect(parseAnalysis(raw([], 'PASS'), 19).topMove).toBe('pass')
    expect(parseAnalysis({ rootInfo: { winrate: 0.5, scoreLead: 1 } }, 19).topMove).toBe('')
    expect(() => parseAnalysis({}, 19)).toThrow()
  })
})

describe('positionQuery', () => {
  it('starts from the last setup position at or before the cursor', () => {
    const g = loadSgf('(;SZ[9]AB[aa];W[ee];B[cc];AW[gg]AE[ee]PL[B];B[ii];W[];C[x];B[ab])')
    const q = positionQuery(g)
    expect([q.initialStones, q.initialPlayer, q.moves]).toEqual([[['B', 'A9'], ['B', 'C7'], ['W', 'G3']], 'B', [['B', 'J1'], ['W', 'pass'], ['B', 'A8']]])
    g.goTo(2)
    expect([positionQuery(g).initialStones, positionQuery(g).initialPlayer, positionQuery(g).moves]).toEqual([[['B', 'A9']], 'W', [['W', 'E5'], ['B', 'C7']]])
  })
  const PL = '(;GM[1]FF[4]SZ[9]KM[6.5];B[cc];W[gg];PL[W];W[cg];B[gc];W[];B[ee])'
  const q = (g: ReturnType<typeof loadSgf>, i: number) => { g.goTo(i); const { initialStones, initialPlayer, moves } = positionQuery(g); return [initialStones, initialPlayer, moves] }
  it('starts from a node that changes the side to play (PL)', () => {
    const g = loadSgf(PL), stones = [['B', 'C7'], ['W', 'G3']]
    expect(q(g, 3)).toEqual([stones, 'W', []])
    expect(q(g, 7)).toEqual([stones, 'W', [['W', 'C3'], ['B', 'G7'], ['W', 'pass'], ['B', 'E5']]])
    expect(q(g, 2)).toEqual([[], 'B', [['B', 'C7'], ['W', 'G3']]])
  })
  it('keeps the whole history over a comment or a PL that changes nothing', () => {
    const all = [['B', 'C7'], ['W', 'G3'], ['B', 'E5']]
    expect(q(loadSgf('(;SZ[9];B[cc];W[gg];C[x];B[ee])'), 4)).toEqual([[], 'B', all])
    expect(q(loadSgf('(;SZ[9];B[cc];W[gg];PL[B];B[ee])'), 4)).toEqual([[], 'B', all])
    expect(q(loadSgf('(;SZ[9]PL[W];C[x];W[cc])'), 2)).toEqual([[], 'W', [['W', 'C7']]])
    expect(q(loadSgf('(;SZ[9];PL[W];W[cc])'), 2)).toEqual([[], 'W', [['W', 'C7']]]) // the root's first player is already White
  })
})

describe('candidates', () => {
  // a real KataGo reply (b10, 200 visits) for Black to play after 8 opening moves
  const a = parseAnalysis(real, 19)
  it('reads the moveInfos in order, skipping malformed entries', () => {
    expect(a.moves.slice(0, 2)).toEqual([{ v: [2, 16], scoreLead: expect.closeTo(-0.2, 1), visits: 67 }, { v: [5, 16], scoreLead: expect.closeTo(-0.28, 1), visits: 32 }])
    expect(a.moves).toHaveLength(13)
    const bad = parseAnalysis({ rootInfo: { winrate: 0.5, scoreLead: 0 }, moveInfos: [
      { move: 'D4', order: 1, scoreLead: 1, visits: 5 }, { move: 'Z9', order: 0, scoreLead: 2, visits: 9 }, { move: 'Q16', order: 2, scoreLead: 'x', visits: 3 },
      { move: 'C3', order: 3, scoreLead: 1, visits: 0 }, { move: 'K10', scoreLead: 1, visits: 3 }, null, { move: 'pass', order: 4, scoreLead: NaN, visits: 2 }, 7] }, 19)
    expect(bad.moves).toEqual([{ v: [3, 15], scoreLead: 1, visits: 5 }])
    expect(parseAnalysis({ rootInfo: { winrate: 0.5, scoreLead: 0 }, moveInfos: 'x' }, 19).moves).toEqual([])
  })
  it('letters Black\'s moves with the points each loses, dropping rarely read ones', () => {
    const c = candidates(a, 1)
    expect(c.map(m => m.label).join('')).toBe('ABCDEFGH')
    expect(c[0]).toEqual({ v: [2, 16], label: 'A', loss: 0 })
    expect(c[1].loss).toBeCloseTo(0.08, 2)
    expect(c.every(m => m.loss >= 0)).toBe(true)
    expect(candidates(a, 1, 20).map(m => gtp(m.v!, 19))).not.toContain('L16') // 3 visits against 67
    expect(candidates(a, 1, 20)).toHaveLength(10)
    expect(candidates(a, 1, 3)).toHaveLength(3)
  })
  const move = (move: string, scoreLead: number, visits: number, order: number) => ({ move, scoreLead, visits, order })
  const of = (...m: ReturnType<typeof move>[]) => parseAnalysis({ rootInfo: { winrate: 0.5, scoreLead: 0 }, moveInfos: m }, 19)
  it('measures White\'s losses from Black\'s score, clamped at zero', () => {
    const c = candidates(of(move('D4', -3, 500, 0), move('Q16', -2.2, 200, 1), move('C3', -3.4, 60, 2)), -1)
    expect(c.map(m => [m.label, +m.loss.toFixed(1)])).toEqual([['A', 0], ['B', 0.8], ['C', 0]])
  })
  it('lists a pass without a letter or a mark, and the best always', () => {
    const c = candidates(of(move('Q16', 1, 10, 1), move('pass', 1.5, 8, 0), move('D4', 0.2, 200, 2)), 1)
    expect(c.map(m => [m.v && gtp(m.v, 19), m.label, m.loss])).toEqual([[null, '', 0], ['D4', 'A', 1.3]]) // Q16: 10 visits against 200
    expect(candidates(of(), 1)).toEqual([])
  })
})
