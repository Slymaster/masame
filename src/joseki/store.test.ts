import { describe, expect, it } from 'vitest'
import { review } from './fsrs'
import { BAD, KEY, load, record, save, today } from './store'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('joseki progress', () => {
  it('round-trips', () => {
    const st = mem(), s = load(st)
    expect(s).toMatchObject({ readOnly: false, p: { v: 1, cards: {}, fresh: 0 } })
    const p = record(s.p, 'abc', review(undefined, 3, Date.now()))
    save({ p, readOnly: false }, st)
    expect(load(st).p).toEqual(p)
    expect(p.fresh).toBe(1)
    expect(record(p, 'abc', review(p.cards.abc, 3, Date.now())).fresh).toBe(1) // a known card is not new
  })
  it('restarts the daily new-card count on a new day', () => {
    const st = mem({ [KEY]: JSON.stringify({ v: 1, cards: {}, day: '2001-1-1', fresh: 9 }) })
    expect(load(st).p).toMatchObject({ day: today(), fresh: 0 })
  })
  it('backs up unreadable data, then starts fresh', () => {
    const good = review(undefined, 3, 0), mixed = JSON.stringify({ v: 1, cards: { a: { s: 'x' }, b: good }, day: today(), fresh: 1 })
    const st = mem({ [KEY]: mixed })
    expect(load(st).p.cards).toEqual({ b: good }) // one bad card costs only that card
    expect(st.m.get(BAD)).toBe(mixed)
    for (const bad of ['{nope', '{"v":1,"cards":[],"day":"x","fresh":0}', 'null']) {
      const st = mem({ [KEY]: bad })
      expect(load(st)).toMatchObject({ readOnly: false, p: { cards: {} } })
      expect(st.m.get(BAD)).toBe(bad)
    }
  })
  it('never overwrites progress from a newer version', () => {
    const newer = JSON.stringify({ v: 2, whatever: true }), st = mem({ [KEY]: newer })
    const s = load(st)
    expect(s.readOnly).toBe(true)
    save({ ...s, p: record(s.p, 'k', review(undefined, 3, 0)) }, st)
    expect(st.m.get(KEY)).toBe(newer)
    expect(st.m.has(BAD)).toBe(false)
  })
})
