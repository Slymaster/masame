import { describe, expect, it } from 'vitest'
import { positionQuery } from '../katago'
import { loadSgf } from '../sgf'
import { average, better, costOf, humanTop, keepBest, KEY, load, NONE, scored, startOf, turnsOf, type Score } from './classics'
import ear from '../../public/assets/classics/ear-reddening-1846.sgf?raw'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}
const run = (...xs: (number | null)[]) => xs.reduce<Score>((s, x) => scored(s, x === 0, x), NONE) // 0: found

describe('guessing a classic', () => {
  it('grades a guess against the master in points, never below zero', () => {
    expect(costOf(1, 3.5, 1.2)).toBeCloseTo(2.3) // Black's lead drops from 3.5 to 1.2: 2.3 points
    expect(costOf(-1, -2, 1)).toBe(3) // White: Black's lead goes up by 3
    expect(costOf(1, 1, 2)).toBe(0) // better than the master: costs nothing
  })

  it('counts the moves found and averages what the others cost', () => {
    const s = run(0, 2, 0, 1, 0, null) // the last guess not graded yet: counted, not averaged
    expect(s).toEqual({ found: 3, total: 6, cost: 3, others: 2 })
    expect(average(s)).toBe(1.5)
    expect(average(run(0, 0))).toBe(0)
  })

  it('keeps the best run per game: more found first, then cheaper other moves', () => {
    const st = mem()
    keepBest('ear', run(0, 3, 3), 1, st)
    expect(load(st).best.ear).toMatchObject({ found: 1, total: 3, cost: 6 })
    keepBest('ear', run(0, 5), 2, st) // as many found, dearer: not kept
    expect(load(st).best.ear.t).toBe(1)
    keepBest('ear', run(0, 1, 1), 3, st) // as many found, cheaper: kept
    expect(load(st).best.ear).toMatchObject({ cost: 2, t: 3 })
    keepBest('ear', run(0, 0), 4, st)
    expect(load(st).best.ear).toMatchObject({ found: 2, t: 4 })
    keepBest('other', NONE, 5, st) // nothing guessed: nothing kept
    expect(load(st).best.other).toBeUndefined()
  })

  it('reads a garbage store as empty', () => {
    expect(load(mem({ [KEY]: '{oops' })).best).toEqual({})
    expect(load(mem({ [KEY]: JSON.stringify({ v: 1, best: { a: { found: 'x' }, b: { found: 1, total: 2, cost: 0, others: 0, t: 1 } } }) })).best)
      .toEqual({ b: { found: 1, total: 2, cost: 0, others: 0, t: 1 } })
    expect(better(run(0), undefined)).toBe(true)
  })

  it('asks the chosen side its moves, from move 1 or move 21', () => {
    const g = loadSgf(ear)
    const black = turnsOf(g, 1, 1), white21 = turnsOf(g, -1, 21)
    expect(black.length).toBe(163) // 325 moves, Black plays the odd ones
    expect(black.every(i => g.moves[i].sign === 1)).toBe(true)
    expect(white21[0]).toBe(21) // move 22, White's first from move 21
    expect(startOf(g, 21)).toBe(20)
    expect(startOf(g, 1)).toBe(0)
  })

  it('grades with the game’s komi: 0 for the Edo games', () => {
    const g = loadSgf(ear)
    expect(positionQuery(g.branch(10, [[3, 3]])).komi).toBe(0)
    expect(positionQuery(g.branch(10, [[3, 3]])).rules).toBe('japanese')
  })

  it('reads the human policy’s likeliest legal point', () => {
    const p = [0.1, -1, 0.3, 0.2, 0.5] // 2×2 + pass: the pass is never picked
    expect(humanTop(p, 2)).toEqual([0, 1])
    expect(humanTop([-1, -1, -1, -1, 1], 2)).toBeNull()
    expect(humanTop(null, 2)).toBeNull()
  })
})
