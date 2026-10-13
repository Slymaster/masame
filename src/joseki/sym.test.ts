import GoBoard from '@sabaki/go-board'
import { describe, expect, it } from 'vitest'
import { CONTEXT, MIRROR, N, REGION, ROOTS, code, compose, invert, point, positionKey, sym, type Pt } from './sym'

const all: Pt[] = Array.from({ length: N * N }, (_, i) => [i % N, Math.floor(i / N)])
const play = (moves: string[]) => moves.reduce((b, m, i) => b.makeMove(i % 2 ? -1 : 1, point(m)), GoBoard.fromDimensions(N))
const mirror = (m: string) => code(sym(MIRROR, point(m)))

describe('symmetries', () => {
  it('are 8 distinct invertible maps that compose', () => {
    expect(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(k => sym(k, [1, 2]).join())).size).toBe(8)
    for (let k = 0; k < 8; k++) {
      for (const v of all) expect(sym(invert(k), sym(k, v))).toEqual(v)
      for (let j = 0; j < 8; j++) expect(sym(compose(k, j), [3, 7])).toEqual(sym(k, sym(j, [3, 7])))
    }
  })
  it('MIRROR keeps the corner, the context and REGION', () => {
    expect(sym(MIRROR, [15, 3])).toEqual([15, 3])
    expect(mirror('qd')).toBe('pc')
    expect(CONTEXT.map(mirror).sort()).toEqual(['pp', 'dp', 'dd'].sort()) // B D16 ↔ B Q4, W D4 stays
    for (const v of all) expect(REGION(sym(MIRROR, v))).toBe(REGION(v))
    for (const r of ROOTS) expect(REGION(point(r.m))).toBe(true)
  })
  it('round-trips the move codec', () => {
    for (const v of all) expect(point(code(v))).toEqual(v)
    expect(code([15, 3])).toBe('pd')
  })
})

describe('positionKey', () => {
  it('merges mirror images and transpositions, not different positions', () => {
    const a = play([...CONTEXT, 'qd', 'oc', 'qf']), b = play([...CONTEXT, ...['qd', 'oc', 'qf'].map(mirror)])
    expect(positionKey(a.signMap, 3)).toBe(positionKey(b.signMap, 3))
    const c = play([...CONTEXT, 'pd', 'nc', 'qf', 'qc', 'pc']), d = play([...CONTEXT, 'pd', 'qc', 'qf', 'nc', 'pc'])
    expect(positionKey(c.signMap, 5)).toBe(positionKey(d.signMap, 5))
    expect(positionKey(a.signMap, 3)).not.toBe(positionKey(play([...CONTEXT, 'qd', 'oc', 'qg']).signMap, 3))
    expect(positionKey(a.signMap, 3)).not.toBe(positionKey(a.signMap, 5))
  })
})
