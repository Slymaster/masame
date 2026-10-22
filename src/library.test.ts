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
      id: 'x', source: 'file', me: 0, date: new Date(2026, 9, 14).getTime(), size: 19, komi: 0.5, handicap: 3,
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
  it('writes a saved position again with the moves played since, under the same id and date', async () => {
    host.answer = cmd => (cmd === 'library_list' ? [] : undefined)
    const g = await game('(;SZ[9]AB[cc])'), id = await lib.rewrite(g, 'position', 0)
    const date = lib.get()![0].date
    g.play([4, 4])
    expect(await lib.rewrite(g, 'position', 0)).toBe(id)
    expect(host.log.filter(x => x.startsWith('library_write'))).toEqual([`library_write ${id}`, `library_write ${id}`])
    expect(lib.get()).toHaveLength(1)
    expect(lib.get()![0]).toMatchObject({ id, source: 'position', date })
  })
  it('keeps an imported OGS game under its OGS id', async () => {
    host.answer = cmd => (cmd === 'library_list' ? [] : undefined)
    expect(await lib.keep(await game('(;SZ[19];B[pd])'), 'ogs', -1, { ogsId: 42 })).toBe('ogs-42')
    expect(lib.get()?.[0]).toMatchObject({ id: 'ogs-42', ogsId: 42, me: -1 })
  })
})

describe('the review sidecar', () => {
  const files = new Map<string, unknown>()
  beforeEach(() => {
    files.clear()
    host.answer = (cmd, args) => {
      if (cmd === 'library_list') return [entry('g', 1)]
      if (cmd === 'library_sidecar_write') files.set(`${args?.id}.${args?.name}`, JSON.parse(JSON.stringify(args?.json))) // as Rust stores it
      if (cmd === 'library_sidecar_read') return files.get(`${args?.id}.${args?.name}`) ?? null
      if (cmd === 'library_read') return STORED
    }
  })
  const STORED = '(;SZ[19];B[pd];W[dp];B[pp])' // the entry's line
  const keyOf = async (sgf: string) => (await import('./exercises/deck')).reviewKey((await import('./sgf')).loadSgf(sgf))
  // a 300-move 19×19 game: 6 candidates and a 7-move line per position, 3 moments with both ownership maps
  const pos = Array.from({ length: 301 }, (_, i) => ({ lead: -12.345678 + i / 7, u: 0.123456789, ...i % 9 === 0 && { deep: true as const },
    cands: Array.from({ length: 6 }, (_, k) => ({ v: [k + 10, 18 - k] as [number, number], lead: 1.23456789 * k, visits: 100 - k, prior: 0.0123456789 })),
    pv: Array.from({ length: 7 }, (_, k) => (k === 6 ? null : [k, k] as [number, number])) }))
  const facts = Array.from({ length: 300 }, (_, i) => ({ sac: i % 50 ? 0 : 3, book: i < 8 }))
  const map = Array.from({ length: 361 }, (_, i) => Math.sin(i))
  const moments = [10, 100, 200].map(at => ({ at, sign: 1 as const, loss: 5.4321, lead: -3.21, punish: pos[0].pv, better: pos[1].pv, lost: map, kept: map }))

  it('writes v2 (positions, facts, moments, leads for older readers) and reads it back; fits the 2 MB cap', async () => {
    const cur = await import('./current')
    const key = await keyOf(STORED)
    await cur.noteReview('g', pos, moments, facts, { key, side: 1 })
    const side = files.get('g.review') as import('./library').ReviewSidecar
    expect([side.v, side.leads.length, side.leads[7]]).toEqual([2, 301, pos[7].lead])
    expect(await lib.reviewData('g', 19)).toEqual({ key, side: 1, pos, facts, moments })
    expect(lib.get()?.[0].review).toEqual({ moments: 3 })
    expect(JSON.stringify(side).length).toBeLessThan(2 * 1024 * 1024 / 4) // measured: 204 kB
  })
  it('writes nothing for another line than the stored one (a variation reviewed): the entry keeps its review', async () => {
    const cur = await import('./current'), mine = { leads: [1], moments: [], v: 2 }
    files.set('g.review', mine)
    for (const other of ['(;SZ[19];B[pd];W[dp];B[dd])', '(;SZ[19];B[pd];W[dp])', '(;SZ[19];C[x];B[pd];W[dp];B[pp])']) {
      await cur.noteReview('g', pos, moments, facts, { key: await keyOf(other), side: 1 })
      expect(files.get('g.review')).toBe(mine)
    }
    expect(host.log).not.toContain('library_sidecar_write')
    expect(lib.get()?.[0].review).toBeUndefined()
  })
  it('reads no classification data from a v1 sidecar, none, or a damaged one; v1 leads stay for Count and Mining', async () => {
    files.set('g.review', { leads: [0.5, null, -1], moments: [] })
    expect(await lib.reviewData('g', 19)).toBeNull()
    expect((await lib.sidecar<import('./library').ReviewSidecar>('g', 'review'))?.leads).toEqual([0.5, null, -1])
    expect(await lib.reviewData('none', 19)).toBeNull()
    const ok = { leads: [], moments: [moments[0]], v: 2, key: 'line', side: 0, pos: pos.slice(0, 12), facts: facts.slice(0, 11) }
    files.set('g.review', ok)
    expect(await lib.reviewData('g', 19)).not.toBeNull()
    for (const bad of [{ pos: [null] }, { pos: [{ ...pos[0], lead: 'x' }] }, { pos: [{ ...pos[0], cands: [{ v: [99, 0], lead: 0, visits: 1, prior: 0 }] }] }, { facts: [{ sac: 0 }] }, { moments: null },
      // moments that would crash the review (exerciseOf reads game.moves[at]), a sidecar of no known line or side, a short scan
      { moments: [null] }, { moments: ['x'] }, { moments: [{ ...moments[0], at: 9999 }] }, { moments: [{ ...moments[0], at: 11 }] }, { moments: [{ ...moments[0], sign: 0 }] },
      { moments: [{ ...moments[0], punish: [[3, 25]] }] },
      // a line with no first stone (the lesson's caption names it: it blanked the app)
      { moments: [{ ...moments[0], punish: [] }] }, { moments: [{ ...moments[0], better: [] }] }, { moments: [{ ...moments[0], better: [null, [3, 3]] }] }, { moments: [{ ...moments[0], lost: [NaN] }] }, { key: undefined }, { side: 2 }, { pos: pos.slice(0, 11) }]) {
      files.set('g.review', { ...ok, ...bad })
      expect(await lib.reviewData('g', 19)).toBeNull()
    }
    files.set('g.review', ok) // fine on 19×19, off a 9×9 board (candidates up to [15, 13])
    expect(await lib.reviewData('g', 9)).toBeNull()
  })
})
