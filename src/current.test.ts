import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { local, keeper, resumable, restore, snapshot, unfinished, type Shown } from './current'
import { Game, type Sign } from './game'
import * as library from './library'
import type { Current, Entry } from './library'
import { CLOCKS, startClock, sync } from './localClock'
import { saveSgf } from './sgf'

vi.mock('./katago', () => ({ call: vi.fn(async () => { throw new Error('no host in tests') }), inTauri: () => false }))

const out = () => ({ write: vi.fn(async (..._: unknown[]) => {}), setCurrent: vi.fn(async (_: Current | null) => {}) })
const bot = { sign: -1 as Sign, rank: '5k' }
const shown = (game: Game, more: Partial<Shown> = {}): Shown => ({ game, bot, clock: null, myRank: '8k', ...more })

describe('the writer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('gives a local game its id at its first move and writes once, 500 ms after the last change', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9, playerWhite: 'KataGo human 5k' }))
    k.changed(() => shown(g))
    expect(library.idOf(g)).toBeUndefined() // no empty game listed
    g.play([2, 2]); k.changed(() => shown(g))
    const id = library.idOf(g)!
    expect(id).toMatch(/^ai-/)
    vi.advanceTimersByTime(300); g.play([6, 6]); k.changed(() => shown(g))
    vi.advanceTimersByTime(300); g.play([2, 6]); k.changed(() => shown(g))
    expect(o.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(o.write).toHaveBeenCalledTimes(1)
    const [wid, sgf, e] = o.write.mock.calls[0] as [string, string, Entry]
    expect([wid, e.id, e.source, e.me, e.result]).toEqual([id, id, 'ai', 1, undefined])
    expect([e.black, e.white]).toEqual([{ name: '', rank: '8k' }, { name: 'KataGo human 5k', rank: '5k' }])
    expect(sgf).toContain(';B[cg]')
    expect(o.setCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ id, cursor: 3, bot: { sign: -1, rank: '5k' } }))
  })

  it('writes at once when the game ends, and clears current.json', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 }))
    g.play([2, 2]); k.changed(() => shown(g, { bot: null }))
    g.info.result = 'W+R'; k.changed(() => shown(g, { bot: null }))
    expect(o.write).toHaveBeenCalledTimes(1)
    expect((o.write.mock.calls[0][2] as Entry)).toMatchObject({ source: 'two', me: 0, result: 'W+R' })
    expect(o.setCurrent).toHaveBeenLastCalledWith(null)
    vi.advanceTimersByTime(1000)
    expect(o.write).toHaveBeenCalledTimes(1)
  })

  it('flushes the last game when another one starts, then clears current.json', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 })), next = local(new Game({ size: 9 }))
    g.play([2, 2]); k.changed(() => shown(g))
    k.changed(() => shown(next))
    expect(o.write.mock.calls.map(c => c[0])).toEqual([library.idOf(g)])
    expect(o.setCurrent.mock.calls.map(c => c[0]?.id ?? null)).toEqual([library.idOf(g), null])
    vi.advanceTimersByTime(1000)
    expect(o.write).toHaveBeenCalledTimes(1) // the new game has no move yet
  })

  it('never writes a game that is not local: an OGS game, a file', () => {
    const o = out(), k = keeper(o), g = new Game({ size: 19 })
    g.play([3, 3]); k.changed(() => shown(g, { bot: null }))
    vi.advanceTimersByTime(1000)
    k.changed(() => shown(new Game({ size: 19 })))
    expect([o.write.mock.calls.length, o.setCurrent.mock.calls.length, library.idOf(g)]).toEqual([0, 0, undefined])
  })
})

describe('restoring', () => {
  it('brings back the game at its cursor on its line, its AI, its clock paused with the time spent', () => {
    const g = local(new Game({ size: 9, playerWhite: 'KataGo human 3k' }))
    for (const v of [[2, 2], [6, 6], [2, 6], [6, 2]] as const) g.play([...v])
    g.goTo(2); g.play([4, 4]); g.play([5, 5]) // a variation, played on
    g.goTo(3)
    const clock = sync(startClock(CLOCKS['5+3x20']), 1, 1000, 3) // Black's clock running since t = 1 s
    const x = snapshot('ai-x', { game: g, bot: { sign: -1, rank: '3k', era: 1850 }, clock, myRank: '8k' }, 11_000)
    expect(x.current?.clock).toMatchObject({ turn: null, b: { main: 290_000 } })
    const r = restore(x.current!, x.sgf)
    expect(r.game.cursor).toBe(3)
    expect(r.game.moves.map(m => m.vertex)).toEqual([[2, 2], [6, 6], [4, 4], [5, 5]])
    expect(r.game.toPlay).toBe(-1)
    expect(r.bot).toEqual({ sign: -1, rank: '3k', era: 1850 })
    expect(r.clock).toMatchObject({ turn: null, b: { main: 290_000 }, w: { main: 300_000 } })
    expect(unfinished(r.game)).toBe(false) // made local by resumeCurrent, not by restore
  })

  it('reads a bare current.json: main line, two players, no clock', () => {
    const g = new Game({ size: 9 }); g.play([2, 2]); g.play([3, 3])
    const r = restore({ id: 'two-x', cursor: 1, bot: null, clock: null, handicap: 0 }, saveSgf(g))
    expect([r.game.cursor, r.game.moves.length, r.bot, r.clock]).toEqual([1, 2, null, null])
  })

  it('plays an unfinished library game again, the AI from its entry', () => {
    const e: Entry = { id: 'ai-y', date: 1, source: 'ai', size: 9, komi: 6.5, handicap: 0, me: -1,
      black: { name: 'KataGo human 2k', rank: '2k' }, white: { name: '', rank: '6k' }, mentor: { stops: 2 } }
    expect(resumable(e)).toEqual({ bot: { sign: 1, rank: '2k', mentor: true } })
    expect(resumable({ ...e, source: 'two', me: 0 })).toEqual({ bot: null })
    expect(resumable({ ...e, result: 'B+R' })).toBeNull()
    expect(resumable({ ...e, source: 'file' })).toBeNull()
  })
})
