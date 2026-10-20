import { describe, expect, it } from 'vitest'
import { autoDecor } from '../auto'
import { dims } from '../logic'
import look from '../looks/pluie'
import { EDGE_Z } from './pluie'

describe('rain on the veranda', () => {
  it('rains only past the veranda, beyond the board', () => {
    const { BD } = dims(19, true)
    expect(EDGE_Z).toBeLessThan(-BD / 2 - 100)
  })
  it('follows the hour, soft and low', () => {
    expect(look.tod).toBeNull(); expect(look.key).toBeLessThan(0.5); expect(look.soft).toBe(2) // the softest a Look allows; shade 0.5 does the rest
  })
  it('is never chosen by Auto (no weather, no network)', () => {
    for (let d = 0; d < 365; d += 3) for (let h = 0; h < 24; h += 0.5) expect(autoDecor(new Date(2026, 0, 1 + d), h)).not.toBe('pluie')
  })
})
