// OGS (online-go.com) client: protocol helpers (pure, tested) and one shared socket session.
// OGS forbids engine help in ongoing games: nothing here talks to KataGo.

import { char2num, encodeMove, GobanEngine, GobanSocket, type AdHocPackedMove, type GobanEngineConfig, type GobanEnginePhase, type GobanEngineRules, type JGOFTimeControl, type protocol } from 'goban-engine'
import { Game, type Sign, type Vertex } from './game'
import { getVersion } from '@tauri-apps/api/app'
import { call, inTauri } from './katago'
import { noDead, toggleDead, type Dead } from './scoring'
import { scoreResult } from './sgf'

const SITE = 'https://online-go.com'
const SCORER = 'https://ai.online-go.com/api/score'
// The app-wide error shape: failureText reads `code` (texts live in the i18n failures table).
const fail = (code: string, detail?: string) => Object.assign(new Error(code), { code, detail })
// unix seconds or ms, as OGS mixes both
const ms = (t: number) => (t < 2e10 ? t * 1000 : t)

/** 2-letter OGS coordinates, x then y from the top-left; ".." is a pass. */
export const toOgs = (v: Vertex | null) => (v ? encodeMove(v[0], v[1]) : '..')
export function fromOgs(m: string | AdHocPackedMove): Vertex | null {
  const [x, y] = typeof m === 'string' ? [char2num(m[0]), char2num(m[1])] : m
  return x < 0 || y < 0 ? null : [x, y]
}
export const stonesOf = (s: string) => (s.match(/../g) ?? []).map(fromOgs).filter((v): v is Vertex => !!v)
export const stonesString = (vs: Vertex[]) => vs.map(toOgs).join('')

/** OGS ranking float: 30 is 1d, anything below is kyu (29.9 → 1k). shortcut: no pro ranks. */
export const rankLabel = (r: number | undefined) =>
  r === undefined || !Number.isFinite(r) ? '' : r < 30 ? `${30 - Math.floor(r)}k` : `${Math.floor(r) - 29}d`
/** OGS rating_to_rank: a Glicko rating as a ranking float for rankLabel. */
export const rankOf = (rating: number) => Math.log(Math.min(6000, Math.max(100, rating)) / 525) * 23.15

