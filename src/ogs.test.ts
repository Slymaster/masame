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

// signed in or out, inside Tauri or not, and the Rust rating-history answer
const host = vi.hoisted(() => ({ signedIn: true, tauri: true, tsv: '' }))
vi.mock('./katago', () => ({
  inTauri: () => host.tauri,
  call: vi.fn(async (cmd: string) => {
    if (cmd === 'ogs_token') { if (host.signedIn) return 'token'; throw Object.assign(new Error('ogs_login_required'), { code: 'ogs_login_required' }) }
    return cmd === 'ogs_rating_history' ? host.tsv : undefined
  }),
}))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '0.1.0' }))

const live = fixture.live.gamedata
const clone = <T>(x: T): T => structuredClone(x)
const trim = <T extends GobanEngineConfig>(d: T, n: number): T => ({ ...clone(d), moves: (d.moves as unknown[]).slice(0, n) as GobanEngineConfig['moves'] })

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
  })
  it('shows a free placement in progress: placed stones as setup, Black to play', () => {
    const g = gameFrom(trim(fixture.freeHandicap, 2))
    expect(g.info.setup.black).toEqual([[3, 15], [15, 15]])
    expect(g.info.firstSign).toBe(1)
    expect(g.moves).toEqual([])
    expect(gameFrom(trim(fixture.freeHandicap, 0)).info.setup.black).toEqual([])
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

describe('stone removal', () => {
  // . X X
  // . O .
  // . . .
  const m = [[0, 1, 1], [0, -1, 0], [0, 0, 0]] as (0 | 1 | -1)[][]
  it('flips a whole chain and reports only what changed', () => {
    expect(ogs.removalToggle(m, [], [1, 0])).toEqual({ stones: [[1, 0], [2, 0]], removed: true })
    expect(ogs.removalToggle(m, [[2, 0], [1, 1]], [2, 0])).toEqual({ stones: [[2, 0]], removed: false }) // a half-marked chain: only the marked stone changes
    expect(ogs.removalToggle(m, [], [0, 0])).toBe(null)
  })
  it('marks removed stones dead, empty points dropped', () => {
    expect(ogs.deadOf(m, [[1, 1], [0, 0]])).toEqual([[false, false, false], [false, true, false], [false, false, false]])
  })
})

describe('placement and move numbers', () => {
  it('follows a free placement stone by stone, reloading on each', () => {
    let s = apply(null, ['gamedata', trim(fixture.freeHandicap, 2)], 1001)!
    expect(s).toMatchObject({ offset: 3, placing: 1, free: true, handicap: 3 })
    expect(ogs.moveNumber(s)).toBe(2)
    expect(ogs.canPause(s)).toBe(false)
    expect(apply(s, ['move', { move_number: 3, move: [3, 3, 100] }])!.reload).toBe(true)
    s = apply(null, ['gamedata', trim(fixture.freeHandicap, 3)], 1001)!
    expect(s).toMatchObject({ placing: 0 })
    expect(s.game.info.firstSign).toBe(-1)
    expect(ogs.moveNumber(s)).toBe(3)
    expect(ogs.moveNumber(apply(null, ['gamedata', fixture.freeHandicap])!)).toBe(70)
  })
})

describe('game controls', () => {
  const at = (d: GobanEngineConfig, n: number, extra: object = {}, me = 1002) => apply(null, ['gamedata', { ...trim(d, n), ...extra }], me)!
  it('cancels within the first moves, handicap stones aside, never in competitions', () => {
    expect(ogs.canCancel(at(live, 5))).toBe(true)
    expect(ogs.canCancel(at(live, 6))).toBe(false)
    expect(ogs.canCancel(at(fixture.freeHandicap, 7))).toBe(true) // 3 stones placed, 4 moves: 7 < 5 + 3
    expect(ogs.canCancel(at(fixture.freeHandicap, 8))).toBe(false)
    expect(ogs.canCancel(at(live, 4, { free_handicap_placement: true, handicap: 0 }))).toBe(true) // even game: < 5
    expect(ogs.canCancel(at(live, 5, { free_handicap_placement: true, handicap: 0 }))).toBe(false)
    expect(ogs.canCancel(at(live, 0, { tournament_id: 7 }))).toBe(false)
    expect(ogs.canCancel(at(live, 0, { ladder_id: 7 }))).toBe(false)
    expect(ogs.canCancel(at(live, 0, { rengo: true, rengo_casual_mode: true }))).toBe(false)
    expect(ogs.canCancel(at(live, 0, { phase: 'stone removal' }))).toBe(false)
  })
  it('tracks undo requests, both ways', () => {
    let s = at(live, 115) // fixed handicap: White's 58th move is the last
    expect(ogs.canRequestUndo(s)).toBe(true)
    expect(ogs.canRequestUndo(at(live, 116))).toBe(false) // the last move is theirs
    expect(ogs.canRequestUndo(at(live, 0))).toBe(false) // no move of mine yet
    expect(ogs.canRequestUndo(at(live, 115, {}, 5))).toBe(false) // a spectator
    expect(ogs.canRequestUndo(at(live, 115, { rengo: true }))).toBe(false)
    s = apply(s, ['undo_requested', { move_number: 116, requested_by: 1001 }])!
    expect(s.undo).toEqual({ by: 1001, move: 116 })
    expect(ogs.canRequestUndo(s)).toBe(false)
    expect(ogs.canAnswerUndo(s, 1002)).toBe(true)
    expect(ogs.canAnswerUndo(s, 1001)).toBe(false)
    expect(apply(s, ['undo_canceled', null])!.undo).toBeUndefined()
    expect(apply(s, ['undo_accepted', 116])).toMatchObject({ undo: undefined, reload: true })
    expect(apply(s, ['move', { move_number: 117, move: [0, 0, 1] }])!.undo).toBeUndefined()
    // White is to move: Black, who just played, asked
    expect(apply(at(live, 116), ['undo_requested', 116])!.undo).toEqual({ by: 1001, move: 116 })
    expect(apply(at(live, 115), ['undo_requested', { move_number: '115' }])!.undo).toEqual({ by: 1002, move: 115 })
    expect(at(live, 116, { undo_requested: 116 }).undo).toEqual({ by: 1001, move: 116 })
    // legacy: a numeric string
    expect(apply(at(live, 116), ['undo_requested', '116'])!.undo).toEqual({ by: 1001, move: 116 })
    expect(at(live, 116, { undo_requested: '116' }).undo).toEqual({ by: 1001, move: 116 })
    expect(apply(at(live, 116), ['undo_requested', 'x'])!.undo).toBeUndefined()
  })
  it('tells pause kinds apart and counts my pauses', () => {
    const since = live.clock.last_move
    let s = at(live, 116, { pause_control: { paused: { pausing_player_id: 1001, pauses_left: 3 } }, paused_since: since, pauses_left_1002: 4 })
    expect(s).toMatchObject({ pause: { player: true, by: 1001, left: 3 }, pausesLeft: 4, pausedSince: since })
    expect([ogs.canPause(s), ogs.canResume(s)]).toEqual([false, true])
    expect(at(live, 116, { pause_control: { paused: { pausing_player_id: 1002, pauses_left: 2 } }, paused_since: since }).pausesLeft).toBe(2)
    s = at(live, 116, { pause_control: { paused: { pausing_player_id: 1001, pauses_left: 3 }, moderator_paused: { moderator_id: 9 } }, paused_since: since })
    expect(s.pause).toMatchObject({ player: false, moderator: true })
    expect([ogs.canPause(s), ogs.canResume(s)]).toEqual([false, false]) // the official client offers nothing under a moderator's pause
    expect([ogs.canPause(at(live, 116, { pause_control: { moderator_paused: { moderator_id: 9 } }, paused_since: since })), ogs.canResume(at(live, 116, { pause_control: { moderator_paused: { moderator_id: 9 } }, paused_since: since }))]).toEqual([false, false])
    for (const key of ['weekend', 'system', 'stone-removal', 'vacation-1001']) expect(at(live, 116, { pause_control: { [key]: true }, paused_since: since }).pause).toMatchObject({ player: false })
    s = at(live, 116, { pause_control: {}, pauses_left_1002: 0 })
    expect(s.pause).toBeUndefined()
    expect(ogs.canPause(s)).toBe(false) // none left
    s = at(live, 116)
    expect(ogs.canPause(s)).toBe(true)
    expect(ogs.canPause(at(live, 116, {}, 5))).toBe(false)
    // as the official usePauseControl: never with vacation disabled, in any phase but finished, through non-player pauses
    expect(ogs.canPause(at(live, 116, { disable_vacation: true }))).toBe(false)
    expect(ogs.canPause(at(live, 116, { phase: 'stone removal' }))).toBe(true)
    expect(ogs.canPause(at(live, 116, { phase: 'finished' }))).toBe(false)
    for (const key of ['weekend', 'system', 'vacation-1001']) expect(ogs.canPause(at(live, 116, { pause_control: { [key]: true }, paused_since: since }))).toBe(true)
    s = apply(s, ['clock', { ...live.clock, pause: { paused: true, paused_since: since, pause_control: { paused: { pausing_player_id: 1002, pauses_left: 1 } } } }], 1002)!
    expect(s).toMatchObject({ pause: { player: true, by: 1002 }, pausesLeft: 1 })
    s = apply(s, ['clock', { ...live.clock, pause: { paused: false } }], 1002)!
    expect(s.pause).toBeUndefined()
    expect(s.pausesLeft).toBe(1)
  })
  it('takes free placement from goban defaults, as the board does', () => {
    const d = { ...clone(fixture.freeHandicap), rules: 'chinese' } as Partial<GobanEngineConfig>
    delete d.free_handicap_placement // Chinese rules: free by default
    const s = at(d as GobanEngineConfig, 10, {}, 1001)
    expect(s).toMatchObject({ free: true, handicap: 3, offset: 3, placing: 0 })
    expect(s.game.moves).toHaveLength(7)
    expect(ogs.moveNumber(s)).toBe(10)
  })
  it('reads the competition, correspondence and rematch settings', () => {
    const s = at(live, 10)
    expect(s).toMatchObject({ competition: false, corr: false, free: false, handicap: 2 })
    expect(at(live, 0, { time_per_move: 86400 }).corr).toBe(true)
    expect(at(live, 0, { time_control: { ...live.time_control, speed: 'correspondence' } }).corr).toBe(true)
    expect(s.settings).toEqual({ rules: 'japanese', ranked: true, width: 19, height: 19, handicap: 2, komi: 0.5, time_control: live.time_control, disable_analysis: true, pause_on_weekends: false, private: false })
  })
})

describe('matching and challenges', () => {
  it('asks Fischer only for correspondence', () => {
    expect(findMatchRequest(13, 'correspondence', 'u').size_speed_options).toEqual([{ size: '13x13', speed: 'correspondence', system: 'fischer' }])
  })
  it('keeps the official presets', () => {
    expect(ogs.PRESETS[19].live).toEqual({ system: 'byoyomi', time_control: 'byoyomi', speed: 'live', main_time: 1200, period_time: 30, periods: 5, pause_on_weekends: false })
    expect(ogs.PRESETS[9].blitz).toMatchObject({ main_time: 30, periods: 5, period_time: 10 })
    expect(ogs.PRESETS[13].rapid).toMatchObject({ main_time: 180, period_time: 30 })
    expect(ogs.PRESETS[9].correspondence).toEqual({ system: 'fischer', time_control: 'fischer', speed: 'correspondence', initial_time: 259200, time_increment: 86400, max_time: 604800, pause_on_weekends: false })
  })
  it('builds a challenge like the official modal', () => {
    expect(ogs.challengeBody({ size: 13, speed: 'rapid', ranked: true, handicap: true })).toEqual({
      min_ranking: -1000, max_ranking: 1000, challenger_color: 'automatic', rengo_auto_start: 0, invite_only: false,
      game: {
        name: 'Friendly Match', rules: 'japanese', ranked: true, width: 13, height: 13, handicap: -1, komi_auto: 'automatic', disable_analysis: false,
        initial_state: null, private: false, rengo: false, rengo_casual_mode: false, pause_on_weekends: false, time_control: 'byoyomi', time_control_parameters: ogs.PRESETS[13].rapid,
      },
    })
    expect(ogs.challengeBody({ size: 9, speed: 'correspondence', ranked: false, handicap: false }).game).toMatchObject({ handicap: 0, ranked: false, time_control: 'fischer' })
  })
  it('asks for a rematch with colours swapped', () => {
    const unranked = apply(null, ['gamedata', { ...clone(live), ranked: false }], 1002)!
    const r = ogs.rematchBody(unranked)
    expect(r).toMatchObject({ challenger_color: 'black', invite_only: false, min_ranking: -1000, max_ranking: 1000 })
    expect(r.game).toMatchObject({
      rules: 'japanese', ranked: false, width: 19, height: 19, handicap: 2, komi_auto: 'custom', komi: 0.5, disable_analysis: true, initial_state: null,
      private: false, pause_on_weekends: false, time_control: 'fischer', time_control_parameters: { ...live.time_control, time_control: 'fischer' },
    })
    const ranked = ogs.rematchBody(apply(null, ['gamedata', clone(live)], 1001)!)
    expect(ranked.challenger_color).toBe('white')
    expect(ranked.game).toMatchObject({ komi_auto: 'automatic' })
    expect(ranked.game).not.toHaveProperty('komi')
  })
})

describe('links, ranks and notices', () => {
  it('reads game ids from OGS links only', () => {
    for (const t of ['123', ' 123 ', 'https://online-go.com/game/123', 'online-go.com/game/view/123', 'https://online-go.com/game/123/', 'http://www.online-go.com/game/123?x=1'])
      expect(ogs.gameIdOf(t)).toBe(123)
    for (const t of ['', 'abc', 'https://evil.com/game/123', 'https://online-go.com.evil.com/game/123', 'https://online-go.com/player/123', '0', '12a'])
      expect(ogs.gameIdOf(t)).toBe(null)
  })
  it('turns ratings into ranks', () => {
    expect(rankLabel(ogs.rankOf(1500))).toBe('6k')
    expect(rankLabel(ogs.rankOf(1917))).toBe('1k')
    expect(rankLabel(ogs.rankOf(2000))).toBe('1d')
    expect(ogs.rankOf(10)).toBe(ogs.rankOf(100))
  })
  it('parses the rating history by column name', () => {
    const tsv = [
      'game_id\trating\tended\tdeviation\topponent_id\tannulled\tresult',
      '12\t1550.5\t1700000200\t80\t7\t0\t1',
      '0\t1500\t1600000000\t350\t0\t0\t0', // the initial entry
      '13\t1600\t1700000100\t70\t8\t1\t1', // annulled
      'garbage',
      '14\tNaN\t1700000300\t70\t8\t0\t1',
      '',
    ].join('\n')
    expect(ogs.ratingPoints(tsv)).toEqual([{ t: 1600000000_000, rating: 1500, deviation: 350 }, { t: 1700000200_000, rating: 1550.5, deviation: 80 }])
    expect(ogs.ratingPoints('')).toEqual([])
  })
  const entry = (o: object = {}) => ({ id: 5, phase: 'play', player_to_move: 1002, move_number: 30, time_per_move: 86400, width: 13, black: { id: 1001, username: 'them' }, white: { id: 1002, username: 'me' }, ...o }) as unknown as protocol.GameListEntry
  it('tells my turn in correspondence games only', () => {
    expect(ogs.turnNotice(entry(), 1002)).toEqual({ kind: 'yourTurn', key: 'turn-5-30', gameId: 5, who: 'them', size: 13 })
    expect(ogs.turnNotice(entry({ time_per_move: 60 }), 1002)).toBe(null)
    expect(ogs.turnNotice(entry({ player_to_move: 1001 }), 1002)).toBe(null)
    expect(ogs.turnNotice(entry({ phase: 'stone removal' }), 1002)).toBe(null)
  })
  it('maps fresh notifications, skipping games on screen', () => {
    const now = 1_800_000_000_000, fresh = now / 1000 - 60
    const n = (type: string, o: object = {}) => ogs.notificationNotice({ id: 'a1', type, timestamp: fresh, game_id: 8, ...o }, now, [3], 'me')
    expect(n('challenge', { user: { username: 'them' } })).toEqual({ kind: 'challenge', key: 'n-a1', gameId: 8, who: 'them' })
    expect(n('gameStarted', { black: 'me', white: 'them' })).toEqual({ kind: 'started', key: 'n-a1', gameId: 8, who: 'them' })
    expect(n('gameEnded', { black: 'them', white: 'me', outcome: 'Resignation', black_lost: true, white_lost: false })).toMatchObject({ kind: 'ended', who: 'them', outcome: 'W+R' })
    expect(n('gameDeclined')).toMatchObject({ kind: 'declined', gameId: 8 })
    expect(n('gameOfferRejected')).toMatchObject({ kind: 'declined' })
    expect(n('gameStarted', { game_id: 3 })).toBe(null) // already shown
    expect(ogs.notificationNotice({ id: 'b', type: 'gameEnded', time: now - 1000, game_id: 3 }, now, new Set([3]))).toBe(null)
    expect(n('challenge', { timestamp: now / 1000 - 3600 })).toBe(null) // replayed on connect
    expect(n('challenge', { timestamp: now - 1000 })).toMatchObject({ kind: 'challenge' }) // ms
    expect(n('challenge', { timestamp: undefined })).toBe(null)
    expect(n('friendRequest')).toBe(null)
  })
})

describe('dead-stone scorer', () => {
  it('encodes the final position [y][x], 1 black, 2 white', () => {
    const s = apply(null, ['gamedata', fixture.handicapOne], 1001)!
    s.game.goTo(0) // browsing does not change the request
    const r = ogs.scoreRequest(s, 'jwt')
    expect(r).toMatchObject({ width: 9, height: 9, rules: 'japanese', komi: 2.5, autoscore: true, jwt: 'jwt' })
    expect(r.player_to_move).toBe(s.game.moves.length % 2 ? 'white' : 'black')
    const final = s.game.boards[s.game.boards.length - 1].signMap
    expect(r.board_state).toHaveLength(9)
    expect(r.board_state.flat().filter(c => c === 1)).toHaveLength(final.flat().filter(c => c === 1).length)
    expect(r.board_state.flat().filter(c => c === 2)).toHaveLength(final.flat().filter(c => c === -1).length)
    expect(final[4][4]).not.toBe(0)
    expect(r.board_state[4][4]).toBe(final[4][4] === 1 ? 1 : 2)
  })
  it('reads the removed stones from the answer', () => {
    expect(ogs.removedFrom({ autoscored_removed: [{ x: 1, y: 2 }, { x: 3, y: 0 }], autoscored_needs_sealing: [{ x: 0, y: 0 }] }))
      .toEqual({ stones: [[1, 2], [3, 0]], needsSealing: [{ x: 0, y: 0 }] })
    expect(ogs.removedFrom({ autoscored_removed: [] })).toEqual({ stones: [], needsSealing: undefined })
    expect(ogs.removedFrom({ ownership: [] })).toBe(null)
    expect(ogs.removedFrom({ autoscored_removed: [{ x: 'a' }] })).toBe(null)
    expect(ogs.removedFrom(null)).toBe(null)
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
  // every request, and a per-test answer (a value as JSON, a Response as is; undefined: the defaults below)
  const calls: { url: string; method: string; auth?: string; type?: string; body?: any }[] = []
  let reply: (url: string, method: string) => unknown = () => undefined
  let lost = false
  beforeEach(() => {
    FakeSocket.all = []
    fetches.length = 0
    calls.length = 0
    reply = () => undefined
    lost = false
    host.signedIn = true
    host.tauri = true
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => {
      fetches.push(`${url} ${init.headers.Authorization}`)
      const method = init.method ?? 'GET'
      calls.push({ url, method, auth: init.headers.Authorization, type: init.headers['Content-Type'], body: init.body && JSON.parse(init.body) })
      const custom = reply(url, method)
      if (custom instanceof Response) return custom
      const body = custom ?? (url.endsWith('/ui/config') ? (init.headers.Authorization ? { user_jwt: 'jwt-1', user: { id: 1002, username: 'me', ranking: 30.2 } } : { user_jwt: 'guest-jwt', user: { id: 0, username: 'Guest', anonymous: true } })
        : url.includes('/me/challenges/') ? { results: [] }
        : { results: [{ id: 9, width: 19, players: { black: { id: 1001, username: 'them', ranking: 27.5 }, white: { id: 1002, username: 'me' } }, outcome: 'Resignation', black_lost: true, white_lost: lost, started: '2026-10-12T22:20:00Z', ended: '2026-10-12T22:42:02Z' }] })
      return new Response(JSON.stringify(body))
    }))
  })
  afterEach(() => {
    ogs.disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const online = async () => { await ogs.connect(); const a = last(); a.open(); return a }

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
    expect(a.commands()).toEqual(['authenticate', 'automatch/list', 'game/connect'])
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
    expect(b.commands()).toEqual(['authenticate', 'automatch/list', 'game/connect'])
    expect(b.sent[0][1].jwt).toBe('jwt-2')
    expect(b.sent.find(m => m[0] === 'game/connect')![1]).toEqual({ game_id: 1, chat: false })

    ogs.move(1, [3, 3])
    ogs.move(1, null)
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
    const events: ogs.GameEvent[] = []
    ogs.follow(1, e => events.push(e))
    last().receive(['game/1/gamedata', live])
    last().receive(['game/1/move', { game_id: 1, move_number: 200, move: [0, 0, 1] }])
    for (let i = 0; i < 3; i++) last().receive(['game/1/clock', live.clock])
    expect(last().commands()).toEqual(['authenticate', 'automatch/list', 'game/connect', 'game/connect']) // once per reload
    last().receive(['game/1/gamedata', live])
    last().receive(['game/1/undo_accepted', 116])
    expect(last().commands()).toHaveLength(5)
    last().receive(['game/1/gamedata', live])
    last().receive(['game/1/error', 'Illegal move'])
    last().receive(['game/1/error', 'Illegal move'])
    expect(events.at(-1)).toMatchObject(['error', { code: 'ogs_refused', detail: 'Illegal move' }])
    expect(last().commands()).toHaveLength(6) // a refused move: the game is fetched again, once
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
    const r = ogs.findMatch(13, 'rapid'), asked = last().sent.filter(x => x[0] === 'automatch/find_match')
    last().end(1006)
    vi.advanceTimersByTime(1000)
    last().open()
    expect(last().commands()).toEqual(['authenticate', 'automatch/list', 'automatch/find_match']) // the pending search, asked again
    expect(last().sent.find(m => m[0] === 'automatch/find_match')![1].uuid).toBe(asked[asked.length - 1][1].uuid)
    r.cancel()
    const c = ogs.findMatch(9, 'blitz')
    c.cancel()
    expect(last().sent[last().sent.length - 1]).toEqual(['automatch/cancel', { uuid: last().sent[last().sent.length - 2][1].uuid }])
  })

  it('forgets a search cancelled by uuid: a reconnect does not ask for it again', async () => {
    const a = await online()
    const finds = () => last().sent.filter(m => m[0] === 'automatch/find_match').length
    const reconnect = () => { last().end(1006); vi.advanceTimersByTime(1000); last().open() }
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('c9-0-0-0-0')
    a.receive(['automatch/entry', findMatchRequest(9, 'correspondence', 'c9-0-0-0-0')]) // the server's list first: one row all the same
    ogs.findMatch(9, 'correspondence')
    expect(ogs.searches.get()).toEqual([{ uuid: 'c9-0-0-0-0', size: 9, speed: 'correspondence' }])
    ogs.cancelSearch('c9-0-0-0-0')
    reconnect()
    expect(finds()).toBe(0)
    ogs.findMatch(13, 'correspondence') // cancelled elsewhere: the server says so
    last().receive(['automatch/cancel', { uuid: last().sent.at(-1)![1].uuid }])
    reconnect()
    expect(finds()).toBe(0)
    ogs.findMatch(19, 'correspondence')
    ogs.disconnect()
    await ogs.connect()
    last().open()
    expect(finds()).toBe(0)
  })

  it('lists finished games from my side', async () => {
    expect((await ogs.history(1)).rows).toEqual([{
      id: 9, size: 19, color: -1, opponent: { id: 1001, username: 'them', rank: '3k' }, result: 'W+R', date: Date.parse('2026-10-12T22:42:02Z'),
    }])
    expect(fetches[1]).toBe('https://online-go.com/api/v1/me/games/?ended__isnull=false&ordering=-ended&page_size=20&page=1 Bearer token')
    lost = true // both sides marked lost: no winner to show
    expect((await ogs.history(1)).rows[0].result).toBe('?')
  })

  it('sends cancel, undo and pause', async () => {
    const a = await online()
    ogs.cancelGame(1)
    ogs.requestUndo(1, 116); ogs.acceptUndo(1, 116); ogs.cancelUndo(1, 116)
    ogs.pauseGame(1); ogs.resumeGame(1)
    expect(a.sent.slice(-6)).toEqual([
      ['game/cancel', { game_id: 1 }],
      ['game/undo/request', { game_id: 1, move_number: 116 }], ['game/undo/accept', { game_id: 1, move_number: 116 }], ['game/undo/cancel', { game_id: 1, move_number: 116 }],
      ['game/pause', { game_id: 1 }], ['game/resume', { game_id: 1 }],
    ])
  })

  it('keeps my correspondence searches from the server and from findMatch', async () => {
    const a = await online(), notices: ogs.Notice[] = []
    const off = ogs.onNotice(n => notices.push(n))
    a.receive(['automatch/entry', findMatchRequest(19, 'correspondence', 'c1')])
    a.receive(['automatch/entry', findMatchRequest(9, 'live', 'l1')]) // live: not listed
    a.receive(['automatch/entry', findMatchRequest(19, 'correspondence', 'c1')])
    expect(ogs.searches.get()).toEqual([{ uuid: 'c1', size: 19, speed: 'correspondence' }])
    const ref = ogs.searches.get()
    a.receive(['automatch/cancel', { uuid: 'other' }])
    expect(ogs.searches.get()).toBe(ref)
    const m = ogs.findMatch(13, 'correspondence')
    const uuid = a.sent.at(-1)![1].uuid
    expect(a.sent.at(-1)![1].size_speed_options).toEqual([{ size: '13x13', speed: 'correspondence', system: 'fischer' }])
    expect(ogs.searches.get()).toEqual([{ uuid: 'c1', size: 19, speed: 'correspondence' }, { uuid, size: 13, speed: 'correspondence' }])
    a.receive(['automatch/start', { uuid: 'c1', game_id: 40 }])
    expect(notices).toEqual([{ kind: 'started', key: 'started-40', gameId: 40 }])
    expect(ogs.searches.get()).toHaveLength(1)
    ogs.cancelSearch(uuid)
    expect(a.sent.at(-1)).toEqual(['automatch/cancel', { uuid }])
    expect(ogs.searches.get()).toEqual([])
    a.receive(['automatch/entry', findMatchRequest(9, 'correspondence', 'c2')])
    a.receive(['automatch/cancel', { uuid: null }]) // all of them
    expect(ogs.searches.get()).toEqual([])
    m.cancel()
    a.receive(['automatch/start', { uuid: 'l1', game_id: 41 }]) // not a correspondence search: no notice
    expect(notices).toHaveLength(1)
    a.end(1006)
    vi.advanceTimersByTime(1000)
    last().open()
    expect(last().commands()).toContain('automatch/list')
    off()
  })

  it('seeds my games from REST, then follows active_game', async () => {
    const page1 = 'https://online-go.com/api/v1/me/games/?ended__isnull=true&ordering=-id&page_size=100'
    const them = { id: 1001, username: 'them', ranking: 27.5 }, mine = { id: 1002, username: 'me', ranking: 30.2 }
    reply = url => url === page1 ? { results: [{ id: 21, width: 19, players: { black: mine, white: them }, time_per_move: 86400 }], next: 'https://online-go.com/api/v1/me/games/?page=2' }
      : url.endsWith('?page=2') ? { results: [{ id: 20, width: 9, players: { black: them, white: mine }, time_per_move: 30 }], next: 'https://elsewhere.example/api' } : undefined
    const notices: ogs.Notice[] = [], off = ogs.onNotice(n => notices.push(n))
    const a = await online()
    expect(ogs.active.get()).toBe(null)
    await vi.waitFor(() => expect(ogs.active.get()).not.toBe(null))
    expect(calls.filter(c => c.url.includes('/me/games/')).map(c => c.url)).toEqual([page1, 'https://online-go.com/api/v1/me/games/?page=2']) // never another host
    const opp = { id: 1001, username: 'them', rank: '3k' }
    expect(ogs.active.get()).toEqual([
      { id: 21, size: 19, opponent: opp, color: 1, myTurn: false, corr: true, phase: 'play', move: 0 },
      { id: 20, size: 9, opponent: opp, color: -1, myTurn: false, corr: false, phase: 'play', move: 0 },
    ])
    const entry = (o: object) => ({ id: 21, phase: 'play', player_to_move: 1002, move_number: 12, time_per_move: 86400, clock_expiration: 1_800_000_000, paused: false, width: 19, height: 19, black: { id: 1002, username: 'me', rank: 30.2 }, white: { id: 1001, username: 'them', rank: 27.5 }, ...o })
    a.receive(['active_game', entry({})])
    expect(ogs.active.get()![0]).toEqual({ id: 21, size: 19, opponent: opp, color: 1, myTurn: true, corr: true, phase: 'play', move: 12, expires: 1_800_000_000_000 })
    expect(notices).toEqual([{ kind: 'yourTurn', key: 'turn-21-12', gameId: 21, who: 'them', size: 19 }])
    a.receive(['active_game', entry({})]) // replayed: told once
    expect(notices).toHaveLength(1)
    a.receive(['active_game', entry({ id: 30, width: 13, time_per_move: 20 })]) // a game REST did not list yet
    expect(ogs.active.get()!.map(r => r.id)).toEqual([21, 20, 30])
    a.receive(['active_game', entry({ id: 20, phase: 'finished' })])
    expect(ogs.active.get()!.map(r => r.id)).toEqual([21, 30])
    const ref = ogs.active.get()
    expect(ogs.active.get()).toBe(ref)
    ogs.disconnect()
    expect([ogs.active.get(), ogs.searches.get(), ogs.challenges.get()]).toEqual([null, [], []])
    off()
  })

  it('connects as a guest when signed out, then switches once signed in', async () => {
    host.signedIn = false
    await expect(ogs.connect()).rejects.toMatchObject({ code: 'ogs_login_required' })
    expect(await ogs.connect({ guest: true })).toBe(null)
    expect([ogs.me, ogs.isGuest()]).toEqual([null, true])
    expect(calls.at(-1)).toMatchObject({ url: 'https://online-go.com/api/v1/ui/config', auth: undefined })
    const g = last()
    g.open()
    expect(g.commands()).toEqual(['authenticate']) // no automatch list, no seeds
    expect(g.sent[0][1].jwt).toBe('guest-jwt')
    await expect(ogs.connect()).rejects.toMatchObject({ code: 'ogs_login_required' }) // the guest session stays
    expect(ogs.isGuest()).toBe(true)
    expect(ogs.getStatus()).toBe('online')
    expect(await ogs.connect({ guest: true })).toBe(null)
    expect(FakeSocket.all).toHaveLength(1)
    host.signedIn = true
    expect(await ogs.connect()).toMatchObject({ id: 1002 })
    expect(ogs.isGuest()).toBe(false)
    expect(g.readyState).toBe(3)
    expect(FakeSocket.all).toHaveLength(2)
    expect(await ogs.connect({ guest: true })).toMatchObject({ id: 1002 }) // a signed-in session serves guests too
  })

  it('starts in the background silently, only in the app', async () => {
    host.signedIn = false
    ogs.startBackground()
    expect(ogs.getStatus()).toBe('connecting')
    await vi.waitFor(() => expect(ogs.getStatus()).toBe('offline'))
    expect(FakeSocket.all).toHaveLength(0)
    host.signedIn = true
    host.tauri = false
    ogs.startBackground()
    expect(ogs.getStatus()).toBe('offline')
    host.tauri = true
    ogs.startBackground()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
  })

  it('keeps a live challenge alive every second until stopped', async () => {
    const a = await online()
    const sent = () => a.sent.filter(m => m[0] === 'challenge/keepalive')
    const stop = ogs.keepAlive(3, 4)
    expect(sent()).toEqual([['challenge/keepalive', { challenge_id: 3, game_id: 4 }]])
    vi.advanceTimersByTime(2500)
    expect(sent()).toHaveLength(3)
    stop()
    vi.advanceTimersByTime(3000)
    expect(sent()).toHaveLength(3)
    ogs.keepAlive(3, 4)
    ogs.disconnect() // clears it too
    vi.advanceTimersByTime(3000)
    expect(sent()).toHaveLength(4)
  })

  describe('dead stones without a proposal', () => {
    const SCORER = 'https://ai.online-go.com/api/score'
    const start = async (d: unknown = live) => {
      const a = await online(), events: [string, ogs.Followed | null][] = []
      ogs.follow(1, (e, s) => events.push([e[0], s]))
      a.receive(['game/1/gamedata', d])
      return { a, events, scoring: () => events.at(-1)![1]?.scoring }
    }
    const scorerCalls = () => calls.filter(c => c.url === SCORER)

    it('asks the scorer after 15 s and proposes its dead stones', async () => {
      reply = url => (url === SCORER ? { autoscored_removed: [{ x: 9, y: 2 }, { x: 9, y: 4 }], autoscored_needs_sealing: [{ x: 1, y: 1 }] } : undefined)
      const { a, events, scoring } = await start()
      a.receive(['game/1/phase', 'stone removal'])
      expect(scoring()).toBe('waiting')
      a.receive(['user/jwt', 'jwt-2'])
      vi.advanceTimersByTime(14_999)
      expect(scorerCalls()).toHaveLength(0)
      vi.advanceTimersByTime(1)
      await vi.waitFor(() => expect(events.at(-1)![0]).toBe('scoring'))
      expect(scorerCalls()).toEqual([expect.objectContaining({ method: 'POST', type: 'application/json', body: expect.objectContaining({ jwt: 'jwt-2', autoscore: true, width: 19, rules: 'japanese' }) })])
      expect(a.sent.at(-1)).toEqual(['game/removed_stones/set', { game_id: 1, removed: true, stones: 'jcje', needs_sealing: [{ x: 1, y: 1 }], auto_scored: true }])
      expect(scoring()).toBeUndefined()
    })
    it('asks at once when OGS says its scoring failed; a failed scorer leaves manual marking', async () => {
      reply = url => (url === SCORER ? new Response('no', { status: 500 }) : undefined)
      const { a, scoring, events } = await start({ ...clone(live), phase: 'stone removal' })
      expect(scoring()).toBe('waiting')
      a.receive(['game/1/auto_scoring_failed', {}])
      await vi.waitFor(() => expect(scoring()).toBe('failed'))
      expect(events.at(-1)![0]).toBe('scoring')
      expect(scorerCalls()).toHaveLength(1)
      vi.advanceTimersByTime(20_000)
      expect(scorerCalls()).toHaveLength(1) // the timer went with it
      a.receive(['game/1/phase', 'play'])
      expect(scoring()).toBeUndefined()
    })
    it('stands down when a proposal arrives, or when the game already has one', async () => {
      const { a, scoring } = await start()
      a.receive(['game/1/phase', 'stone removal'])
      a.receive(['game/1/removed_stones', { removed: true, stones: 'jc', all_removed: 'jc' }]) // a player's mark: no proposal
      expect(scoring()).toBe('waiting')
      a.receive(['game/1/removed_stones', { removed: true, stones: 'jc', all_removed: 'jc', auto_scored: true }])
      expect(scoring()).toBeUndefined()
      vi.advanceTimersByTime(20_000)
      expect(scorerCalls()).toHaveLength(0)
      a.receive(['game/1/gamedata', { ...clone(live), phase: 'stone removal', auto_scoring_done: true }])
      expect(scoring()).toBeUndefined()
      vi.advanceTimersByTime(20_000)
      expect(scorerCalls()).toHaveLength(0)
    })
    it('leaves other sizes and spectators alone', async () => {
      const odd = { ...clone(live), width: 7, height: 7, moves: [], initial_state: { black: '', white: '' }, phase: 'stone removal' }
      const { scoring } = await start(odd)
      expect(scoring()).toBe('failed')
      ogs.disconnect()
      const a = await online(), states: (ogs.Followed | null)[] = []
      ogs.follow(1, (_, s) => states.push(s))
      a.receive(['game/1/gamedata', { ...clone(live), players: { black: { id: 5, username: 'x' }, white: { id: 6, username: 'y' } }, phase: 'stone removal' }])
      expect(states.at(-1)!.scoring).toBeUndefined()
    })
  })

  it('finds players and sends, accepts, declines challenges', async () => {
    const row = {
      id: 9, challenger: { id: 1001, username: 'them', ranking: 27.5 }, challenged: { id: 1002, username: 'me', ranking: 30.2 }, challenger_color: 'automatic',
      game: { id: 99, width: 9, height: 9, ranked: true, handicap: 0, time_per_move: 20, time_control_parameters: JSON.stringify({ speed: 'blitz', system: 'byoyomi' }) },
    }
    let accept: unknown = { game: 66 }
    reply = (url, method) => url.includes('/players/?username=') ? { results: url.endsWith('nobody') ? [] : [{ id: 77, username: 'kim lee', ranking: 31 }] }
      : url.endsWith('/players/77/challenge') ? { challenge: 5, game: { id: 6 } }
      : url.endsWith('/accept') ? accept
      : method === 'DELETE' ? new Response(null, { status: 204 })
      : url.includes('/me/challenges/') ? { results: [row] } : undefined
    const a = await online()
    await vi.waitFor(() => expect(ogs.challenges.get()).toHaveLength(1))
    expect(ogs.challenges.get()).toEqual([{ id: 9, gameId: 99, from: { id: 1001, username: 'them', rank: '3k' }, to: { id: 1002, username: 'me', rank: '1d' }, mine: false, size: 9, speed: 'blitz', ranked: true, handicap: 0 }])
    const refreshes = () => calls.filter(c => c.url.includes('/me/challenges/?')).length
    a.receive(['notification', { id: 'z', type: 'challenge', timestamp: 1 }]) // stale: no notice, but a refresh
    await vi.waitFor(() => expect(refreshes()).toBe(2))

    expect(await ogs.findPlayer('kim lee')).toEqual({ id: 77, username: 'kim lee', rank: '2d' })
    expect(calls.at(-1)!.url).toBe('https://online-go.com/api/v1/players/?username=kim%20lee')
    await expect(ogs.findPlayer('nobody')).rejects.toMatchObject({ code: 'ogs_no_player' })

    const body = ogs.challengeBody({ size: 9, speed: 'blitz', ranked: false, handicap: false })
    expect(await ogs.challenge(77, body)).toEqual({ challengeId: 5, gameId: 6 })
    expect(calls.find(c => c.url.endsWith('/challenge'))).toEqual({ url: 'https://online-go.com/api/v1/players/77/challenge', method: 'POST', auth: 'Bearer token', type: 'application/json', body })

    await ogs.declineChallenge(9)
    expect(calls.find(c => c.method === 'DELETE')).toMatchObject({ url: 'https://online-go.com/api/v1/me/challenges/9', type: undefined })
    expect(await ogs.acceptChallenge(9)).toBe(66)
    expect(calls.find(c => c.url.endsWith('/accept'))).toMatchObject({ method: 'POST', body: {} })
    accept = {}
    expect(await ogs.acceptChallenge(9)).toBe(99) // from the list
    await vi.waitFor(() => expect(refreshes()).toBe(6))
  })

  it('notifies fresh notifications', async () => {
    const a = await online(), notices: ogs.Notice[] = []
    const off = ogs.onNotice(n => notices.push(n))
    a.receive(['notification', { id: 'g1', type: 'gameStarted', timestamp: Date.now() / 1000, game_id: 50, black: 'them', white: 'me' }])
    expect(notices).toEqual([{ kind: 'started', key: 'n-g1', gameId: 50, who: 'them' }])
    off()
  })

  it('lists live games through the socket callback', async () => {
    host.signedIn = false
    await ogs.connect({ guest: true })
    const a = last()
    a.open()
    const p = ogs.liveGames()
    const q = a.sent.find(m => m[0] === 'gamelist/query')!
    expect(q[1]).toEqual({ list: 'live', sort_by: 'rank', where: { hide_bot_games: true }, from: 0, limit: 20 })
    a.receive([(q as unknown[])[2], { results: [{ id: 5, width: 19, move_number: 40, black: { id: 1, username: 'a', rank: 30.5 }, white: { id: 2, username: 'b', rank: 25 } }] }])
    expect(await p).toEqual([{ id: 5, size: 19, move: 40, black: { id: 1, username: 'a', rank: '1d' }, white: { id: 2, username: 'b', rank: '5k' } }])
  })

  it('reads games, SGF, history pages and my rating', async () => {
    reply = url => url.endsWith('/games/404') ? new Response('', { status: 404 })
      : url.endsWith('/games/7') ? { id: 7, ended: '2026-01-01T00:00:00Z', players: { black: { id: 1002 }, white: { id: 3 } } }
      : url.endsWith('/sgf') ? new Response('(;GM[1])')
      : url.includes('ended__isnull=false') ? { results: [], next: url.endsWith('&page=1') ? 'https://online-go.com/x' : null } : undefined
    host.signedIn = false
    expect(await ogs.sgf(4)).toBe('(;GM[1])')
    expect(calls.at(-1)).toMatchObject({ url: 'https://online-go.com/api/v1/games/4/sgf', auth: undefined })
    await expect(ogs.gameInfo(404)).rejects.toMatchObject({ code: 'ogs_no_game' })
    expect(await ogs.gameInfo(7)).toEqual({ id: 7, ended: true, mine: false })
    host.signedIn = true
    await ogs.connect()
    expect(await ogs.gameInfo(7)).toEqual({ id: 7, ended: true, mine: true })
    expect(await ogs.history(1)).toEqual({ rows: [], more: true })
    expect(calls.at(-1)).toMatchObject({ url: 'https://online-go.com/api/v1/me/games/?ended__isnull=false&ordering=-ended&page_size=20&page=1', auth: 'Bearer token' })
    expect(await ogs.history(2)).toEqual({ rows: [], more: false })
    lost = false
    reply = () => undefined
    expect(await ogs.history(3)).toEqual({ rows: [expect.objectContaining({ id: 9, result: 'W+R' })], more: false })
    host.tsv = 'ended\trating\tdeviation\n1700000000\t1917\t60\n1600000000\t1500\t350'
    expect(await ogs.ratingHistory()).toEqual([
      { t: 1600000000_000, rank: ogs.rankOf(1500) },
      { t: 1700000000_000, rank: ogs.rankOf(1917) },
    ])
  })
})
