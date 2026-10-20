import { describe, expect, it } from 'vitest'
import look from '../looks/hanami'
import { BLOOM } from './hanami'

describe('hanami', () => {
  it('keeps the blossom light gentle and slow', () => {
    // measured on renders (cookie vs the same light through an open window, 99th percentile over the board): ≤ 25 % at
    // the worst hour with these floors and a 0.6 share; bamboo's 0.24 floor is the harsher reference
    expect(BLOOM.floor).toBeGreaterThanOrEqual(0.42); expect(BLOOM.branchFloor).toBeGreaterThanOrEqual(0.36)
    expect(look.shoji).toBeLessThanOrEqual(0.6); expect(look.ownCookie).toBe(true)
    expect(BLOOM.tMin).toBeGreaterThanOrEqual(12)
    expect(look.tiltMax).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-9)
    expect(look.tod).toBeNull()
  })
})
