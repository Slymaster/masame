import { describe, expect, it } from 'vitest'
import type { Card } from '../joseki/fsrs'
import { today } from '../joseki/store'
import { allDone, CAP, complete, HAND, deckStep, fresh, gameStep, KEY, load, save, streakOf, yesterday } from './ritual'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const NOW = new Date(2026, 9, 14, 15).getTime(), DAY = 86_400_000
const card = (last: number): Card => ({ s: 1, d: 5, due: last + DAY, last, reps: 1, lapses: 0 })
const deck = (today: number, before: number) => Object.fromEntries([
  ...Array.from({ length: today }, (_, i) => [`t${i}`, card(NOW - i * 60_000)]),
  ...Array.from({ length: before }, (_, i) => [`b${i}`, card(NOW - DAY)]),
])

describe('the daily ritual', () => {
  it('a deck step is done after CAP reviews today, or when nothing is left', () => {
    expect(deckStep(deck(2, 9), 8, NOW)).toEqual({ done: false, left: CAP - 2 })
    expect(deckStep(deck(2, 9), 1, NOW)).toEqual({ done: false, left: 1 })
    expect(deckStep(deck(CAP, 0), 8, NOW)).toEqual({ done: true, left: 0 })
    expect(deckStep(deck(0, 9), 0, NOW)).toEqual({ done: true, left: 0 })
    expect(deckStep(deck(0, 9), 3, NOW)!.done).toBe(false) // yesterday's reviews don't count
  })
  it('the exercises step is a hand of HAND cards, one more than a deck step', () => {
    expect(HAND).toBe(6)
    expect(deckStep(deck(CAP, 0), 8, NOW, HAND)).toEqual({ done: false, left: 1 })
    expect(deckStep(deck(HAND, 0), 8, NOW, HAND)).toEqual({ done: true, left: 0 })
    expect(deckStep(deck(2, 0), 9, NOW, HAND)).toEqual({ done: false, left: HAND - 2 })
  })
  it('the game step is done once a ritual game ended today', () => {
    expect(gameStep(fresh(), NOW)).toEqual({ done: false, left: 1 })
    expect(gameStep({ ...fresh(), game: today(NOW) }, NOW)).toEqual({ done: true, left: 0 })
    expect(gameStep({ ...fresh(), game: yesterday(NOW) }, NOW)!.done).toBe(false)
  })
  it('is done when every available step is done', () => {
    const d = { done: true, left: 0 }, n = { done: false, left: 2 }
    expect(allDone([d, d, d])).toBe(true)
    expect(allDone([null, d, null])).toBe(true) // unavailable steps count as done
    expect(allDone([null, n, null])).toBe(false)
    expect(allDone([d, { done: false, left: null }, null])).toBe(false) // joseki still loading
    expect(allDone([null, null, null])).toBe(false) // nothing to do is no ritual
  })
  it('keeps the streak from yesterday, restarts it after a gap, once a day', () => {
    const a = complete(fresh(), NOW)
    expect(a).toMatchObject({ streak: 1, last: today(NOW) })
    expect(complete(a, NOW)).toBe(a)
    expect(complete({ ...fresh(), streak: 3, last: yesterday(NOW) }, NOW).streak).toBe(4)
    expect(complete({ ...fresh(), streak: 3, last: today(NOW - 2 * DAY) }, NOW).streak).toBe(1)
    expect(streakOf({ ...fresh(), streak: 3, last: yesterday(NOW) }, NOW)).toBe(3) // today can still keep it
    expect(streakOf({ ...fresh(), streak: 3, last: today(NOW - 2 * DAY) }, NOW)).toBe(0)
  })
  it('finds yesterday by the calendar across a DST change', () => {
    // 00:30 the day after a 25-hour day (Europe's October change): 24 h earlier is still the same day there
    expect(yesterday(new Date(2026, 9, 26, 0, 30).getTime())).toBe(today(new Date(2026, 9, 25, 12).getTime()))
    expect(yesterday(new Date(2026, 2, 30, 23, 30).getTime())).toBe(today(new Date(2026, 2, 29, 12).getTime()))
    expect(yesterday(new Date(2026, 0, 1, 8).getTime())).toBe('2025-12-31')
  })
  it('round-trips, and starts fresh on bad data', () => {
    const st = mem(), r = { v: 1 as const, streak: 4, last: '2026-10-14', game: '2026-10-13' }
    save(r, st)
    expect(load(st)).toEqual(r)
    for (const bad of ['{', 'null', '[]', '{"v":2,"streak":1,"last":"","game":""}', '{"v":1,"streak":-1,"last":"","game":""}', '{"v":1,"streak":"3","last":"","game":""}', '{"v":1,"streak":1,"last":5,"game":""}'])
      expect(load(mem({ [KEY]: bad }))).toEqual(fresh())
    expect(load({ getItem: () => { throw new Error('denied') }, setItem: () => {} })).toEqual(fresh())
  })
})
