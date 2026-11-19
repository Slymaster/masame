import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { local, keeper, onLeave, resumable, resumeEntry, restore, snapshot, unfinished, type Shown } from './current'
import { Game, type Sign } from './game'
import * as library from './library'
import type { Current, Entry } from './library'
import { CLOCKS, startClock, sync } from './localClock'
import { loadSgf, saveSgf } from './sgf'

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

  it.each(['before', 'after'])('keeps the empty position when the only move is undone %s its autosave', timing => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 }))
    g.play([2, 2]); k.changed(() => shown(g))
    if (timing === 'after') vi.advanceTimersByTime(600)
    g.undo(); k.changed(() => shown(g)); k.close()
    const [, sgf, entry] = o.write.mock.lastCall as [string, string, Entry]
    const current = o.setCurrent.mock.lastCall![0]!
    expect(restore(current, sgf).game.moves).toHaveLength(0)
    expect(resumeEntry(entry, loadSgf(sgf))?.game.cursor).toBe(0)
    k.changed(() => shown(local(new Game({ size: 9 }))))
    expect(o.setCurrent.mock.lastCall).toEqual([null])
  })

  it.each([null, { ...bot, mentor: true as const, ritual: true as const }])('reopens the saved clock, opponent and variation after playing another game', opponent => {
    vi.setSystemTime(0)
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 })), other = local(new Game({ size: 13 }))
    g.play([2, 2]); g.play([6, 6]); g.goTo(1); g.play([4, 4]); g.play([4, 5]); g.goTo(2)
    const clock = sync(startClock(CLOCKS['5+3x20']), 1, 0, 3)
    let current = shown(g, { bot: opponent, clock })
    k.changed(() => current); vi.advanceTimersByTime(10_000)
    current = shown(other, { clock: null })
    k.changed(() => current) // charge up to leaving, not just the last debounced write
    other.play([3, 3]); k.changed(() => current); k.close()
    const id = library.idOf(g)!
    const [, sgf, entry] = o.write.mock.calls.filter(call => call[0] === id).at(-1) as [string, string, Entry]
    const r = resumeEntry(entry, loadSgf(sgf))!
    expect(o.setCurrent.mock.lastCall![0]?.id).toBe(library.idOf(other))
    expect(r.game.cursor).toBe(2)
    expect(r.game.moves.map(m => m.vertex)).toEqual([[2, 2], [4, 4], [4, 5]])
    expect(r.bot).toEqual(opponent)
    expect(r.clock).toMatchObject({ turn: null, b: { main: 290_000 }, w: { main: 300_000 } })
    expect(library.idOf(r.game)).toBe(id)
    vi.advanceTimersByTime(60_000)
    expect(r.clock!.b.main).toBe(290_000)
    r.game.info.result = 'B+R'
    const finished = snapshot(id, shown(r.game), Date.now(), entry)
    expect(finished.entry.resume).toBeUndefined()
    expect(resumeEntry(finished.entry, loadSgf(finished.sgf))).toBeNull()
  })

  it('writes the unfinished game again when the app closes, its clock charged up to then', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 }))
    const clock = startClock(CLOCKS['5+3x20'])
    g.play([2, 2]); k.changed(() => shown(g, { clock }))
    vi.advanceTimersByTime(1000)
    expect(o.write).toHaveBeenCalledTimes(1)
    k.close() // ticks don't schedule writes; closing does
    expect(o.write).toHaveBeenCalledTimes(2)
    g.info.result = 'B+R'; k.changed(() => shown(g, { clock }))
    k.close() // decided: nothing more to write
    expect(o.write).toHaveBeenCalledTimes(3)
  })

  it('writes the pending move when the app goes to the background or the page away, not when it comes back', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 })), w = new EventTarget(), d = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const stop = onLeave(() => k.close(), w, d)
    g.play([2, 2]); k.changed(() => shown(g))
    d.visibilityState = 'hidden'; d.dispatchEvent(new Event('visibilitychange')) // a phone suspends the app: no 500 ms to wait
    expect(o.write).toHaveBeenCalledTimes(1)
    expect(o.setCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ id: library.idOf(g), cursor: 1 }))
    d.visibilityState = 'visible'; d.dispatchEvent(new Event('visibilitychange'))
    expect(o.write).toHaveBeenCalledTimes(1)
    w.dispatchEvent(new Event('pagehide'))
    expect(o.write).toHaveBeenCalledTimes(2)
    stop(); d.visibilityState = 'hidden'; d.dispatchEvent(new Event('visibilitychange'))
    expect(o.write).toHaveBeenCalledTimes(2)
  })

  it('never writes a game that is not local: an OGS game, a file', () => {
    const o = out(), k = keeper(o), g = new Game({ size: 19 })
    g.play([3, 3]); k.changed(() => shown(g, { bot: null }))
    vi.advanceTimersByTime(1000)
    k.changed(() => shown(new Game({ size: 19 })))
    expect([o.write.mock.calls.length, o.setCurrent.mock.calls.length, library.idOf(g)]).toEqual([0, 0, undefined])
  })

  it('forgets a deleted game before its debounce, pagehide and board replacement can save it', () => {
    const o = out(), k = keeper(o), g = local(new Game({ size: 9 }))
    g.play([2, 2]); k.changed(() => shown(g))
    k.forget(library.idOf(g)!)
    vi.advanceTimersByTime(1000)
    k.close()
    k.changed(() => shown(new Game({ size: 9 }), { bot: null }))
    expect(o.write).not.toHaveBeenCalled()
    expect(o.setCurrent.mock.calls.every(([c]) => c === null)).toBe(true)
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

  it('selects saved SGF branches across setup nodes without playing or modifying the record', () => {
    const sgf = '(;SZ[9];B[aa];C[after Black](;W[bb])(;C[alternative];W[cc]))'
    const r = restore({ id: 'two-x', bot: null, handicap: 0, clock: null, cursor: 3, line: [0, 0, 1, 0] }, sgf)
    expect(r.game.nodes[3].data.C).toEqual(['alternative'])
    expect(r.game.cursor).toBe(3)
    expect(r.game.leaf.move?.vertex).toEqual([2, 2])
    expect(saveSgf(r.game)).toEqual(saveSgf(loadSgf(sgf)))
  })

  it('keeps the player\'s stored rank once the entry exists, whatever the settings say now', () => {
    const g = local(new Game({ size: 9 })); g.play([2, 2])
    const prev = snapshot('ai-r', shown(g), 1000).entry
    expect(prev.black.rank).toBe('8k')
    expect(snapshot('ai-r', shown(g, { myRank: '2k' }), 2000, prev).entry.black).toEqual({ name: '', rank: '8k' })
  })

  it('reads a bare current.json: main line, two players, no clock', () => {
    const g = new Game({ size: 9 }); g.play([2, 2]); g.play([3, 3])
    const r = restore({ id: 'two-x', cursor: 1, bot: null, clock: null, handicap: 0 }, saveSgf(g))
    expect([r.game.cursor, r.game.moves.length, r.bot, r.clock]).toEqual([1, 2, null, null])
  })

  it('plays an unfinished library game again, the AI from its entry', () => {
    const e: Entry = { id: 'ai-y', date: 1, source: 'ai', size: 9, komi: 6.5, handicap: 0, me: -1,
      black: { name: 'KataGo human 2k', rank: '2k' }, white: { name: '', rank: '6k' }, mentor: { stops: 2 } }
    const legacyGame = new Game({ size: 9 }); legacyGame.play([2, 2])
    expect(resumeEntry(e, legacyGame)).toMatchObject({ bot: { sign: 1, rank: '2k', mentor: true }, clock: null, game: { cursor: 1 } })
    expect(resumable(e)).toEqual({ bot: { sign: 1, rank: '2k', mentor: true } })
    expect(resumable({ ...e, source: 'two', me: 0 })).toEqual({ bot: null })
    expect(resumable({ ...e, result: 'B+R' })).toBeNull()
    expect(resumable({ ...e, source: 'file' })).toBeNull()
  })
})
