import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GobanEngineConfig, protocol } from 'goban-engine'
import { loadSgf } from './sgf'
import * as ogs from './ogs'
import { apply, clockOf, findMatchRequest, fromOgs, gameFrom, hms, rankLabel, resultOf, stonesOf, stonesString, toOgs } from './ogs'
// Recorded as a guest from public games, then anonymised: live (fixed handicap 2, Fischer), freeHandicap (3 stones,
// byo-yomi), handicapOne (9×9), finished (fixed handicap 2, W+1.5) and its SGF from the REST API.
import json from './ogs.fixture.json'

type Data = GobanEngineConfig & { clock: protocol.GameClock }
const fixture = json as unknown as { live: { gamedata: Data; events: { t: number; m: unknown[] }[] }; freeHandicap: Data; handicapOne: Data; finished: Data; finishedSgf: string }

vi.mock('./katago', () => ({ call: vi.fn(async (cmd: string) => (cmd === 'ogs_token' ? 'token' : undefined)) }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }))

const live = fixture.live.gamedata
const clone = <T>(x: T): T => structuredClone(x)

describe('coordinates', () => {
  it('reads and writes both move forms, passes included', () => {
    expect(toOgs([0, 0])).toBe('aa')
    expect(toOgs([15, 3])).toBe('pd')
    expect(toOgs(null)).toBe('..')
    expect(fromOgs('pd')).toEqual([15, 3])
    expect(fromOgs('..')).toBe(null)
    expect(fromOgs([2, 3, 4478])).toEqual([2, 3])
    expect(fromOgs([-1, -1, 1746.5])).toBe(null)
    expect(stonesOf('pddp')).toEqual([[15, 3], [3, 15]])
    expect(stonesOf('')).toEqual([])
    expect(stonesString(stonesOf('jcjeej'))).toBe('jcjeej')
  })
})

describe('rankLabel / hms', () => {
  it('follows the OGS ranks (the SGF says 3k and 1d for these players)', () => {
    expect(rankLabel(27.14568178144618)).toBe('3k')
    expect(rankLabel(29.9)).toBe('1k')
    expect(rankLabel(30)).toBe('1d')
    expect(rankLabel(30.11892439104921)).toBe('1d')
    expect(rankLabel(32.5)).toBe('3d')
    expect(rankLabel(undefined)).toBe('')
  })
  it('formats durations without words, rounding up', () => {
    expect(hms(252_000)).toBe('4:12')
    expect(hms(3_723_000)).toBe('1:02:03')
    expect(hms(59_001)).toBe('1:00')
    expect(hms(0)).toBe('0:00')
    expect(hms(-5)).toBe('0:00')
  })
})

describe('gameFrom', () => {
  it('matches the SGF OGS serves for the same game', () => {
    const g = gameFrom(fixture.finished), s = loadSgf(fixture.finishedSgf)
    expect(g.info.setup).toEqual(s.info.setup)
    expect(g.info.firstSign).toBe(-1)
    expect(g.moves).toEqual(s.moves)
    expect(g.info).toMatchObject({ size: 19, komi: 0.5, playerBlack: 'black_player', playerWhite: 'white_player' })
  })
  it('places fixed handicap stones with goban-engine when initial_state is missing', () => {
    const d = clone(live)
    delete d.initial_state; delete d.initial_player
    const g = gameFrom(d)
    expect(g.info.setup.black).toEqual([[15, 3], [3, 15]])
    expect(g.info.firstSign).toBe(-1)
    expect(g.moves[0]).toEqual({ sign: -1, vertex: [16, 15] })
    expect(g.moves).toHaveLength(116)
  })
  it('turns a completed free placement into setup stones, White to play', () => {
    const g = gameFrom(fixture.freeHandicap)
    expect(g.info.setup.black).toEqual([[3, 15], [15, 15], [3, 3]])
    expect(g.info.firstSign).toBe(-1)
    expect(g.moves[0]).toEqual({ sign: -1, vertex: [15, 2] })
    expect(g.moves).toHaveLength(67)
  })
  it('keeps a one-stone handicap as an ordinary first move', () => {
    const g = gameFrom(fixture.handicapOne)
    expect(g.info).toMatchObject({ size: 9, komi: 2.5, firstSign: 1, setup: { black: [], white: [] } })
    expect(g.moves[0]).toEqual({ sign: 1, vertex: [4, 4] })
  })
  it('refuses what Masame cannot show', () => {
    expect(() => gameFrom({ ...clone(live), height: 13 })).toThrow('ogs_not_square')
    const placing = clone(fixture.freeHandicap)
    placing.moves = (placing.moves as unknown[]).slice(0, 2) as GobanEngineConfig['moves']
    expect(() => gameFrom(placing)).toThrow('ogs_placing_handicap')
  })
})