export const hms = (ms: number) => {
  const s = Math.ceil(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** Free-placement handicap stones: OGS sends them as the first black moves; Masame keeps them as setup. */
const freeStones = (d: GobanEngineConfig) => (d.free_handicap_placement && (d.handicap ?? 0) > 1 ? d.handicap! : 0)

/** The game so far; during a free placement, the stones placed yet are setup and Black is to play. */
export function gameFrom(data: GobanEngineConfig): Game {
  const d = GobanEngine.fillDefaults(structuredClone(data)) // places fixed handicap stones when initial_state is missing
  const size = d.width!
  if (d.height !== size) throw fail('ogs_not_square', `${d.width}×${d.height}`)
  const moves = (d.moves ?? []) as AdHocPackedMove[], free = freeStones(d)
  const black = [...stonesOf(d.initial_state?.black ?? ''), ...moves.slice(0, free).map(m => fromOgs(m)!)]
  const firstSign: Sign = moves.length < free ? 1 : free || d.initial_player === 'white' ? -1 : 1
  return Game.fromRecord({
    size, komi: d.komi, playerBlack: d.players?.black.username, playerWhite: d.players?.white.username,
    setup: { black, white: stonesOf(d.initial_state?.white ?? '') }, firstSign,
  }, moves.slice(free).map((m, i) => ({ sign: (i % 2 ? -firstSign : firstSign) as Sign, vertex: fromOgs(m) })))
}

export interface Clock {
  main: number // ms; in start mode, the time left to make the first move
  periods?: number // byo-yomi periods left, the running one included
  period?: number // ms left in the byo-yomi period or the Canadian block
  stones?: number // Canadian stones left in the block
  running: boolean
}

/**
 * One side's clock now (local ms) given the server clock and GobanSocket.clock_drift; null without time control.
 * `pausedSince`: Followed.pausedSince, not clock.paused_since, which OGS leaves behind after a pause ends.
 */
export function clockOf(c: protocol.GameClock, color: Sign, now: number, drift: number, pausedSince?: number): Clock | null {
  const t = color === 1 ? c.black_time : c.white_time
  if (t === undefined) return null
  const server = now - drift, moving = c.current_player === (color === 1 ? c.black_player_id : c.white_player_id)
  const running = moving && !pausedSince
  if (moving && c.start_mode) return { main: Math.max(0, c.expiration - server), running }
  const elapsed = !moving ? 0 : pausedSince ? Math.max(pausedSince, c.last_move) - c.last_move : Math.max(0, server - c.last_move)
  if (typeof t === 'number') return { main: Math.max(0, t * 1000 - elapsed), running } // simple: per-move time
  const left = t.thinking_time * 1000 - elapsed, main = Math.max(0, left), over = Math.max(0, -left)
  if ('periods' in t) {
    // the period restarts after each move (the clock's expiration counts full periods): period_time_left is not used
    const pt = t.period_time * 1000, used = Math.floor(over / pt), periods = Math.max(0, t.periods - used)
    return { main, periods, period: periods ? pt - (over - used * pt) : 0, running }
  }
  if ('moves_left' in t) return { main, period: Math.max(0, t.block_time * 1000 - over), stones: t.moves_left, running }
  return { main, running } // absolute, fischer
}

export interface Result {
  re: string // SGF RE: "B+R", "W+T", "B+4.5", "W+F", "Void", "0", "?" (winner unknown)
  winner: Sign | 0
  how: 'resign' | 'time' | 'score' | 'forfeit' | 'cancel'
  points?: number
}

type Players = { black: { id: number }; white: { id: number } }
export function resultOf(d: { winner?: number | string; outcome?: string; players?: Players }): Result {
  const o = d.outcome ?? '', w = d.winner
  const winner: Sign | 0 = w === 'black' || (w !== undefined && w === d.players?.black.id) ? 1
    : w === 'white' || (w !== undefined && w === d.players?.white.id) ? -1 : 0
  if (/cancel/i.test(o)) return { re: 'Void', winner: 0, how: 'cancel' }
  const pts = /^([\d.]+) points?$/.exec(o)
  if (pts) {
    const points = +pts[1]
    return { re: winner || !points ? scoreResult(winner * points) : '?', winner, how: 'score', points }
  }
  // anything else: disconnection, abandonment, disqualification, moderator decision
  const [how, tag] = /resign/i.test(o) ? ['resign', 'R'] as const : /timeout/i.test(o) ? ['time', 'T'] as const : ['forfeit', 'F'] as const
  return { re: winner ? `${winner === 1 ? 'B' : 'W'}+${tag}` : '?', winner, how }
}
// REST rows and notifications say who lost, not who won
const lostWinner = (g: { black_lost?: boolean; white_lost?: boolean }) =>
  g.white_lost && !g.black_lost ? 'black' : g.black_lost && !g.white_lost ? 'white' : undefined

// Paused as goban decides it (src/Goban/OGSConnectivity.ts, setGameClock): the gamedata's pause_control, replaced by
// clock.pause whenever a clock carries one; paused while that control has any key.
const pauseOf = (control: object | undefined, since: number | undefined) =>
  control && Object.keys(control).length && since ? ms(since) : undefined // old records: seconds
type PauseControl = { paused?: { pausing_player_id?: number; pauses_left?: number }; moderator_paused?: unknown; [key: string]: unknown }
// only a player's own pause may be resumed by a player; a moderator's overrides it
const pauseFrom = (pc: PauseControl | undefined): Followed['pause'] =>
  pc && Object.keys(pc).length ? { player: !!pc.paused && !('moderator_paused' in pc), by: pc.paused?.pausing_player_id, left: pc.paused?.pauses_left } : undefined

export type BoardSize = 9 | 13 | 19
export type Speed = 'blitz' | 'rapid' | 'live' | 'correspondence'
/** The official client's defaults: ±3 ranks, any rules, handicap allowed, either clock (correspondence: Fischer only). */
export const findMatchRequest = (size: BoardSize, speed: Speed, uuid: string): protocol.AutomatchPreferences => ({
  uuid,
  size_speed_options: (speed === 'correspondence' ? ['fischer'] as const : ['byoyomi', 'fischer'] as const)
    .map(system => ({ size: `${size}x${size}` as protocol.Size, speed, system })),
  lower_rank_diff: 3, upper_rank_diff: 3,
  rules: { condition: 'no-preference', value: 'japanese' },
  handicap: { condition: 'no-preference', value: 'enabled' },
})

export type TimeParams = Record<string, string | number | boolean>
const byoyomi = (speed: Speed, main_time: number, periods: number, period_time: number): TimeParams =>
  ({ system: 'byoyomi', time_control: 'byoyomi', speed, main_time, period_time, periods, pause_on_weekends: false })
const corr: TimeParams = { system: 'fischer', time_control: 'fischer', speed: 'correspondence', initial_time: 259200, time_increment: 86400, max_time: 604800, pause_on_weekends: false }
/** Challenge time controls (seconds), from the official SPEED_OPTIONS. */
export const PRESETS: Record<BoardSize, Record<Speed, TimeParams>> = {
  9: { blitz: byoyomi('blitz', 30, 5, 10), rapid: byoyomi('rapid', 120, 5, 30), live: byoyomi('live', 300, 5, 30), correspondence: corr },
  13: { blitz: byoyomi('blitz', 30, 5, 10), rapid: byoyomi('rapid', 180, 5, 30), live: byoyomi('live', 600, 5, 30), correspondence: corr },
  19: { blitz: byoyomi('blitz', 30, 5, 10), rapid: byoyomi('rapid', 300, 5, 30), live: byoyomi('live', 1200, 5, 30), correspondence: corr },
}

export interface ChallengeOptions { size: BoardSize; speed: Speed; ranked: boolean; handicap: boolean }
export interface RematchSettings {
  rules: GobanEngineRules; ranked: boolean; width: number; height: number; handicap: number; komi: number
  time_control: JGOFTimeControl; disable_analysis: boolean; pause_on_weekends: boolean; private: boolean
}
// What the official ChallengeModal getChallenge() posts for a direct challenge.
const challengeOf = (color: string, game: Record<string, unknown>) => ({
  min_ranking: -1000, max_ranking: 1000, challenger_color: color, rengo_auto_start: 0, invite_only: false,
  game: { name: 'Friendly Match', initial_state: null, rengo: false, rengo_casual_mode: false, ...game },
})
/** Body of POST /api/v1/players/{id}/challenge. */
export const challengeBody = (o: ChallengeOptions) => {
  const tc = PRESETS[o.size][o.speed]
  return challengeOf('automatic', {
    rules: 'japanese', ranked: o.ranked, width: o.size, height: o.size, handicap: o.handicap ? -1 : 0, komi_auto: 'automatic',
    disable_analysis: false, private: false, pause_on_weekends: false, time_control: tc.system, time_control_parameters: tc,
  })
}
/** The same game again, colours swapped (official challengeRematch, through getChallenge: ranked games take automatic komi). */
export const rematchBody = (s: Followed) => {
  const st = s.settings, system = st.time_control.system
  return challengeOf(s.me === 1 ? 'white' : 'black', {
    rules: st.rules, ranked: st.ranked, width: st.width, height: st.height, handicap: st.handicap,
    ...(st.ranked ? { komi_auto: 'automatic' } : { komi_auto: 'custom', komi: st.komi }),
    disable_analysis: st.disable_analysis, private: st.private, pause_on_weekends: st.pause_on_weekends,
    time_control: system, time_control_parameters: { ...st.time_control, time_control: system },
  })
}

/** A game id from "123" or an online-go.com game link; null for anything else. */
export function gameIdOf(text: string): number | null {
  const m = /^(?:(?:https?:\/\/)?(?:www\.)?online-go\.com\/game\/(?:view\/)?)?(\d+)\/?(?:[?#].*)?$/i.exec(text.trim())
  return m && +m[1] > 0 ? +m[1] : null
}

/** The v5 rating-history TSV, by column name: annulled games and unreadable lines skipped, oldest first. */
export function ratingPoints(tsv: string): { t: number; rating: number; deviation: number }[] {
  const [head = '', ...lines] = tsv.trim().split(/\r?\n/), col = head.split('\t')
  const at = (cells: string[], name: string) => cells[col.indexOf(name)]
  return lines.flatMap(line => {
    const cells = line.split('\t')
    if (cells.length < col.length || /^(1|true)$/i.test(at(cells, 'annulled') ?? '')) return []
    const t = parseFloat(at(cells, 'ended')), rating = parseFloat(at(cells, 'rating')), deviation = parseFloat(at(cells, 'deviation'))
    return [t, rating, deviation].every(Number.isFinite) ? [{ t: t * 1000, rating, deviation }] : []
  }).sort((a, b) => a.t - b.t)
}

export interface Notice {
  kind: 'yourTurn' | 'challenge' | 'started' | 'ended' | 'declined'
  key: string // the same event always gets the same key
  gameId?: number
  who?: string // the opponent's or challenger's username
  size?: number
  outcome?: string // SGF RE
}
type GameListEntry = protocol.GameListEntry
/** "Your turn" in a correspondence game. */
export const turnNotice = (e: GameListEntry, myId: number): Notice | null =>
  e.time_per_move > 3600 && e.phase === 'play' && e.player_to_move === myId
    ? { kind: 'yourTurn', key: `turn-${e.id}-${e.move_number}`, gameId: e.id, who: (e.black.id === myId ? e.white : e.black).username, size: e.width }
    : null

export type OgsNotification = { id: string; type: string; [key: string]: any }
/** An OGS notification worth showing, or null: stale ones (OGS replays them on each connect) or games already on screen. */
export function notificationNotice(n: OgsNotification, now: number, followed: Set<number> | number[], myName = me?.username): Notice | null {
  const t = n.timestamp ?? n.time
  if (typeof t !== 'number' || now - ms(t) > 600_000) return null
  const key = `n-${n.id}`, gameId = n.game_id as number | undefined
  const other = typeof n.black === 'string' && typeof n.white === 'string' ? (n.black === myName ? n.white : n.white === myName ? n.black : undefined) : undefined
  const shown = gameId !== undefined && new Set(followed).has(gameId)
  switch (n.type) {
    case 'challenge': return { kind: 'challenge', key, gameId, who: n.user?.username }
    case 'gameStarted': return shown ? null : { kind: 'started', key, gameId, who: other }
    case 'gameEnded': return shown ? null : { kind: 'ended', key, gameId, who: other, outcome: resultOf({ outcome: n.outcome, winner: lostWinner(n as { black_lost?: boolean; white_lost?: boolean }) }).re }
    case 'gameDeclined': case 'gameOfferRejected': return { kind: 'declined', key, gameId, who: n.user?.username }
    default: return null
  }
}

export interface Player { id: number; username: string; rank: string }
export interface Followed {
  id: number
  game: Game
  me: Sign | 0
  phase: GobanEnginePhase
  clock?: protocol.GameClock
  tc?: JGOFTimeControl
  rules: GobanEngineRules
  players: { black: Player; white: Player }
  removed: Vertex[]
  result?: Result
  offset: number // OGS move numbers count free handicap stones, which game holds as setup
  placing: number // free handicap stones still to place
  pausedSince?: number // server ms while the game is paused: pass to clockOf
  pause?: { player: boolean; by?: number; left?: number } // player: a player's pause, which either player may resume
  pausesLeft?: number // mine, when OGS tells
  undo?: { by: number; move: number } // a pending request: the requester's id, the OGS move number
  competition: boolean // tournament, ladder, casual rengo: no cancel
  corr: boolean
  scoring?: 'waiting' | 'failed' // dead stones: waiting for a proposal, or none came
  free: boolean
  handicap: number
  settings: RematchSettings
  reload?: boolean // out of sync: ask the server for the whole game again
}
/** [event, data]: the part of `game/<id>/<event>` after the id. */
export type GameEvent = [string, any]

/** The OGS move number: placed handicap stones plus moves. */
export const moveNumber = (s: Followed) => s.offset - s.placing + s.game.moves.length
// GobanEngine.gameCanBeCancelled
export const canCancel = (s: Followed) => s.phase === 'play' && !s.competition && moveNumber(s) < 5 + (s.free ? s.handicap : 1)
export const canRequestUndo = (s: Followed) => s.me !== 0 && s.phase === 'play' && !s.placing && !s.undo && s.game.moves.some(m => m.sign === s.me)
export const canAnswerUndo = (s: Followed, myId: number) => s.me !== 0 && s.phase === 'play' && !!s.undo && s.undo.by !== myId
export const canPause = (s: Followed) => s.me !== 0 && s.phase === 'play' && !s.pause && !s.placing && s.pausesLeft !== 0
export const canResume = (s: Followed) => s.me !== 0 && !!s.pause?.player

const player = (p: { id: number; username: string; rank?: number }): Player => ({ id: p.id, username: p.username, rank: rankLabel(p.rank) })
const same = (a: Vertex | null, b: Vertex | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
// fields goban-engine 8.3's config type lacks
type Data = GobanEngineConfig & { [key: string]: any }
// whoever is not to move asked: undo requests come right after one's own move
const notToMove = (s: Followed) => (s.game.toPlay === 1 ? s.players.white.id : s.players.black.id)

/** The next state of a followed game; nothing until the first gamedata. Throws (gameFrom) on a game Masame cannot show. */
export function apply(s: Followed | null, [event, data]: GameEvent, myId?: number): Followed | null {
  if (event === 'gamedata') {
    const d = data as Data, players = { black: player(d.players!.black), white: player(d.players!.white) }
    const game = gameFrom(d), result = d.phase === 'finished' ? resultOf(d) : undefined
    if (result) game.info.result = result.re
    const pc = d.pause_control as PauseControl | undefined, free = freeStones(d)
    const n: Followed = {
      id: +d.game_id!, game, players, phase: d.phase ?? 'play', clock: d.clock, tc: d.time_control, rules: d.rules ?? 'japanese', result, offset: free,
      placing: Math.max(0, free - (d.moves?.length ?? 0)),
      me: myId === undefined ? 0 : myId === players.black.id ? 1 : myId === players.white.id ? -1 : 0,
      removed: typeof d.removed === 'string' ? stonesOf(d.removed) : [],
      pausedSince: pauseOf(pc, d.paused_since ?? d.clock?.paused_since),
      pause: pauseFrom(pc),
      pausesLeft: myId === undefined ? undefined : d[`pauses_left_${myId}`] ?? (pc?.paused?.pausing_player_id === myId ? pc.paused.pauses_left : undefined),
      competition: !!(d.tournament_id || d.ladder_id || (d.rengo && d.rengo_casual_mode)),
      corr: d.time_control?.speed === 'correspondence' || (d.time_per_move ?? 0) > 3600,
      free: !!d.free_handicap_placement, handicap: d.handicap ?? 0,
      settings: {
        rules: d.rules ?? 'japanese', ranked: !!d.ranked, width: d.width!, height: d.height!, handicap: d.handicap ?? 0, komi: d.komi ?? 0,
        time_control: d.time_control ?? ({ system: 'none', speed: 'correspondence', pause_on_weekends: false } as JGOFTimeControl),
        disable_analysis: !!d.disable_analysis, pause_on_weekends: !!d.pause_on_weekends, private: !!d.private,
      },
    }
    if (typeof d.undo_requested === 'number') n.undo = { by: d.undo_requested_by ?? notToMove(n), move: d.undo_requested }
    return n
  }
  if (!s) return s
  switch (event) {
    case 'move': {
      if (s.undo) s = { ...s, undo: undefined }
      const g = s.game, i = data.move_number - 1 - s.offset, v = fromOgs(data.move)
      if (i < g.moves.length) return i >= 0 && same(g.moves[i].vertex, v) ? s : { ...s, reload: true } // our own move echoed back
      if (i > g.moves.length) return { ...s, reload: true }
      g.goTo(g.moves.length) // play() would open a variation at a browsed position (live games stay linear)
      // a refusal includes play resuming after stone removal (two passes "end" a Game): the full gamedata replays it
      return g.play(v) === 'ok' ? { ...s } : { ...s, reload: true }
    }
    case 'clock': {
      const p = (data as protocol.GameClock).pause
      if (!p) return { ...s, clock: data }
      const pc = p.paused ? (p.pause_control as PauseControl) : undefined
      const mine = myId !== undefined && pc?.paused?.pausing_player_id === myId ? pc.paused.pauses_left : s.pausesLeft
      return { ...s, clock: data, pausedSince: pc ? pauseOf(pc, p.paused_since) : undefined, pause: pauseFrom(pc), pausesLeft: mine }
    }
    // a resignation or timeout may only change the phase: fetch the game for its outcome
    case 'phase': {
      const n = { ...s, phase: data, removed: data === 'play' ? [] : s.removed }
      return data === 'finished' && !s.result ? { ...n, reload: true } : n
    }
    case 'undo_requested': {
      const move = typeof data === 'number' ? data : parseInt(data?.move_number, 10)
      if (!Number.isFinite(move)) return s
      return { ...s, undo: { by: typeof data?.requested_by === 'number' ? data.requested_by : notToMove(s), move } }
    }
    case 'undo_canceled': return { ...s, undo: undefined }
    case 'undo_accepted': return { ...s, undo: undefined, reload: true }
    case 'removed_stones': return 'all_removed' in data ? { ...s, removed: stonesOf(data.all_removed) } : s
    case 'removed_stones_accepted': {
      if (data.phase !== 'finished') return s
      const result = resultOf({ ...data, players: s.players })
      s.game.info.result = result.re
      return { ...s, phase: 'finished', result, removed: stonesOf(data.stones) }
    }
    default: return s
  }
}

/** Removed stones as the board's dead-stone marks (empty points dropped). */
export function deadOf(m: Game['board']['signMap'], removed: Vertex[]): Dead {
  const dead = noDead(m)
  for (const [x, y] of removed) if (m[y]?.[x]) dead[y][x] = true
  return dead
}
/** A click during stone removal: the chain at v and whether it becomes removed; null on an empty point. */
export function removalToggle(m: Game['board']['signMap'], removed: Vertex[], v: Vertex): { stones: Vertex[]; removed: boolean } | null {
  const dead = deadOf(m, removed), next = toggleDead(m, dead, v)
  if (next === dead) return null
  const stones = m.flatMap((row, y) => row.flatMap((_, x) => (next[y][x] !== dead[y][x] ? [[x, y] as Vertex] : [])))
  return { stones, removed: next[v[1]][v[0]] }
}

/** Body for OGS's dead-stone scorer: the final position, [y][x], 1 black, 2 white. */
export function scoreRequest(s: Followed, jwt: string) {
  const g = s.game, size = g.info.size
  return {
    player_to_move: g.toPlay === 1 ? 'black' : 'white', width: size, height: size, rules: s.rules,
    board_state: g.boards[g.boards.length - 1].signMap.map(row => row.map(c => (c === -1 ? 2 : c))), // the last position, even while browsing
    komi: g.info.komi, autoscore: true, jwt,
  }
}
/** The scorer's dead stones, or null when its answer has none. */
export function removedFrom(res: any): { stones: Vertex[]; needsSealing: unknown } | null {
  const r = res?.autoscored_removed
  if (!Array.isArray(r) || !r.every(p => Number.isInteger(p?.x) && Number.isInteger(p?.y))) return null
  return { stones: r.map(p => [p.x, p.y] as Vertex), needsSealing: res.autoscored_needs_sealing }
}

// --- Session: one socket for the whole app, authenticated on every (re)connect.

export type Status = 'connecting' | 'online' | 'offline'
let status: Status = 'offline'
const watchers = new Set<() => void>()
const setStatus = (s: Status) => { status = s; watchers.forEach(w => w()) }
/** For useSyncExternalStore(onStatus, getStatus). */
export const getStatus = () => status
export const onStatus = (w: () => void) => { watchers.add(w); return () => { watchers.delete(w) } }

/** For useSyncExternalStore(subscribe, get); get() keeps its reference until the value changes. */
export interface Store<T> { subscribe(f: () => void): () => void; get(): T }
function store<T>(init: T) {
  let v = init
  const subs = new Set<() => void>()
  return {
    get: () => v,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f) } },
    set: (n: T) => { if (n !== v) { v = n; subs.forEach(f => f()) } },
  }
}

export interface ActiveRow { id: number; size: number; opponent: Player; color: Sign; myTurn: boolean; corr: boolean; expires?: number; phase: string; move: number }
export interface SearchRow { uuid: string; size: BoardSize; speed: Speed }
export interface ChallengeRow { id: number; gameId: number; from: Player; to: Player; mine: boolean; size: number; speed: Speed; ranked: boolean; handicap: number }
export interface WatchRow { id: number; size: number; black: Player; white: Player; move: number }
const activeStore = store<ActiveRow[] | null>(null), searchStore = store<SearchRow[]>([]), challengeStore = store<ChallengeRow[]>([])
/** My ongoing games; null until the server answers. */
export const active: Store<ActiveRow[] | null> = activeStore
/** My correspondence automatch searches. */
export const searches: Store<SearchRow[]> = searchStore
/** Challenges I sent or received. */
export const challenges: Store<ChallengeRow[]> = challengeStore
let activeMap = new Map<number, ActiveRow>()
let touched: Set<number> | null = null // games an active_game event changed while the REST seed is on its way

const noticeSubs = new Set<(n: Notice) => void>(), seen = new Set<string>()
export const onNotice = (cb: (n: Notice) => void) => { noticeSubs.add(cb); return () => { noticeSubs.delete(cb) } }
// OGS repeats active_game on every connect: a key is told once
const notify = (n: Notice | null) => { if (n && !seen.has(n.key)) { seen.add(n.key); noticeSubs.forEach(f => f(n)) } }

export let me: Player | null = null
let socket: GobanSocket | null = null
let guest = false // the session (open or on its way) may be, or is, anonymous
let jwt = '' // the session's current one, for the scorer
/** Local minus server time (ms), for clockOf. */
export const drift = () => socket?.clock_drift ?? 0
let session: Promise<Player | null> | null = null
const followed = new Set<number>()
const timers = new Set<ReturnType<typeof setTimeout>>() // keepalives and scorer waits: cleared by disconnect()
// game/<id>/<event> names are template-literal keys in goban-engine's types: subscribe through a plain signature
type Loose = { on(e: string, f: (d: any) => void): unknown; off(e: string, f: (d: any) => void): unknown }

function deviceId(): string {
  try {
    let id = localStorage.getItem('masame.ogs.device')
    if (!id) localStorage.setItem('masame.ogs.device', id = crypto.randomUUID())
    return id
  } catch { return crypto.randomUUID() } // private mode: a fresh id per launch
}

/** An OGS REST call: bearer when signed in (`anon`: optional), JSON body; non-2xx → ogs_http with the status. */
export async function rest(path: string, init: { method?: string; body?: unknown; anon?: boolean } = {}): Promise<Response> {
  const token = await call<string>('ogs_token').catch(e => { if (init.anon) return null; throw e })
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const body = init.body === undefined ? undefined : JSON.stringify(init.body)
  const r = await fetch(SITE + path, { method: init.method, headers, body }).catch(e => { throw fail('ogs_network', String(e)) })
  if (!r.ok) throw fail('ogs_http', String(r.status))
  return r
}
const json = async <T>(path: string, init?: Parameters<typeof rest>[1]) =>
  (await rest(path, init)).json().catch(() => { throw fail('ogs_http', 'unreadable body') }) as Promise<T>
const httpStatus = (e: unknown) => ((e as { code?: string }).code === 'ogs_http' ? (e as { detail?: string }).detail : undefined)

let generation = 0 // bumped by disconnect(): a connect() still awaiting gives up

/**
 * Logs in with the stored OGS token and opens the socket; later calls return the same session.
 * `guest`: signed out, opens an anonymous session (resolves null) instead of throwing ogs_login_required.
 */
export function connect(o: { guest?: boolean } = {}): Promise<Player | null> {
  if (session && (o.guest || !guest)) return session
  if (session) {
    // a guest session (maybe) open: signed in since, replace it; signed out, keep it
    const pending = session
    return Promise.all([call<string>('ogs_token'), pending.catch(() => null)]).then(() => {
      if (session === pending && guest) disconnect()
      return connect()
    })
  }
  const gen = generation
  guest = !!o.guest
  setStatus('connecting')
  return session = (async () => {
    const signedIn = await call<string>('ogs_token').then(() => true, e => { if (o.guest && e?.code === 'ogs_login_required') return false; throw e })
    const cfg = await json<{ user_jwt: string; user: { id: number; username: string; ranking: number } }>('/api/v1/ui/config', { anon: !signedIn })
    const version = await getVersion()
    if (gen !== generation) throw fail('ogs_offline')
    guest = !signedIn
    me = signedIn ? { id: cfg.user.id, username: cfg.user.username, rank: rankLabel(cfg.user.ranking) } : null
    jwt = cfg.user_jwt
    const auth = {
      jwt, device_id: deviceId(), user_agent: navigator.userAgent, language: navigator.language,
      client: 'masame', client_version: version,
    }
    const s = socket = new GobanSocket(SITE, { quiet: true })
    s.on('connect', () => {
      // sent here rather than through s.authenticate(), which would send it after this handler's game/connects
      s.send('authenticate', { ...auth, jwt })
      if (signedIn) {
        s.send('automatch/list', {})
        seedActive(gen)
        refreshChallenges()
      }
      for (const id of followed) s.send('game/connect', { game_id: id, chat: false })
      setStatus('online')
    })
    s.on('disconnect', () => setStatus(socket === s ? 'connecting' : 'offline')) // GobanSocket reconnects by itself
    s.on('unrecoverable_error', () => setStatus('offline'))
    s.on('user/jwt', j => { jwt = j })
    if (signedIn) listen(s)
    return me
  })().catch(e => {
    if (gen === generation) { session = null; guest = false; setStatus('offline') }
    throw e
  })
}
// non-guest only: it always has a player
const mine = async () => { const p = await connect(); if (!p) throw fail('ogs_login_required'); return p }

/** At app launch: connects silently when signed in. */
export function startBackground() { if (inTauri()) connect().catch(() => {}) }
export const isGuest = () => guest && !!socket

function listen(s: GobanSocket) {
  s.on('active_game', e => {
    const myId = me?.id
    if (myId === undefined) return
    touched?.add(e.id)
    if (e.phase === 'finished') activeMap.delete(e.id)
    else {
      const color: Sign = e.black.id === myId ? 1 : -1, o = color === 1 ? e.white : e.black, myTurn = e.player_to_move === myId
      activeMap.set(e.id, {
        id: e.id, size: e.width, opponent: player(o), color, myTurn, corr: e.time_per_move > 3600, phase: e.phase, move: e.move_number,
        expires: myTurn && e.clock_expiration ? ms(e.clock_expiration) : undefined,
      })
    }
    if (activeStore.get()) activeStore.set([...activeMap.values()])
    notify(turnNotice(e, myId))
  })
  s.on('automatch/entry', e => {
    const o = e.size_speed_options.find(x => x.speed === 'correspondence')
    if (o && !searchStore.get().some(x => x.uuid === e.uuid)) searchStore.set([...searchStore.get(), { uuid: e.uuid, size: parseInt(o.size) as BoardSize, speed: 'correspondence' }])
  })
  s.on('automatch/start', d => {
    if (searchStore.get().some(x => x.uuid === d.uuid)) notify({ kind: 'started', key: `started-${d.game_id}`, gameId: d.game_id })
    dropSearch(d.uuid)
  })
  s.on('automatch/cancel', d => dropSearch(d?.uuid ?? null))
  s.on('notification', n => {
    if (n.type === 'challenge' || n.type === 'delete') refreshChallenges()
    notify(notificationNotice(n, Date.now(), followed))
  })
}
const dropSearch = (uuid: string | null) => {
  const list = searchStore.get(), next = uuid ? list.filter(x => x.uuid !== uuid) : []
  if (next.length !== list.length) searchStore.set(next)
}

type RestPlayer = { id: number; username: string; ranking?: number }
const restPlayer = (p: RestPlayer): Player => ({ id: p.id, username: p.username, rank: rankLabel(p.ranking) })
const side = (black: RestPlayer, white: RestPlayer, myId: number) => {
  const color: Sign = black.id === myId ? 1 : -1
  return { color, opponent: restPlayer(color === 1 ? white : black) }
}

const ONGOING_ALL = '/api/v1/me/games/?ended__isnull=true&ordering=-id&page_size=100'
async function seedActive(gen: number) {
  const seenNow = touched = new Set<number>()
  try {
    type Row = { id: number; width: number; players: { black: RestPlayer; white: RestPlayer }; time_per_move?: number }
    const rows: Row[] = []
    for (let path: string | null = ONGOING_ALL, page = 0; path && page < 5; page++) {
      const r: { results: Row[]; next?: string | null } = await json(path)
      rows.push(...r.results)
      path = r.next?.startsWith(SITE + '/') ? r.next.slice(SITE.length) : null // the bearer goes to OGS only
    }
    if (gen !== generation || touched !== seenNow || !me) return
    const next = new Map<number, ActiveRow>()
    for (const g of rows) {
      next.set(g.id, {
        id: g.id, size: g.width, ...side(g.players.black, g.players.white, me.id), myTurn: false, corr: (g.time_per_move ?? 0) > 3600, phase: 'play', move: 0,
        ...activeMap.get(g.id), // the socket knows more: turn, phase, clock
      })
    }
    for (const id of seenNow) { const r = activeMap.get(id); if (r) next.set(id, r); else next.delete(id) }
    activeMap = next
    activeStore.set([...next.values()])
  } catch { /* the next connect tries again */ } finally { if (touched === seenNow) touched = null }
}

const speedOf = (tc: { speed?: string } | undefined, tpm: number): Speed =>
  (tc?.speed as Speed | undefined) ?? (!tpm || tpm >= 3600 ? 'correspondence' : tpm >= 20 ? 'live' : 'blitz')
async function refreshChallenges() {
  try {
    const myId = me?.id
    type Row = { id: number; challenger: RestPlayer; challenged: RestPlayer; game: { id: number; width: number; ranked: boolean; handicap: number; time_per_move: number; time_control_parameters?: string | object; time_control?: object } }
    const { results } = await json<{ results: Row[] }>('/api/v1/me/challenges/?page_size=50')
    if (me?.id !== myId) return
    challengeStore.set(results.map(c => {
      const p = c.game.time_control_parameters, tc = typeof p === 'string' ? JSON.parse(p) : p ?? c.game.time_control
      return {
        id: c.id, gameId: c.game.id, from: restPlayer(c.challenger), to: restPlayer(c.challenged), mine: c.challenger.id === myId,
        size: c.game.width, speed: speedOf(tc, c.game.time_per_move), ranked: !!c.game.ranked, handicap: c.game.handicap,
      }
    }))
  } catch { /* kept as it was: the next notification refreshes it */ }
}

function clearSession() {
  for (const t of timers) { clearTimeout(t); clearInterval(t) }
  timers.clear()
  activeMap = new Map(); touched = null
  activeStore.set(null); searchStore.set([]); challengeStore.set([])
}

export function disconnect() {
  const s = socket
  generation++
  socket = null; session = null; me = null; guest = false; jwt = ''
  followed.clear()
  clearSession()
  s?.disconnect()
  setStatus('offline')
}

export async function logout() {
  disconnect()
  await call('ogs_logout')
}

function live(): GobanSocket {
  if (!socket) throw fail('ogs_offline')
  return socket
}

const EVENTS = ['gamedata', 'move', 'clock', 'phase', 'removed_stones', 'removed_stones_accepted', 'undo_requested', 'undo_canceled', 'undo_accepted', 'auto_scoring_failed', 'error']
const SCORED: number[] = [9, 13, 19] // the scorer's sizes

/**
 * Follows a game: `onEvent` gets each event with the state it leads to (null until the first usable gamedata).
 * A gamedata Masame cannot show arrives as ['error', code]; a change of Followed.scoring as ['scoring', value]. Returns leave().
 */
export function follow(id: number, onEvent: (ev: GameEvent, state: Followed | null) => void): () => void {
  const s = live(), ee = s as unknown as Loose
  let state: Followed | null = null, asked = false // a reload is requested once, until the gamedata answers it
  // dead stones: OGS proposes them; without a proposal after a while (or on its failure), ask its scorer as goban does
  let scoring: Followed['scoring'], wait: ReturnType<typeof setTimeout> | undefined, tried = false, left = false
  const join = () => s.send('game/connect', { game_id: id, chat: false })
  const stopWait = () => { if (wait) { clearTimeout(wait); timers.delete(wait); wait = undefined } }
  const sync = () => { if (state && state.scoring !== scoring) state = { ...state, scoring } }
  const tell = () => { if (!left) { sync(); onEvent(['scoring', scoring], state) } }
  const score = async () => {
    stopWait()
    const at = state
    let res: unknown = null
    if (at) {
      const abort = new AbortController(), t = setTimeout(() => abort.abort(), 30_000)
      try {
        const r = await fetch(SCORER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scoreRequest(at, jwt)), signal: abort.signal })
        res = r.ok ? await r.json() : null
      } catch { /* failed below */ } finally { clearTimeout(t) }
    }
    if (left || scoring !== 'waiting' || state?.phase !== 'stone removal') return // a proposal came, or the phase moved on
    const removed = removedFrom(res)
    if (removed && socket === s) {
      s.send('game/removed_stones/set', { game_id: id, removed: true, stones: stonesString(removed.stones), needs_sealing: removed.needsSealing, auto_scored: true } as never)
      scoring = undefined
    } else scoring = 'failed'
    tell()
  }
  const removal = (name: string, data: any) => {
    if (!state || state.me === 0) return
    if (state.phase !== 'stone removal') { stopWait(); scoring = undefined; tried = false; return }
    if (name === 'phase') { stopWait(); tried = false } // a fresh stone removal
    const proposal = (name === 'removed_stones' && (data?.auto_scored || !!data?.all_removed)) || (name === 'gamedata' && data.auto_scoring_done)
    if (proposal) { stopWait(); scoring = undefined; tried = true }
    else if (name === 'auto_scoring_failed' && scoring === 'waiting' && wait) void score()
    else if (!tried && (name === 'phase' || name === 'gamedata')) {
      tried = true
      if (!SCORED.includes(state.game.info.size)) scoring = 'failed'
      else { scoring = 'waiting'; wait = setTimeout(score, 15_000); timers.add(wait) }
    }
  }
  const handlers = EVENTS.map(name => [`game/${id}/${name}`, (data: unknown) => {
    let ev: GameEvent = [name, data]
    try { state = apply(state, ev, me?.id) } catch (e) { state = null; ev = ['error', (e as { code?: string }).code ?? String(e)] }
    if (name === 'error') ev = ['error', fail('ogs_refused', typeof data === 'string' ? data : undefined)] // the server's English text as detail
    removal(name, data)
    sync()
    // without a state, a move means handicap placement went on: fetch the game again until it is complete
    if (name === 'gamedata') asked = false
    // an error (a refused move, kept on the board by the optimistic play) also takes the server's version
    else if (!asked && (state?.reload || (!state && name === 'move') || name === 'error')) { asked = true; join() }
    onEvent(ev, state)
  }] as const)
  for (const [e, h] of handlers) ee.on(e, h)
  followed.add(id)
  if (s.connected) join() // otherwise the connect handler sends it
  return () => {
    left = true
    stopWait()
    for (const [e, h] of handlers) ee.off(e, h)
    followed.delete(id)
    if (socket === s) s.send('game/disconnect', { game_id: id })
  }
}

