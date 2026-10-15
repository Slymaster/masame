import { describe, expect, it } from 'vitest'
import { readV1, writeV1 } from './store'
import * as counting from './count/counting'
import * as classics from './classics/classics'
import * as ritual from './today/ritual'
import { KEY as TSUMEGO, saveMined, emptyMined } from './tsumego/mine'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const ok = (j: Record<string, unknown>) => Array.isArray(j.xs)

describe('versioned stores', () => {
  it('reads a valid v1, keeps garbage aside, leaves a newer version alone', () => {
    expect(readV1('k', ok, mem())).toBeNull()
    expect(readV1('k', ok, mem({ k: '{"v":1,"xs":[1]}' }))).toEqual({ v: 1, xs: [1] })
    const bad = mem({ k: '{oops' })
    expect(readV1('k', ok, bad)).toBeNull()
    expect(bad.m.get('k.bad')).toBe('{oops')
    const wrong = mem({ k: '{"v":1,"xs":3}' })
    expect(readV1('k', ok, wrong)).toBeNull()
    expect(wrong.m.get('k.bad')).toBe('{"v":1,"xs":3}')
    const newer = mem({ k: '{"v":2}' })
    expect(readV1('k', ok, newer)).toBeNull()
    expect(newer.m.has('k.bad')).toBe(false)
  })
  it('never writes over a newer version, writes over garbage', () => {
    const newer = mem({ k: '{"v":2}' })
    writeV1('k', { v: 1, xs: [] }, newer)
    expect(newer.m.get('k')).toBe('{"v":2}')
    const bad = mem({ k: '{oops' })
    writeV1('k', { v: 1, xs: [] }, bad)
    expect(bad.m.get('k')).toBe('{"v":1,"xs":[]}')
  })
  it('counting, classics, tsumego and today keep a newer store', () => {
    const v2 = '{"v":2,"future":true}'
    const st = mem({ [counting.KEY]: v2, [classics.KEY]: v2, [TSUMEGO]: v2, [ritual.KEY]: v2 })
    counting.save(counting.added(counting.load(st), 3, 1), st)
    classics.keepBest('x', { found: 1, total: 1, cost: 0, others: 0 }, 1, st)
    saveMined(emptyMined(), st)
    ritual.save(ritual.complete(ritual.load(st), Date.now()), st)
    for (const k of [counting.KEY, classics.KEY, TSUMEGO, ritual.KEY]) expect(st.m.get(k)).toBe(v2)
  })
})