describe('clockOf', () => {
  const fischer = live.clock // White (1002) to move
  const white = (fischer.white_time as { thinking_time: number }).thinking_time * 1000 // 12 805 ms
  it('runs the mover’s clock from the last move, in server time', () => {
    expect(clockOf(fischer, -1, fischer.last_move + 2000, 0)).toEqual({ main: white - 2000, running: true })
    expect(clockOf(fischer, -1, fischer.last_move + 2300, 300)).toEqual({ main: white - 2000, running: true })
    expect(clockOf(fischer, 1, fischer.last_move + 2000, 0)).toEqual({ main: 150_086.5, running: false })
    expect(clockOf(fischer, -1, fischer.last_move + 60_000, 0)!.main).toBe(0)
  })
  it('freezes while paused and counts down to expiration in start mode', () => {
    expect(clockOf(fischer, -1, fischer.last_move + 9000, 0, fischer.last_move + 1000)).toEqual({ main: white - 1000, running: false })
    expect(clockOf({ ...fischer, start_mode: true }, -1, fischer.expiration - 7000, 0)).toEqual({ main: 7000, running: true })
  })
  it('spends byo-yomi periods once main time is gone', () => {
    const c = fixture.freeHandicap.clock // Black (1001) to move, 5 × 10 s, main time spent
    expect(clockOf(c, 1, c.last_move + 12_000, 0)).toEqual({ main: 0, periods: 4, period: 8000, running: true })
    expect(clockOf(c, -1, c.last_move + 12_000, 0)).toEqual({ main: 0, periods: 5, period: 10_000, running: false })
    expect(clockOf(c, 1, c.last_move + 50_000, 0)).toMatchObject({ periods: 0, period: 0 })
  })
  it('reads Canadian, simple and no time control', () => {
    const base = { ...fischer, current_player: 1001 }
    const canadian = { ...base, black_time: { thinking_time: 5, moves_left: 10, block_time: 300 } }
    expect(clockOf(canadian, 1, base.last_move + 8000, 0)).toEqual({ main: 0, period: 297_000, stones: 10, running: true })
    expect(clockOf({ ...base, black_time: 30 }, 1, base.last_move + 1000, 0)).toEqual({ main: 29_000, running: true })
    expect(clockOf({ ...base, black_time: undefined }, 1, base.last_move, 0)).toBe(null)
  })
})

describe('resultOf', () => {
  it('reads winner ids or colours and the outcome text', () => {
    expect(resultOf(fixture.finished)).toEqual({ re: 'W+1.5', winner: -1, how: 'score', points: 1.5 })
    const players = { black: { id: 1 }, white: { id: 2 } }
    expect(resultOf({ winner: 1, outcome: 'Resignation', players })).toEqual({ re: 'B+R', winner: 1, how: 'resign' })
    expect(resultOf({ winner: 2, outcome: 'Timeout', players })).toEqual({ re: 'W+T', winner: -1, how: 'time' })
    expect(resultOf({ winner: 'black', outcome: '4.5 points' })).toMatchObject({ re: 'B+4.5', points: 4.5 })
    expect(resultOf({ winner: 'black', outcome: 'Disconnection' })).toEqual({ re: 'B+F', winner: 1, how: 'forfeit' })
    expect(resultOf({ winner: 2, outcome: 'Cancellation', players })).toEqual({ re: 'Void', winner: 0, how: 'cancel' })
  })
  it('does not invent a winner', () => {
    expect(resultOf({ outcome: 'Resignation' })).toEqual({ re: '?', winner: 0, how: 'resign' })
    expect(resultOf({ outcome: '3.5 points' })).toEqual({ re: '?', winner: 0, how: 'score', points: 3.5 })
    expect(resultOf({ winner: 'tie', outcome: '0 points' })).toEqual({ re: '0', winner: 0, how: 'score', points: 0 })
  })
})

