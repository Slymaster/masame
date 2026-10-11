import { describe, expect, it } from 'vitest'
import type { Sign } from './game'
import { round1, noDead, score, suggestDead, toggleDead } from './scoring'

/** X = Black, O = White, . = empty; one string per row from the top. */
const board = (rows: string[]) => rows.map(r => [...r].map(c => (c === 'X' ? 1 : c === 'O' ? -1 : 0) as Sign))

// Black owns columns A–D, White owns F–J; one White stone lost in Black's area at B8.
const SPLIT = board([
  '....XO...',
  '.O..XO...',
  '....XO...',
  '....XO...',
  '....XO...',
  '....XO...',
  '....XO...',
  '....XO...',
  '....XO...',
])
/** KataGo-like ownership: columns 0–4 Black, 5–8 White, with some noise. */
const OWN = SPLIT.flatMap(row => row.map((_, x) => (x <= 4 ? 0.9 : -0.85)))

describe('scoring', () => {
  it('suggests dead stones from ownership, by whole chain', () => {
    const dead = suggestDead(SPLIT, OWN)
    expect(dead[1][1]).toBe(true)
    expect(dead.flat().filter(Boolean).length).toBe(1)
    // A chain leaning only mildly to the opponent stays alive.
    expect(suggestDead(SPLIT, OWN.map(v => (v > 0 ? 0.5 : v)))[1][1]).toBe(false)
  })

  it('counts territory, prisoners and komi (Japanese)', () => {
    const s = score(SPLIT, suggestDead(SPLIT, OWN), { black: 2, white: 1 }, 6.5)
    expect(s.black).toEqual({ territory: 36, prisoners: 3, total: 39 }) // 4×9 incl. the dead stone's point; 2 captures + 1 dead
    expect(s.white).toEqual({ territory: 27, prisoners: 1, total: 34.5 })
    expect(s.lead).toBe(4.5)
    expect(s.territory[1][1]).toBe(1)
    expect(s.territory[0][4]).toBe(0) // living stones are not territory
  })

  it('leaves points touching both colours neutral (dame)', () => {
    const m = board(Array(9).fill('...X.O...'))
    const s = score(m, noDead(m), { black: 0, white: 0 }, 6.5)
    expect(s.black.territory).toBe(27)
    expect(s.white.territory).toBe(27)
    expect(s.territory.every(r => r[4] === 0)).toBe(true)
    expect(s.lead).toBe(-6.5)
  })

  it('toggling a chain back to alive makes its area neutral', () => {
    const alive = toggleDead(SPLIT, suggestDead(SPLIT, OWN), [1, 1])
    expect(alive[1][1]).toBe(false)
    const s = score(SPLIT, alive, { black: 0, white: 0 }, 6.5)
    expect(s.black.territory).toBe(0) // A–D now touch a living White stone
    expect(s.white.territory).toBe(27)
    // Toggling the black wall marks all nine stones, and only them.
    const wall = toggleDead(SPLIT, noDead(SPLIT), [4, 0])
    expect(wall.flat().filter(Boolean).length).toBe(9)
    expect(toggleDead(SPLIT, wall, [0, 0])).toBe(wall) // empty point: no change
  })

  it('an empty board is all neutral', () => {
    const m = board(Array(9).fill('.........'))
    expect(score(m, noDead(m), { black: 0, white: 0 }, 0).lead).toBe(0)
  })
})

describe('score rounding', () => {
  it('has no float noise or -0', () => {
    expect(round1(-7.299999999999997)).toBe(-7.3)
    expect(Object.is(round1(-0.04), 0)).toBe(true)
    const m = board(['.'.repeat(9), ...Array(8).fill('.'.repeat(9))])
    expect(score(m, noDead(m), { black: 0, white: 0 }, 7.3).lead).toBe(-7.3)
  })
})
