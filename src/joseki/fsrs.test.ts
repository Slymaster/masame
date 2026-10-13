import { describe, expect, it } from 'vitest'
import { DAY, recall, RELEARN, review, W, type Card } from './fsrs'

const now = Date.UTC(2026, 9, 13)
describe('FSRS-4.5', () => {
  it('starts a card rated Good at S = w[2]', () => {
    const c = review(undefined, 3, now)
    expect(c.s).toBe(W[2])
    expect(c).toMatchObject({ reps: 1, lapses: 0, last: now, due: now + 4 * DAY })
  })
  it('relearns Again in 10 minutes and counts a lapse', () => {
    const c = review(review(undefined, 3, now), 1, now + 4 * DAY)
    expect(c.due).toBe(now + 4 * DAY + RELEARN)
    expect(c).toMatchObject({ lapses: 1, reps: 2 })
    expect(review(undefined, 1, now)).toMatchObject({ due: now + RELEARN, lapses: 1 })
  })
  it('recalls 90 % after S days', () => {
    for (const s of [0.5, 3.7, 40]) expect(recall(s, s)).toBeCloseTo(0.9, 10)
  })
  it('orders Hard < Good < Easy, first time and later', () => {
    const at = (c: Card | undefined, t: number) => [2, 3, 4].map(g => review(c, g as 2 | 3 | 4, t).due)
    const [h, g, e] = at(undefined, now)
    expect(h).toBeLessThan(g); expect(g).toBeLessThan(e)
    const c = review(undefined, 3, now), [h2, g2, e2] = at(c, c.due)
    expect(h2).toBeLessThan(g2); expect(g2).toBeLessThan(e2)
    expect(g2 - c.due).toBeGreaterThan(c.due - now) // a success grows the interval
  })
  it('keeps difficulty within 1–10', () => {
    let c = review(undefined, 1, now)
    for (let i = 0; i < 50; i++) c = review(c, 1, c.due)
    expect(c.d).toBe(10)
    for (let i = 0; i < 50; i++) c = review(c, 4, c.due)
    expect(c.d).toBeGreaterThanOrEqual(1)
    expect(review(undefined, 4, now).d).toBeGreaterThanOrEqual(1)
  })
})
