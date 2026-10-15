import { describe, expect, it } from 'vitest'
import { rng } from './board/noise'
import { adjustRank, botProfile, clampEra, decide, entropy, ERAS, humanDistribution, humanProfile, lessonFlags, RANKS, resignFrom, sample, settled, stepEra, stepRank, thinkDelay, type BotInput } from './bot'
import { en } from './i18n/en'
import { fr } from './i18n/fr'

const all = () => true
const empty = (n: number) => Array.from({ length: n }, () => Array<number>(n).fill(0))

describe('ranks', () => {
  it('spans 20k to 9d and clamps', () => {
    expect(RANKS).toHaveLength(29)
    expect([RANKS[0], RANKS[19], RANKS[20], RANKS[28]]).toEqual(['20k', '1k', '1d', '9d'])
    expect(stepRank('1k', 1)).toBe('1d')
    expect(stepRank('9d', 1)).toBe('9d')
    expect(stepRank('20k', -1)).toBe('20k')
    expect(humanProfile('8k')).toBe('rank_8k')
    expect(humanProfile('bogus')).toBe('rank_10k')
  })
  it('moves toward a 50 % win rate', () => {
    expect(adjustRank('10k', false)).toBe('9k') // player won → stronger bot
    expect(adjustRank('10k', true)).toBe('11k')
  })
})

describe('human policy sampling', () => {
  // 3×3 board + pass entry: illegal points are -1 as KataGo reports them.
  const policy = [0.5, 0.3, 0.005, -1, 0.15, 0.04, 0, 0, 0, 0.9]
  it('renormalises over legal points, drops <1 %, ignores pass', () => {
    const d = humanDistribution(policy, i => i !== 1)
    expect(d.map(([i]) => i)).toEqual([0, 4, 5])
    expect(d.reduce((a, [, p]) => a + p, 0)).toBeCloseTo(1)
    expect(d[0][1]).toBeCloseTo(0.5 / 0.69)
  })
  it('samples proportionally with a seeded RNG', () => {
    const d = humanDistribution(policy, all), r = rng(42), n: Record<number, number> = {}
    for (let k = 0; k < 20000; k++) { const i = sample(d, r)!; n[i] = (n[i] ?? 0) + 1 }
    expect(n[0] / 20000).toBeCloseTo(0.5 / 0.99, 1)
    expect(n[1] / 20000).toBeCloseTo(0.3 / 0.99, 1)
    expect(n[2]).toBeUndefined()
  })
  it('keeps everything when every move is below the floor', () => {
    const flat = [...Array(200).fill(0.005), 0]
    expect(humanDistribution(flat, all)).toHaveLength(200)
  })
  it('returns no move when nothing is legal', () => {
    expect(sample(humanDistribution(policy, () => false), rng(1))).toBeNull()
  })
})

describe('thinking delay', () => {
  it('scales with entropy within 0.5–2.5 s', () => {
    const r = rng(7)
    expect(entropy([[0, 1]])).toBe(0)
    expect(entropy([[0, 0.25], [1, 0.25], [2, 0.25], [3, 0.25]])).toBeCloseTo(1)
    expect(thinkDelay(0, r)).toBe(500)
    for (let k = 0; k < 100; k++) {
      const d = thinkDelay(1, r)
      expect(d).toBeGreaterThanOrEqual(2100)
      expect(d).toBeLessThanOrEqual(2500)
    }
  })
})

describe('decisions', () => {
  const base = (o: Partial<BotInput>): BotInput => ({
    humanPolicy: [0.6, 0.4, ...Array(79).fill(0), 0.01], topMove: 'A9', botWinrate: 0.5, history: [],
    ownership: null, signMap: empty(9), opponentPassed: false, moveNumber: 30, mayResign: true, legal: all, ...o,
  })
  it('plays a sampled human move', () => {
    const m = decide(base({}), rng(3))
    expect(m.kind).toBe('play')
    if (m.kind === 'play') expect([0, 1]).toContain(m.index)
  })
  it('passes only when KataGo would and the opponent passed or the board is settled', () => {
    expect(decide(base({ topMove: 'pass' }), rng(1)).kind).toBe('play')
    expect(decide(base({ topMove: 'pass', opponentPassed: true }), rng(1)).kind).toBe('pass')
    const own = Array(81).fill(0.95)
    expect(decide(base({ topMove: 'pass', ownership: own }), rng(1)).kind).toBe('pass')
    own[40] = 0.4 // one contested point
    expect(decide(base({ topMove: 'pass', ownership: own }), rng(1)).kind).toBe('play')
    expect(decide(base({ topMove: 'C3', opponentPassed: true }), rng(1)).kind).toBe('play')
  })
  it('resigns after three hopeless moves, never too early', () => {
    expect(resignFrom(19)).toBe(80)
    expect(resignFrom(13)).toBe(37)
    expect(resignFrom(9)).toBe(18)
    const lost = { botWinrate: 0.01, history: [0.02, 0.02] }
    expect(decide(base({ ...lost, moveNumber: 17 }), rng(1)).kind).toBe('play')
    expect(decide(base({ ...lost, moveNumber: 18 }), rng(1)).kind).toBe('resign')
    expect(decide(base({ ...lost, moveNumber: 18, mayResign: false }), rng(1)).kind).not.toBe('resign')
    expect(decide(base({ botWinrate: 0.01, history: [0.2, 0.02], moveNumber: 50 }), rng(1)).kind).toBe('play')
  })
  it('settled ignores occupied points and accepts neutral dame', () => {
    const s = empty(3); s[1][1] = 1
    expect(settled([0.9, -0.9, 0.05, 0.9, 0.0, -0.8, 0.9, 0.9, 0.9], s)).toBe(true)
    expect(settled([0.9, -0.9, 0.5, 0.9, 0.0, -0.8, 0.9, 0.9, 0.9], s)).toBe(false)
  })
})

describe('Masters of an era', () => {
  it('play with the professional profile of their year, the others with their rank', () => {
    expect(ERAS).toEqual([1850, 1900, 1935, 1970, 2005, 2023])
    expect(botProfile({ rank: '5k', era: 1850 })).toBe('proyear_1850')
    expect(botProfile({ rank: '5k' })).toBe('rank_5k')
    expect(clampEra(1901)).toBe(1850)
    expect([stepEra(1850, -1), stepEra(1850, 1), stepEra(2023, 1)]).toEqual([1850, 1900, 2023])
  })

  it('are named after their year in both languages', () => {
    expect(en.masterOf(1850)).toBe('Master of 1850')
    expect(fr.masterOf(1850)).toBe('Maître de 1850')
  })

  it('suspend auto-adjust; a mentor game feeds neither the rank nor auto-adjust', () => {
    expect(lessonFlags({})).toEqual({})
    expect(lessonFlags({ era: 1935 })).toEqual({ noAdjust: true })
    expect(lessonFlags({ mentor: true })).toEqual({ noRank: true, noAdjust: true })
    expect(lessonFlags({ era: 1935, mentor: true })).toEqual({ noRank: true, noAdjust: true })
  })
})
