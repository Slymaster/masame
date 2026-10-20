import { describe, expect, it } from 'vitest'
import type { Deck, Exercise } from './exercises/deck'
import type { Entry } from './library'
import { KEY, loadStones, lockedSets, patina, PATINA_GAMES, saveStones, statsOf, toAnnounce, unlockAll, unlocked } from './stonesEarned'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const entry = (i: number, x: Partial<Entry> = {}) => ({ id: `a${i}`, date: i, source: 'ai', size: 19, komi: 6.5, handicap: 0,
  black: { name: '', rank: '' }, white: { name: '', rank: '' }, me: 1, ...x }) as Entry
const games = (n: number, x: Partial<Entry> = {}) => Array.from({ length: n }, (_, i) => entry(i, { result: 'B+R', ...x }))
const ld = { kind: 'ld' } as Exercise, plain = {} as Exercise
const card = (reps: number, lapses: number) => ({ s: 1, d: 5, due: 0, last: 0, reps, lapses })
const noDeck: Pick<Deck, 'items' | 'cards'> = { items: {}, cards: {} }
// fixture sets: the four earned ones may not have landed yet
const DATA = { japonaise: {}, lune: { rare: 'streak7' }, bronze: { rare: 'games10' }, braise: { rare: 'tsumego' }, nebuleuse: { rare: 'review' } }

describe('unlocked', () => {
  it('reaches each milestone at its threshold only', () => {
    expect(unlocked({ finished: 9, streak: 6, reviewed: false, tsumego: false })).toEqual(new Set())
    expect(unlocked({ finished: 10, streak: 7, reviewed: true, tsumego: true })).toEqual(new Set(['games10', 'streak7', 'review', 'tsumego']))
  })
})

describe('statsOf', () => {
  it('counts finished games only, and sees a reviewed one', () => {
    const s = statsOf([...games(10), entry(99)], { streak: 3 }, noDeck)
    expect(s).toEqual({ finished: 10, streak: 3, reviewed: false, tsumego: false })
    expect(statsOf([entry(1, { review: { moments: 4 } })], { streak: 0 }, noDeck).reviewed).toBe(true)
    expect(statsOf(null, { streak: 0 }, noDeck).finished).toBe(0)
  })
  it('a tsumego counts once answered right, a plain exercise never', () => {
    const deck = (c: ReturnType<typeof card>, x = ld) => ({ items: { k: x }, cards: { k: c } })
    expect(statsOf(null, { streak: 0 }, deck(card(1, 1))).tsumego).toBe(false) // missed
    expect(statsOf(null, { streak: 0 }, deck(card(2, 1))).tsumego).toBe(true)
    expect(statsOf(null, { streak: 0 }, deck(card(3, 0), plain)).tsumego).toBe(false)
  })
})

describe('locked sets', () => {
  it('locks the earned sets until their milestone or their announcement', () => {
    expect(lockedSets(new Set(), [], false, DATA)).toEqual(new Set(['lune', 'bronze', 'braise', 'nebuleuse']))
    expect(lockedSets(new Set(['games10']), ['lune'], false, DATA)).toEqual(new Set(['braise', 'nebuleuse']))
    expect(lockedSets(new Set(), [], true, DATA)).toEqual(new Set())
  })
  it('announces each earned set once', () => {
    expect(toAnnounce(new Set(['games10', 'review']), ['nebuleuse'], DATA)).toEqual(['bronze'])
    expect(toAnnounce(new Set(), [], DATA)).toEqual([])
  })
  it('opens everything with the owner flag or ?unlock=1', () => {
    expect(unlockAll(mem(), '')).toBe(false)
    expect(unlockAll(mem({ 'masame.unlockAll': '1' }), '')).toBe(true)
    expect(unlockAll(mem(), '?unlock=1')).toBe(true)
  })
})

describe('patina', () => {
  it('grows to 1 at 300 games after the renewal, never below 0', () => {
    expect(patina(0)).toBe(0)
    expect(patina(150)).toBe(0.5)
    expect(patina(PATINA_GAMES + 50)).toBe(1)
    expect(patina(320, 20)).toBe(1)
    expect(patina(40, 40)).toBe(0)
    expect(patina(10, 40)).toBe(0) // games removed after a renewal
  })
})

describe('masame.stones', () => {
  it('round-trips and survives garbage', () => {
    const st = mem()
    expect(loadStones(st)).toEqual({ v: 1, renewedAt: 0, said: [] })
    saveStones({ v: 1, renewedAt: 12, said: ['lune'] }, st)
    expect(loadStones(st)).toEqual({ v: 1, renewedAt: 12, said: ['lune'] })
    expect(loadStones(mem({ [KEY]: '{oops' }))).toEqual({ v: 1, renewedAt: 0, said: [] })
  })
})