export const move = (id: number, v: Vertex | null) => live().send('game/move', { game_id: id, move: toOgs(v) })
export const resign = (id: number) => live().send('game/resign', { game_id: id })
export const cancelGame = (id: number) => live().send('game/cancel', { game_id: id })
/** Undo: request with moveNumber(s), accept or cancel with s.undo.move. */
export const requestUndo = (id: number, move: number) => live().send('game/undo/request', { game_id: id, move_number: move })
export const acceptUndo = (id: number, move: number) => live().send('game/undo/accept', { game_id: id, move_number: move })
export const cancelUndo = (id: number, move: number) => live().send('game/undo/cancel', { game_id: id, move_number: move })
export const pauseGame = (id: number) => live().send('game/pause', { game_id: id })
export const resumeGame = (id: number) => live().send('game/resume', { game_id: id })
export const setRemoved = (id: number, stones: Vertex[], removed: boolean) =>
  live().send('game/removed_stones/set', { game_id: id, removed, stones: stonesString(stones) })
export const acceptRemoved = (id: number, stones: Vertex[]) =>
  live().send('game/removed_stones/accept', { game_id: id, stones: stonesString(stones), strict_seki_mode: false })

/** Automatch: `started` resolves with the new game's id; nothing resolves after cancel(). */
export function findMatch(size: BoardSize, speed: Speed): { cancel(): void; started: Promise<number> } {
  const s = live(), uuid = crypto.randomUUID()
  let stop = () => {}
  // asked again on every reconnect: the server may have dropped the entry with the connection
  const ask = () => s.send('automatch/find_match', findMatchRequest(size, speed, uuid))
  const started = new Promise<number>(resolve => {
    const on = (d: { uuid: string; game_id: number }) => { if (d.uuid === uuid) { stop(); resolve(d.game_id) } }
    s.on('automatch/start', on)
    s.on('connect', ask)
    stop = () => { s.off('automatch/start', on); s.off('connect', ask) }
  })
  if (s.connected) ask() // otherwise the connect handler asks
  if (speed === 'correspondence') searchStore.set([...searchStore.get(), { uuid, size, speed }])
  return { cancel: () => { stop(); s.send('automatch/cancel', { uuid }); dropSearch(uuid) }, started }
}
export const cancelSearch = (uuid: string) => { live().send('automatch/cancel', { uuid }); dropSearch(uuid) }

