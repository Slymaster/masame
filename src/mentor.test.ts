import { describe, expect, it } from 'vitest'
import { Game } from './game'
import { BUDGET, Mentor, MENTOR_QUERY, threshold } from './mentor'

/** A mentor whose engine answers Black's lead `leads[cursor]` (or never, for `never`), counting the questions. */
const fake = (leads: number[], o: { budget?: number; never?: number; fail?: boolean } = {}) => {
  const asked: number[] = []
  const m = new Mentor(g => {
    asked.push(g.cursor)
    if (o.fail) return Promise.reject(new Error('engine'))
    return g.cursor === o.never ? new Promise<number>(() => {}) : Promise.resolve(leads[g.cursor])
  }, o.budget)
  return { m, asked }
}
const at = (size: number, ...moves: ([number, number] | null)[]) => { const g = new Game({ size }); for (const v of moves) g.play(v); return g }

describe('the mentor', () => {
  it('stops at 2 points on 9×9, 3 on 13×13, 4 on 19×19, 100 visits within its budget of one second', () => {
    expect([9, 13, 19].map(threshold)).toEqual([2, 3, 4])
    expect(MENTOR_QUERY.maxVisits).toBe(100)
    expect(BUDGET).toBe(1000)
  })

  it('stops a move that costs the threshold or more, and lets a cheaper one pass', async () => {
    const stop = fake([0.5, -1.5]), g = at(9, [4, 4]) // Black's move: lead 0.5 → −1.5, 2 points
    expect(await stop.m.check(g)).toBeCloseTo(2)
    expect(stop.m.stops).toBe(1)
    const pass = fake([0.5, -1.4])
    expect(await pass.m.check(at(9, [4, 4]))).toBeNull()
    expect(pass.m.stops).toBe(0)
    // 19×19 needs 4: 3.9 passes
    expect(await fake([3, -0.9]).m.check(at(19, [3, 3]))).toBeNull()
  })

  it('reads the cost from the side that moved', async () => {
    const { m } = fake([0, 0, 6]) // White's move gives Black 6 points
    expect(await m.check(at(19, [3, 3], [15, 15]))).toBeCloseTo(6)
  })

  it('answers the same for a move asked twice, counting one stop', async () => {
    const { m, asked } = fake([0, -10]), g = at(9, [4, 4])
    expect(await m.check(g)).toBe(10)
    expect(await m.check(g)).toBe(10)
    expect(m.stops).toBe(1)
    expect(asked).toEqual([0, 1])
  })

  it('never examines a kept move again', async () => {
    const { m, asked } = fake([0, -10]), g = at(9, [4, 4])
    expect(await m.check(g)).toBe(10)
    m.keep(g.nodes[g.cursor])
    expect(await m.check(g)).toBeNull()
    expect(m.stops).toBe(1)
    expect(asked).toHaveLength(2)
  })

  it('counts every stop of the game', async () => {
    const { m } = fake([0, -5, -5, -10, -10]), g = at(9, [4, 4])
    await m.check(g); g.play([2, 2]); g.play([6, 6])
    expect(await m.check(g)).toBe(5)
    expect(m.stops).toBe(2)
  })

  it('reads the position before the move while the player thinks, once', async () => {
    const { m, asked } = fake([0, -10]), g = new Game({ size: 9 })
    m.prefetch(g); m.prefetch(g)
    g.play([4, 4])
    await m.check(g)
    expect(asked).toEqual([0, 1])
  })

  it('lets the move pass when the engine is late or fails', async () => {
    const late = fake([0, -10], { budget: 30, never: 1 }), t0 = Date.now()
    expect(await late.m.check(at(9, [4, 4]))).toBeNull()
    expect(Date.now() - t0).toBeLessThan(500)
    expect(late.m.stops).toBe(0)
    expect(await fake([0, -10], { fail: true }).m.check(at(9, [4, 4]))).toBeNull()
  })

  it('does not examine a pass', async () => {
    const { m, asked } = fake([0, -10])
    expect(await m.check(at(9, null))).toBeNull()
    expect(asked).toEqual([])
  })
})
