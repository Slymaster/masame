import { describe, expect, it } from 'vitest'
import { Game } from './game'
import { BUDGET, Mentor, MENTOR_QUERY, MIN_VISITS, type Read, threshold } from './mentor'

/** A full search whose only candidate is the corner (never played below): the move is judged by comparing two searches. */
const lead = (n: number): Read => ({ scoreLead: n, moves: [{ v: [0, 0], scoreLead: n, visits: 100 }] })
/** A mentor whose engine answers `leads[cursor]` (a number: Black's lead) or never, for `never`, counting the questions. */
const fake = (leads: (number | Read)[], o: { budget?: number; never?: number; fail?: boolean } = {}) => {
  const asked: number[] = []
  const m = new Mentor(g => {
    asked.push(g.cursor)
    if (o.fail) return Promise.reject(new Error('engine'))
    const r = leads[g.cursor]
    return g.cursor === o.never ? new Promise<Read>(() => {}) : Promise.resolve(typeof r === 'number' ? lead(r) : r)
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

  it('never stops the best move of the search before it, and reads a move it looked at inside that one search', async () => {
    const best = fake([{ scoreLead: 0.5, moves: [{ v: [4, 4], scoreLead: 0.5, visits: 30 }] }, -10])
    expect(await best.m.check(at(9, [4, 4]))).toBeNull()
    expect(best.asked).toEqual([0, 1]) // the search after is asked side by side, and not used
    // White's move, third choice: Black's lead 1 with the best, 4 with it, 3 points
    const listed = fake([0, { scoreLead: 1, moves: [{ v: [6, 6], scoreLead: 1, visits: 60 }, { v: [2, 6], scoreLead: 2, visits: 20 }, { v: [4, 4], scoreLead: 4, visits: 3 }] }])
    expect(await listed.m.check(at(9, [2, 2], [4, 4]))).toBeCloseTo(3)
  })

  it('compares two separate searches only when both read enough', async () => {
    const thin = (n: number): Read => ({ scoreLead: n, moves: [{ v: [0, 0], scoreLead: n, visits: MIN_VISITS - 1 }] })
    expect(await fake([thin(0), -10]).m.check(at(9, [4, 4]))).toBeNull()
    expect(await fake([0, thin(-10)]).m.check(at(9, [4, 4]))).toBeNull()
    expect(await fake([0, -10]).m.check(at(9, [4, 4]))).toBe(10)
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