// --- Challenges.

export async function findPlayer(username: string): Promise<Player> {
  const { results } = await json<{ results: RestPlayer[] }>(`/api/v1/players/?username=${encodeURIComponent(username)}`, { anon: true })
  if (!results?.length) throw fail('ogs_no_player', username)
  return restPlayer(results[0])
}
export async function challenge(playerId: number, body: unknown): Promise<{ challengeId: number; gameId: number }> {
  const res = await json<{ challenge: number; game: number | { id: number } }>(`/api/v1/players/${playerId}/challenge`, { method: 'POST', body })
  void refreshChallenges()
  return { challengeId: res.challenge, gameId: typeof res.game === 'number' ? res.game : res.game.id }
}
/** Live challenges: OGS drops them without a keepalive every second. Returns stop(). */
export function keepAlive(challengeId: number, gameId: number): () => void {
  const send = () => { if (socket) socket.send('challenge/keepalive', { challenge_id: challengeId, game_id: gameId }) }
  send()
  const t = setInterval(send, 1000)
  timers.add(t)
  return () => { clearInterval(t); timers.delete(t) }
}
const dropChallenge = async (id: number) => { await rest(`/api/v1/me/challenges/${id}`, { method: 'DELETE' }); void refreshChallenges() }
export const cancelChallenge = dropChallenge
export const declineChallenge = dropChallenge
/** Resolves the game id. */
export async function acceptChallenge(id: number): Promise<number> {
  const known = challengeStore.get().find(c => c.id === id)?.gameId
  const res = await json<{ game?: number | { id: number } } | null>(`/api/v1/me/challenges/${id}/accept`, { method: 'POST', body: {} }).catch(e => {
    if (e.code === 'ogs_http' && e.detail === 'unreadable body') return null // accepted, no JSON
    throw e
  })
  void refreshChallenges()
  const g = res?.game, gameId = typeof g === 'number' ? g : g?.id ?? known
  if (gameId === undefined) throw fail('ogs_no_game')
  return gameId
}