describe('findMatchRequest', () => {
  it('asks for both clock systems at one size and speed', () => {
    expect(findMatchRequest(9, 'blitz', 'u1')).toEqual({
      uuid: 'u1',
      size_speed_options: [{ size: '9x9', speed: 'blitz', system: 'byoyomi' }, { size: '9x9', speed: 'blitz', system: 'fischer' }],
      lower_rank_diff: 3, upper_rank_diff: 3,
      rules: { condition: 'no-preference', value: 'japanese' }, handicap: { condition: 'no-preference', value: 'enabled' },
    })
  })
})

describe('apply', () => {
  const start = (d: unknown = live, me?: number) => apply(null, ['gamedata', clone(d)], me)!
  const ev = (i: number) => fixture.live.events[i].m as [string, unknown]
  const short = (e: [string, unknown]): ogs.GameEvent => [e[0].split('/')[2], e[1]]

  it('builds the state from gamedata and replays the recorded live events', () => {
    let s = start(live, 1002)
    expect(s).toMatchObject({ id: 1, me: -1, phase: 'play', offset: 0, removed: [], players: { black: { id: 1001, rank: '3k' }, white: { id: 1002, rank: '1d' } } })
    for (const e of fixture.live.events) s = apply(s, short(e.m as [string, unknown]))!
    expect(s.game.moves).toHaveLength(118)
    expect(s.reload).toBeUndefined()
    expect(s.clock).toEqual(ev(3)[1])
    expect(apply(null, ['clock', {}])).toBe(null)
  })
  it('ignores its own move echoed back, flags any mismatch', () => {
    const s = start()
    s.game.play([0, 0]) // optimistic local move, number 117
    expect(apply(s, ['move', { move_number: 117, move: [0, 0, 100] }])).toBe(s)
    expect(apply(s, ['move', { move_number: 117, move: [1, 0, 100] }])!.reload).toBe(true)
    expect(apply(s, ['move', { move_number: 119, move: [1, 0, 100] }])!.reload).toBe(true)
    expect(apply(s, ['move', { move_number: 118, move: [0, 0, 100] }])!.reload).toBe(true) // occupied
  })
  it('jumps back to the end before adding a move to a browsed game', () => {
    const s = start()
    s.game.goTo(10)
    const n = apply(s, ['move', { move_number: 117, move: [-1, -1, 100] }])!
    expect(n.game.moves).toHaveLength(117)
    expect(n.game.cursor).toBe(117)
  })
  it('counts free handicap stones in OGS move numbers', () => {
    const s = start(fixture.freeHandicap)
    expect(s.offset).toBe(3)
    expect(apply(s, ['move', { move_number: 71, move: [7, 3, 5750.5] }])!.game.moves).toHaveLength(68)
  })
  it('decides "paused" from pause_control, not from a stale paused_since', () => {
    // seen live: pause_control {} with an old paused_since once the pause is over
    const stale = { ...clone(live), pause_control: {}, paused_since: live.clock.last_move - 3600_000 }
    stale.clock.paused_since = stale.paused_since
    let s = start(stale)
    expect(s.pausedSince).toBeUndefined()
    const now = live.clock.last_move + 2000
    expect(clockOf(s.clock!, -1, now, 0, s.pausedSince)).toMatchObject({ running: true, main: (live.clock.white_time as { thinking_time: number }).thinking_time * 1000 - 2000 })
    const since = live.clock.last_move + 500
    s = apply(s, ['clock', { ...live.clock, pause: { paused: true, paused_since: since, pause_control: { paused: { pausing_player_id: 1001, pauses_left: 4 } } } }])!
    expect(s.pausedSince).toBe(since)
    expect(clockOf(s.clock!, -1, now, 0, s.pausedSince)!.running).toBe(false)
    s = apply(s, ['clock', { ...live.clock }])! // no pause field: unchanged
    expect(s.pausedSince).toBe(since)
    s = apply(s, ['clock', { ...live.clock, pause: { paused: false } }])!
    expect(s.pausedSince).toBeUndefined()
    expect(start(fixture.finished).pausedSince).toBe(fixture.finished.paused_since) // stone removal pauses the clock
  })
  it('asks for the game again after an undo, or a finish without its outcome', () => {
    const s = start()
    expect(apply(s, ['undo_accepted', 116])!.reload).toBe(true)
    expect(apply(s, ['phase', 'finished'])!.reload).toBe(true)
    expect(apply(s, ['phase', 'stone removal'])!.reload).toBeUndefined()
    expect(apply(start(fixture.finished), ['phase', 'finished'])!.reload).toBeUndefined()
  })
  it('follows stone removal to the result', () => {
    let s = start()
    s = apply(s, ['phase', 'stone removal'])!
    s = apply(s, ['removed_stones', { removed: true, stones: 'jc', all_removed: 'jcje' }])!
    expect(s.removed).toEqual([[9, 2], [9, 4]])
    s = apply(s, ['removed_stones_accepted', { phase: 'finished', stones: 'jcje', winner: 1001, outcome: '3.5 points' }])!
    expect(s).toMatchObject({ phase: 'finished', result: { re: 'B+3.5', winner: 1 } })
    expect(s.game.info.result).toBe('B+3.5')
    const f = start(fixture.finished)
    expect(f).toMatchObject({ phase: 'finished', removed: [[9, 2], [9, 4], [4, 9]], result: { re: 'W+1.5' } })
    expect(f.game.info.result).toBe('W+1.5')
  })
})

