import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entry } from './library'

// The Rust side, answered by each test: every call is logged, in the order it reaches Rust.
const host = vi.hoisted(() => ({ log: [] as string[], answer: (_cmd: string, _args?: Record<string, unknown>): unknown => undefined }))
vi.mock('./katago', () => ({
  call: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    host.log.push(cmd === 'library_write' || cmd === 'library_delete' ? `${cmd} ${args?.id}` : cmd)
    return host.answer(cmd, args)
  }),
}))

// A fresh module per test: the store and the write queue are module state.
let lib: typeof import('./library')
beforeEach(async () => {
  vi.resetModules()
  host.log = []
  host.answer = () => undefined
  lib = await import('./library')
})

const entry = (id: string, date: number, more: Partial<Entry> = {}): Entry => ({
  id, date, source: 'ai', size: 19, komi: 6.5, handicap: 0,
  black: { name: 'You', rank: '5k' }, white: { name: 'Masame', rank: '5k' }, me: 1, ...more,
})
const ids = (xs: Entry[] | null) => xs?.map(e => e.id)
const deferred = () => { let open!: () => void, fail!: (e: Error) => void; const p = new Promise<void>((r, j) => { open = r; fail = j }); return { p, open, fail } }

describe('upsert', () => {
  it('keeps newest first and replaces the entry with the same id', () => {
    let xs = lib.upsert([], entry('a', 1))
    xs = lib.upsert(xs, entry('c', 3))
    xs = lib.upsert(xs, entry('b', 2))
    expect(ids(xs)).toEqual(['c', 'b', 'a'])
    xs = lib.upsert(xs, entry('a', 1, { result: 'B+R' }))
    expect(ids(xs)).toEqual(['c', 'b', 'a'])
    expect(xs.find(e => e.id === 'a')?.result).toBe('B+R')
  })
})

describe('the store', () => {
  it('loads once, shares a load in flight, and loads again after a failure', async () => {
    let fail = true
    host.answer = cmd => { if (cmd === 'library_list') { if (fail) throw new Error('library_io'); return [entry('a', 1)] } }
    await expect(lib.load()).rejects.toThrow('library_io')
    expect(lib.get()).toBeNull()
    fail = false
    const [x, y] = await Promise.all([lib.load(), lib.load()])
    expect(ids(x)).toEqual(['a'])
    expect(y).toBe(x)
    await lib.load()
    expect(host.log).toEqual(['library_list', 'library_list'])
    expect(ids(lib.get())).toEqual(['a'])
  })

  it('patch merges into the stored entry and ignores unknown ids', async () => {
    host.answer = cmd => cmd === 'library_list' ? [entry('a', 1), entry('b', 2)] : undefined
    await lib.load()
    const seen = vi.fn()
    lib.subscribe(seen)
    await lib.patch('a', { counted: 3, memory: { recalled: 40, total: 120, helps: 2 } })
    const a = lib.get()?.find(e => e.id === 'a')
    expect(a).toEqual({ ...entry('a', 1), counted: 3, memory: { recalled: 40, total: 120, helps: 2 } })
    expect(seen).toHaveBeenCalledTimes(1)
    const { call } = await import('./katago')
    expect(vi.mocked(call)).toHaveBeenLastCalledWith('library_write', { id: 'a', sgf: null, entry: a })
    await lib.patch('nope', { counted: 1 })
    expect(host.log).toEqual(['library_list', 'library_write a'])
    expect(ids(lib.get())).toEqual(['b', 'a'])
  })

  it('remove takes the entry out of the store at once', async () => {
    host.answer = cmd => cmd === 'library_list' ? [entry('b', 2), entry('a', 1)] : undefined
    await lib.load()
    const done = lib.remove('b')
    expect(ids(lib.get())).toEqual(['a'])
    await done
    expect(host.log).toEqual(['library_list', 'library_delete b'])
  })

  it('a write before the index is loaded neither hides the index nor gets lost', async () => {
    host.answer = cmd => cmd === 'library_list' ? [entry('old', 1), entry('gone', 0)] : undefined
    await lib.write('new', '(;)', entry('new', 5))
    await lib.remove('gone')
    expect(lib.get()).toBeNull()
    expect(ids(await lib.load())).toEqual(['new', 'old'])
  })

  it('patch before the index is loaded loads it first instead of dropping the change', async () => {
    host.answer = cmd => cmd === 'library_list' ? [entry('a', 1)] : undefined
    await lib.patch('a', { counted: 2 })
    expect(lib.get()?.[0].counted).toBe(2)
    expect(host.log).toEqual(['library_list', 'library_write a'])
  })
})