// --- Data.

/** Live games to watch, strongest first; guests too. */
export function liveGames(): Promise<WatchRow[]> {
  const s = live()
  return new Promise((resolve, reject) => s.send('gamelist/query', { list: 'live', sort_by: 'rank', where: { hide_bot_games: true }, from: 0, limit: 20 }, (d, err) => {
    if (err || !d) return reject(fail('ogs_refused', err ? String(err.message ?? err) : undefined))
    resolve(d.results.map(e => ({ id: e.id, size: e.width, black: player(e.black), white: player(e.white), move: e.move_number })))
  }))
}

/** A game by id: finished or not, mine or not. */
export async function gameInfo(id: number): Promise<{ id: number; ended: boolean; mine: boolean }> {
  type Row = { id: number; ended: string | null; black?: number; white?: number; players?: Players }
  const g = await json<Row>(`/api/v1/games/${id}`, { anon: true }).catch(e => {
    throw ['403', '404'].includes(httpStatus(e) ?? '') ? fail('ogs_no_game', String(id)) : e
  })
  const ids = [g.players?.black.id ?? g.black, g.players?.white.id ?? g.white]
  return { id: g.id, ended: !!g.ended, mine: !!me && ids.includes(me.id) }
}

// --- REST, kept to a few calls (OGS caps requests per app).