// --- Session, against a fake WebSocket.

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: [string, any][] = []
  private on: Record<string, ((e: any) => void)[]> = {}
  constructor(readonly url: string) { FakeSocket.all.push(this) }
  addEventListener(type: string, f: (e: any) => void) { (this.on[type] ??= []).push(f) }
  send(s: string) { this.sent.push(JSON.parse(s)) }
  close() { this.end(1000) }
  open() { this.readyState = 1; this.fire('open', {}) }
  end(code: number) { this.readyState = 3; this.fire('close', { code }) }
  receive(m: unknown[]) { this.fire('message', { data: JSON.stringify(m) }) }
  commands() { return this.sent.map(m => m[0]).filter(c => c !== 'net/ping') }
  private fire(type: string, e: unknown) { for (const f of this.on[type] ?? []) f(e) }
}
const last = () => FakeSocket.all[FakeSocket.all.length - 1]

describe('session', () => {
  const fetches: string[] = []
  let lost = false
  beforeEach(() => {
    FakeSocket.all = []
    fetches.length = 0
    lost = false
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      fetches.push(`${url} ${init.headers.Authorization}`)
      const body = url.endsWith('/ui/config') ? { user_jwt: 'jwt-1', user: { id: 1002, username: 'me', ranking: 30.2 } }
        : { results: [{ id: 9, width: 19, players: { black: { id: 1001, username: 'them', ranking: 27.5 }, white: { id: 1002, username: 'me' } }, outcome: 'Resignation', black_lost: true, white_lost: lost, started: '2026-10-12T22:20:00Z', ended: '2026-10-12T22:42:02Z' }] }
      return new Response(JSON.stringify(body))
    }))
  })
  afterEach(() => {
    ogs.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('authenticates on every connect and re-joins followed games after a reconnect', async () => {
    const statuses: string[] = []
    const off = ogs.onStatus(() => statuses.push(ogs.getStatus()))
    expect(await ogs.connect()).toEqual({ id: 1002, username: 'me', rank: '1d' })
    expect(ogs.connect()).toBe(ogs.connect())
    expect(fetches).toEqual(['https://online-go.com/api/v1/ui/config Bearer token'])
    const events: string[] = []
    const leave = ogs.follow(1, (e, s) => events.push(`${e[0]}:${s?.me}`))
    const a = last()
    expect(a.url).toBe('wss://online-go.com')
    a.open()
    expect(a.commands()).toEqual(['authenticate', 'game/connect'])
    expect(a.sent[0][1]).toMatchObject({ jwt: 'jwt-1', client: 'masame', client_version: '0.1.0' })
    expect(a.sent[0][1].device_id).toMatch(/^[0-9a-f-]{36}$/)
    a.receive(['game/1/gamedata', live])
    a.receive(['game/1/clock', live.clock])
    expect(events).toEqual(['gamedata:-1', 'clock:-1'])

    a.receive(['user/jwt', 'jwt-2'])
    a.end(1006)
    expect(ogs.getStatus()).toBe('connecting')
    vi.advanceTimersByTime(1000)
    const b = last()
    expect(b).not.toBe(a)
    b.open()
    expect(b.commands()).toEqual(['authenticate', 'game/connect'])
    expect(b.sent[0][1].jwt).toBe('jwt-2')
    expect(b.sent.find(m => m[0] === 'game/connect')![1]).toEqual({ game_id: 1, chat: false })

    ogs.move(1, [3, 3])
    ogs.pass(1)
    ogs.setRemoved(1, [[9, 2], [9, 4]], true)
    ogs.acceptRemoved(1, [[9, 2]])
    leave()
    expect(b.sent.slice(-5)).toEqual([
      ['game/move', { game_id: 1, move: 'dd' }], ['game/move', { game_id: 1, move: '..' }],
      ['game/removed_stones/set', { game_id: 1, removed: true, stones: 'jcje' }],
      ['game/removed_stones/accept', { game_id: 1, stones: 'jc', strict_seki_mode: false }],
      ['game/disconnect', { game_id: 1 }],
    ])
    expect(statuses).toEqual(['connecting', 'online', 'connecting', 'online'])
    off()
  })

  it('re-fetches the game when the record goes out of sync', async () => {
    await ogs.connect()
    last().open()
    ogs.follow(1, () => {})
    last().receive(['game/1/gamedata', live])
    last().receive(['game/1/move', { game_id: 1, move_number: 200, move: [0, 0, 1] }])
    for (let i = 0; i < 3; i++) last().receive(['game/1/clock', live.clock])
    expect(last().commands()).toEqual(['authenticate', 'game/connect', 'game/connect']) // once per reload
    last().receive(['game/1/gamedata', live])
    last().receive(['game/1/undo_accepted', 116])
    expect(last().commands()).toHaveLength(4)
  })

  it('lets disconnect win over a connect still in progress', async () => {
    const pending = ogs.connect()
    ogs.disconnect()
    await expect(pending).rejects.toThrow('ogs_offline')
    expect(ogs.me).toBe(null)
    expect(ogs.getStatus()).toBe('offline')
    expect(FakeSocket.all).toHaveLength(0)
    await ogs.connect()
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('turns network failures and unreadable bodies into codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(ogs.connect()).rejects.toMatchObject({ code: 'ogs_network' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>')))
    await expect(ogs.connect()).rejects.toMatchObject({ code: 'ogs_http' })
    expect(ogs.getStatus()).toBe('offline')
  })

  it('resolves an automatch with the started game', async () => {
    await ogs.connect()
    last().open()
    const m = ogs.findMatch(19, 'live')
    const [cmd, req] = last().sent[last().sent.length - 1]
    expect(cmd).toBe('automatch/find_match')
    last().receive(['automatch/start', { uuid: 'someone-else', game_id: 5 }])
    last().receive(['automatch/start', { uuid: req.uuid, game_id: 77 }])
    expect(await m.started).toBe(77)
    const c = ogs.findMatch(9, 'blitz')
    c.cancel()
    expect(last().sent[last().sent.length - 1]).toEqual(['automatch/cancel', { uuid: last().sent[last().sent.length - 2][1].uuid }])
  })

  it('lists finished games from my side', async () => {
    expect(await ogs.finishedGames()).toEqual([{
      id: 9, size: 19, color: -1, opponent: { id: 1001, username: 'them', rank: '3k' }, result: 'W+R', date: Date.parse('2026-10-12T22:42:02Z'),
    }])
    expect(fetches[1]).toBe('https://online-go.com/api/v1/me/games/?ended__isnull=false&ordering=-ended&page_size=10 Bearer token')
    lost = true // both sides marked lost: no winner to show
    expect((await ogs.finishedGames())[0].result).toBe('?')
  })
})
