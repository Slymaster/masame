import { describe, expect, it } from 'vitest'
import look from '../looks/honinbo'
import { dims } from '../logic'
import { TABLE } from '../gobans'
import { ANDON } from './honinbo'

describe('Honinbo hall', () => {
  it("the fixed light comes from the andon's bearing and height, so the contact shadows lean away from it", () => {
    const az = (Math.atan2(ANDON.z, ANDON.x) * 180) / Math.PI + 360, el = (Math.atan2(ANDON.light - TABLE.thickness, Math.hypot(ANDON.x, ANDON.z)) * 180) / Math.PI
    expect(Math.abs(look.tod!.az - az)).toBeLessThan(2)
    expect(Math.abs(look.tod!.el - el)).toBeLessThan(2)
  })
  it('the andon stands on the tatami clear of the board and the white bowl', () => {
    const { BW, BD } = dims(19, true), s = ANDON.w / 2
    expect(ANDON.x + s).toBeLessThan(-BW / 2 - 150) // the white bowl sits ~110 mm past the board's left edge
    expect(ANDON.z + s).toBeLessThan(-BD * 0.3 + 70)
    expect(look.key).toBe(0); expect(look.lamp).toBeGreaterThan(0); expect(look.skin).toBe('laque')
  })
})
