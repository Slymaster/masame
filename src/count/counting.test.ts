import { describe, expect, it } from 'vitest'
import type { Entry } from '../library'
import { added, CAP, countable, countedToday, guessOf, KEY, load, median, pickGame, pickMove, recent, save, truthOf, verdictOf } from './counting'

const entry = (id: string, o: Partial<Entry> = {}): Entry => ({
  id, date: 0, source: 'ai', size: 19, komi: 6.5, handicap: 0, black: { name: '', rank: '' }, white: { name: '', rank: '' }, me: 1,
  result: 'B+R', review: { moments: 2 }, ...o,
})
const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length] }
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }

describe('counting positions', () => {
  it('come only from reviewed games, never from an unfinished OGS game', () => {
    expect(countable(entry('a'))).toBe(true)
    expect(countable(entry('b', { review: undefined }))).toBe(false)
    expect(countable(entry('c', { source: 'ogs', result: undefined }))).toBe(false)
    expect(countable(entry('d', { source: 'ogs', result: 'W+3.5' }))).toBe(true)
    expect(pickGame([entry('b', { review: undefined }), entry('c', { source: 'ogs', result: undefined })], Math.random)).toBeNull()
  })
  it('prefer the games counted the least', () => {
    const xs = [entry('a', { counted: 3 }), entry('b', { counted: 1 }), entry('c'), entry('d', { counted: 0 }), entry('e', { review: undefined })]
    expect(pickGame(xs, seq(0))!.id).toBe('c')
    expect(pickGame(xs, seq(0.99))!.id).toBe('d')
    expect(pickGame(xs.slice(0, 2), seq(0.5))!.id).toBe('b')
  })
  it('are drawn between 35 % and 70 % of the game, where the lead is known', () => {
    const leads = Array.from({ length: 101 }, (_, i) => i / 10)
    const seen = Array.from({ length: 400 }, (_, i) => pickMove(leads, 100, seq(i / 400))!)
    expect(Math.min(...seen)).toBe(35)
    expect(Math.max(...seen)).toBe(70)
    const holes = leads.map((x, i) => (i === 50 ? x : null))
    expect(pickMove(holes, 100, seq(0.3))).toBe(50)
    expect(pickMove([1, 2, null, null], 3, Math.random)).toBeNull()
  })
})

describe('the verdict', () => {
  it('is right within 3 points, close within 8, else far', () => {
    expect([0, 3, 3.5, 8, 8.5, 20].map(verdictOf)).toEqual(['right', 'right', 'close', 'close', 'far', 'far'])
  })
  it('reads the answer as Black’s lead and KataGo’s to the half point', () => {
    expect(guessOf(1, 5)).toBe(5); expect(guessOf(-1, 5)).toBe(-5); expect(guessOf(0, 5)).toBe(0)
    expect(truthOf(7.43)).toBe(7.5); expect(truthOf(-2.2)).toBe(-2); expect(Math.abs(guessOf(-1, 3) - truthOf(4.6))).toBe(7.5)
  })
})

describe('the counting error', () => {
  it('is the median of the last 20 counts', () => {
    expect(median([])).toBeNull()
    expect(median([5, 1, 9])).toBe(5)
    expect(median([1, 2, 3, 10])).toBe(2.5)
    let c = load(mem())
    for (let i = 0; i < 25; i++) c = added(c, i < 5 ? 100 : 6, i)
    expect(recent(c)).toEqual({ median: 6, n: 20 }) // the five old 100s are out of the window
  })
  it('keeps at most CAP errors, newest last, and survives garbage', () => {
    let c = load(mem())
    for (let i = 0; i < CAP + 5; i++) c = added(c, i, i)
    expect(c.errs).toHaveLength(CAP); expect(c.errs.at(-1)).toEqual({ t: CAP + 4, err: CAP + 4 })
    const st = mem(); save(c, st); expect(load(st)).toEqual(c)
    st.setItem(KEY, '{"v":1,"errs":[{"t":1,"err":2},{"t":"x"},null]}'); expect(load(st).errs).toEqual([{ t: 1, err: 2 }])
    st.setItem(KEY, 'nope'); expect(load(st).errs).toEqual([])
  })
  it('counts today’s positions for the ritual', () => {
    const now = new Date(2026, 9, 14, 15).getTime()
    const c = added(added(added(load(mem()), 1, now - 86_400_000), 2, now - 3600_000), 3, now)
    expect(countedToday(c, now)).toBe(2)
  })
})
