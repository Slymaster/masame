import { describe, expect, it } from 'vitest'
import { CAP, inMonth, KEY, load, note } from './journal'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('journal', () => {
  it('appends events in order, with an id only when given', () => {
    const st = mem()
    note('tsumego', true, 'abc', 1, st)
    note('ritual', true, undefined, 2, st)
    expect(load(st)).toEqual([{ t: 1, k: 'tsumego', ok: true, id: 'abc' }, { t: 2, k: 'ritual', ok: true }])
  })
  it('keeps the newest CAP events', () => {
    const st = mem({ [KEY]: JSON.stringify(Array.from({ length: CAP }, (_, i) => ({ t: i, k: 'count', ok: false }))) })
    note('count', true, undefined, CAP, st)
    const es = load(st)
    expect(es).toHaveLength(CAP)
    expect(es[0].t).toBe(1)
    expect(es.at(-1)).toEqual({ t: CAP, k: 'count', ok: true })
  })
  it('survives garbage: unreadable text, a non-array, bad events', () => {
    expect(load(mem({ [KEY]: '{nope' }))).toEqual([])
    expect(load(mem({ [KEY]: '{"t":1}' }))).toEqual([])
    expect(load(mem({ [KEY]: JSON.stringify([{ t: 1, k: 'yose', ok: true }, { t: 'x' }, null, { t: 2, k: 'yose', ok: 1 }]) }))).toEqual([{ t: 1, k: 'yose', ok: true }])
  })
  it('a storage that throws never breaks the caller', () => {
    const st = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(load(st)).toEqual([])
    expect(() => note('joseki', true, 'k', 1, st)).not.toThrow()
  })
  it('picks a calendar month in local time', () => {
    const es = [new Date(2026, 8, 30, 23, 59).getTime(), new Date(2026, 9, 1, 0, 0).getTime(), new Date(2026, 9, 31, 23, 59).getTime(), new Date(2026, 10, 1).getTime()]
      .map(t => ({ t, k: 'exercise' as const, ok: true }))
    expect(inMonth(es, 2026, 9).map(e => e.t)).toEqual([es[1].t, es[2].t])
    expect(inMonth(es, 2026, 11)).toEqual([]) // December, and the year rolls over for its end
  })
})
