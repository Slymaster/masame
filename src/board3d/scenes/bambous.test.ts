import { describe, expect, it } from 'vitest'
import look from '../looks/bambous'
import { CANOPY, gust } from './bambous'

describe('bamboo garden', () => {
  it('keeps the leaf shade readable and the sway calm', () => {
    // measured on renders: a 0.24 floor with 80 % of the key through the leaves darkens the board by ≤ 23 % (cap 25 %)
    expect(CANOPY.floor).toBeGreaterThanOrEqual(0.22)
    expect(look.shoji).toBeLessThanOrEqual(0.8)
    expect(CANOPY.tMin).toBeGreaterThanOrEqual(6); expect(CANOPY.tMax).toBeLessThanOrEqual(10)
    expect(look.tiltMax).toBeLessThanOrEqual((80 * Math.PI) / 180 + 1e-9)
  })
  it('gusts are rare and soft', () => {
    let on = 0, max = 0
    for (let t = 0; t < 600; t += 0.1) { const g = gust(t); max = Math.max(max, g); if (g > 0.5) on++; expect(g).toBeGreaterThanOrEqual(0) }
    expect(max).toBeLessThanOrEqual(1.6)
    expect(on / 6000).toBeLessThan(0.12) // a strong breath less than 12 % of the time (about 8 s in 110 s)
    expect(on).toBeGreaterThan(0)
  })
})
