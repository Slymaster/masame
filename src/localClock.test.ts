import { describe, expect, it } from 'vitest'
import { CLOCKS, flagAt, read, sgfTime, spend, startClock, sync, timeUp } from './localClock'

const P = 20_000, spec = CLOCKS['5+3x20'], M = spec.main

describe('spend', () => {
  const s = { main: 1000, periods: 3, period: P }
  it('takes main time first', () => expect(spend(s, 400, P)).toEqual({ main: 600, periods: 3, period: P }))
  it('then the current period', () => expect(spend(s, 6000, P)).toEqual({ main: 0, periods: 3, period: 15_000 }))
  it('uses up each fully elapsed period', () => {
    expect(spend(s, 1000 + P, P)).toEqual({ main: 0, periods: 2, period: P })
    expect(spend(s, 1000 + P + 5000, P)).toEqual({ main: 0, periods: 2, period: 15_000 })
    expect(spend(s, 1000 + 2 * P + 1, P)).toEqual({ main: 0, periods: 1, period: P - 1 })
  })
  it('runs out after the last one', () => {
    expect(spend(s, 1000 + 3 * P - 1, P)).toEqual({ main: 0, periods: 1, period: 1 })
    expect(spend(s, 1000 + 3 * P, P)).toEqual({ main: 0, periods: 0, period: 0 })
    expect(spend(s, 1e9, P)).toEqual({ main: 0, periods: 0, period: 0 })
  })
  it('goes on from a partly used period', () => expect(spend({ main: 0, periods: 2, period: 5000 }, 6000, P)).toEqual({ main: 0, periods: 1, period: 19_000 }))
})

describe('a local clock', () => {
  const c0 = startClock(spec)
  it('is stopped at first, both sides full', () => {
    expect(read(c0, 1, 5000)).toEqual({ main: M, periods: 3, period: P, running: false })
    expect(flagAt(c0)).toBeNull()
    expect(sync(c0, null, 10)).toBe(c0)
  })
  const c1 = sync(c0, 1, 1000)
  it('runs for the side to move', () => {
    expect(read(c1, 1, 4000)).toEqual({ main: M - 3000, periods: 3, period: P, running: true })
    expect(read(c1, -1, 4000).running).toBe(false)
    expect(sync(c1, 1, 9000)).toBe(c1) // same side: nothing to charge
    expect(flagAt(c1)).toBe(1000 + M + 3 * P)
  })
  it('charges the side that moved and starts the other', () => {
    const c2 = sync(c1, -1, 61_000)
    expect([c2.b.main, c2.w.main, c2.turn, c2.since]).toEqual([M - 60_000, M, -1, 61_000])
    expect(read(c2, -1, 62_000).main).toBe(M - 1000)
  })
  it('gives a fresh period after a move in byo-yomi, keeps a partial one when stopped', () => {
    const c2 = sync(c1, -1, 1000 + M + 5000)
    expect(c2.b).toEqual({ main: 0, periods: 3, period: P })
    const c3 = sync(c1, null, 1000 + M + 5000)
    expect(c3.b).toEqual({ main: 0, periods: 3, period: 15_000 })
    expect(flagAt(c3)).toBeNull()
    const c4 = sync(c3, 1, 100_000_000)
    expect(flagAt(c4)).toBe(100_000_000 + 15_000 + 2 * P)
  })
  it('loses on time when the last period runs out', () => {
    const at = flagAt(c1)!
    expect(timeUp(c1, 1, at - 1)).toBe(false)
    expect(read(c1, 1, at - 1)).toEqual({ main: 0, periods: 1, period: 1, running: true })
    expect(timeUp(c1, 1, at)).toBe(true)
    expect(timeUp(c1, -1, at)).toBe(false)
  })
  it('records TM and OT', () => expect(sgfTime(CLOCKS['10+3x30'])).toEqual({ TM: ['600'], OT: ['3x30 byo-yomi'] }))
})