export interface GameRow {
  id: number
  size: number
  opponent: Player
  color: Sign // mine
  result?: string // finished games, SGF RE
  date: number // ms: start of an ongoing game, end of a finished one
}
type GameRestRow = { id: number; width: number; players: { black: RestPlayer; white: RestPlayer }; outcome: string; black_lost: boolean; white_lost: boolean; started: string; ended: string | null }
const gameRow = (g: GameRestRow, myId: number): GameRow => ({
  id: g.id, size: g.width, ...side(g.players.black, g.players.white, myId), date: Date.parse(g.ended ?? g.started),
  result: g.ended ? resultOf({ outcome: g.outcome, winner: lostWinner(g) }).re : undefined,
})

/** My finished games, newest first, 20 a page (from 1). */
export async function history(page: number): Promise<{ rows: GameRow[]; more: boolean }> {
  const { id } = await mine()
  const r = await json<{ results: GameRestRow[]; next?: string | null }>(`/api/v1/players/${id}/game_history/?page_size=20&page=${page}&ordering=-ended`, { anon: true })
  return { rows: r.results.map(g => gameRow(g, id)), more: !!r.next }
}

/** My rating over time, as ranking floats for rankLabel; lo and hi: the rating ± its deviation. */
export async function ratingHistory(): Promise<{ t: number; rank: number; lo: number; hi: number }[]> {
  const { id } = await mine()
  return ratingPoints(await call<string>('ogs_rating_history', { playerId: id }))
    .map(p => ({ t: p.t, rank: rankOf(p.rating), lo: rankOf(p.rating - p.deviation), hi: rankOf(p.rating + p.deviation) }))
}

export const sgf = async (id: number) => (await rest(`/api/v1/games/${id}/sgf`, { anon: true })).text()