describe('the write queue', () => {
  it('sends writes in call order, each after the previous one finished, even a slow one', async () => {
    const slow = deferred()
    host.answer = async (cmd, args) => {
      if (cmd === 'library_write' && args?.id === 'a') { await slow.p; host.log.push('a done') }
    }
    const writes = [
      lib.write('a', '(;)', entry('a', 1)),
      lib.setSidecar('a', 'review', { leads: [], moments: [] }),
      lib.write('b', null, entry('b', 2)),
      lib.remove('a'),
      lib.setCurrent(null),
    ]
    await new Promise(r => setTimeout(r, 20))
    expect(host.log).toEqual(['library_write a']) // the rest waits for the slow write
    slow.open()
    await Promise.all(writes)
    expect(host.log).toEqual(['library_write a', 'a done', 'library_sidecar_write', 'library_write b', 'library_delete a', 'library_current_write'])
  })

  it('a failed write rejects its own promise and does not stop the next ones', async () => {
    host.answer = (_cmd, args) => { if (args?.id === 'a') throw new Error('library_too_big') }
    const a = lib.write('a', 'x', null)
    const b = lib.write('b', 'y', null)
    await expect(a).rejects.toThrow('library_too_big')
    await expect(b).resolves.toBeUndefined()
    expect(host.log).toEqual(['library_write a', 'library_write b'])
  })
})

describe('newId', () => {
  const ID = /^[A-Za-z0-9_-]{1,64}$/
  it('keeps an OGS game’s id and a file’s hash', () => {
    expect(lib.newId('ogs', { ogsId: 81234567 })).toBe('ogs-81234567')
    expect(lib.newId('file', { hash: '1x2y3z' })).toBe('file-1x2y3z')
  })
  it('gives every other game a fresh id the library accepts', () => {
    const now = Date.UTC(2026, 9, 14)
    for (const source of ['ai', 'two', 'position', 'ogs', 'file'] as const) {
      const a = lib.newId(source, { now }), b = lib.newId(source, { now })
      expect(a).toMatch(ID)
      expect(a.startsWith(`${source}-${now.toString(36)}-`)).toBe(true)
      expect(a).not.toBe(b)
    }
    expect(lib.newId('ai')).toMatch(ID)
  })
})

describe('a game and its entry', () => {
  const game = async (sgf: string) => (await import('./sgf')).loadSgf(sgf)
  it('reads the entry from the SGF: players, ranks, handicap, date, result', async () => {
    const g = await game('(;SZ[19]KM[0.5]HA[3]PB[Ana]BR[12k]PW[Masame]WR[9k]DT[2026-10-14,15]RE[W+R];B[pd];W[dd])')
    expect(lib.entryOf(g, { id: 'x', source: 'file', me: 0 })).toEqual({
      id: 'x', source: 'file', me: 0, date: Date.parse('2026-10-14'), size: 19, komi: 0.5, handicap: 3,
      black: { name: 'Ana', rank: '12k' }, white: { name: 'Masame', rank: '9k' }, result: 'W+R',
    })
    const bare = lib.entryOf(await game('(;SZ[9];B[ee])'), { id: 'y', source: 'two', me: 0, date: 5 })
    expect(bare).toMatchObject({ date: 5, size: 9, komi: 6.5, handicap: 0, black: { name: '', rank: '' } })
    expect('result' in bare).toBe(false)
  })
  it('keeps a game once, binds it, and finds the same file again by its content', async () => {
    host.answer = cmd => (cmd === 'library_list' ? [] : undefined)
    const sgf = '(;SZ[9]PB[a]PW[b];B[ee];W[gc])'
    const g = await game(sgf), id = await lib.keep(g, 'file', 1)
    expect(id).toMatch(/^file-[0-9a-z]+$/)
    expect(lib.idOf(g)).toBe(id)
    expect(await lib.keep(g, 'file', 1)).toBe(id) // bound: nothing written again
    const again = await game(sgf)
    expect(await lib.keep(again, 'file', 1)).toBe(id) // the same file opened again: already in the library
    expect(host.log.filter(x => x.startsWith('library_write'))).toEqual([`library_write ${id}`])
    expect(lib.get()?.[0]).toMatchObject({ id, source: 'file', me: 1, black: { name: 'a' } })
  })
  it('keeps an imported OGS game under its OGS id', async () => {
    host.answer = cmd => (cmd === 'library_list' ? [] : undefined)
    expect(await lib.keep(await game('(;SZ[19];B[pd])'), 'ogs', -1, { ogsId: 42 })).toBe('ogs-42')
    expect(lib.get()?.[0]).toMatchObject({ id: 'ogs-42', ogsId: 42, me: -1 })
  })
})
