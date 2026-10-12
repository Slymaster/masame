import { describe, expect, it } from 'vitest'
import type { Vertex } from './game'
import { gtp, parseAnalysis } from './katago'

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
