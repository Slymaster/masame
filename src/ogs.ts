// OGS (online-go.com) client: protocol helpers (pure, tested) and one shared socket session.
// OGS forbids engine help in ongoing games: nothing here talks to KataGo.

import { char2num, encodeMove, GobanEngine, GobanSocket, type AdHocPackedMove, type GobanEngineConfig, type GobanEnginePhase, type GobanEngineRules, type JGOFTimeControl, type protocol } from 'goban-engine'
import { Game, type Sign, type Vertex } from './game'
import { getVersion } from '@tauri-apps/api/app'
import { call } from './katago'
import { noDead, toggleDead, type Dead } from './scoring'
import { scoreResult } from './sgf'

const SITE = 'https://online-go.com'
// The app-wide error shape: failureText reads `code` (texts live in the i18n failures table).
const fail = (code: string, detail?: string) => Object.assign(new Error(code), { code, detail })

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

export const hms = (ms: number) => {
  const s = Math.ceil(Math.max(0, ms) / 1000), h = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** Free-placement handicap stones: OGS sends them as the first black moves; Masame keeps them as setup. */
const freeStones = (d: GobanEngineConfig) => (d.free_handicap_placement && (d.handicap ?? 0) > 1 ? d.handicap! : 0)

export function gameFrom(data: GobanEngineConfig): Game {
  const d = GobanEngine.fillDefaults(structuredClone(data)) // places fixed handicap stones when initial_state is missing
  const size = d.width!
  if (d.height !== size) throw fail('ogs_not_square', `${d.width}×${d.height}`)
  const moves = (d.moves ?? []) as AdHocPackedMove[], free = freeStones(d)
  if (moves.length < free) throw fail('ogs_placing_handicap')
  const black = [...stonesOf(d.initial_state?.black ?? ''), ...moves.slice(0, free).map(m => fromOgs(m)!)]
  const firstSign: Sign = free || d.initial_player === 'white' ? -1 : 1
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

// Paused as goban decides it (src/Goban/OGSConnectivity.ts, setGameClock): the gamedata's pause_control, replaced by
// clock.pause whenever a clock carries one; paused while that control has any key.
const pauseOf = (control: object | undefined, since: number | undefined) =>
  control && Object.keys(control).length && since ? (since < 2e9 ? since * 1000 : since) : undefined // old records: seconds

export type BoardSize = 9 | 13 | 19
export type Speed = 'blitz' | 'rapid' | 'live'
/** The official client's defaults: ±3 ranks, any rules, handicap allowed, either clock. */
export const findMatchRequest = (size: BoardSize, speed: Speed, uuid: string): protocol.AutomatchPreferences => ({
  uuid,
  size_speed_options: (['byoyomi', 'fischer'] as const).map(system => ({ size: `${size}x${size}` as protocol.Size, speed, system })),
  lower_rank_diff: 3, upper_rank_diff: 3,
  rules: { condition: 'no-preference', value: 'japanese' },
  handicap: { condition: 'no-preference', value: 'enabled' },
})

export interface Player { id: number; username: string; rank: string }
export type Phase = GobanEnginePhase
export interface Followed {
  id: number
  game: Game
  me: Sign | 0
  phase: Phase
  clock?: protocol.GameClock
  tc?: JGOFTimeControl
  rules: GobanEngineRules
  players: { black: Player; white: Player }
  removed: Vertex[]
  result?: Result
  offset: number // OGS move numbers count free handicap stones, which game holds as setup
  pausedSince?: number // server ms while the game is paused: pass to clockOf
  reload?: boolean // out of sync: ask the server for the whole game again
}
/** [event, data]: the part of `game/<id>/<event>` after the id. */
export type GameEvent = [string, any]

const player = (p: { id: number; username: string; rank?: number }): Player => ({ id: p.id, username: p.username, rank: rankLabel(p.rank) })
const same = (a: Vertex | null, b: Vertex | null) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])

/** The next state of a followed game; nothing until the first gamedata. Throws (gameFrom) on a game Masame cannot show. */
export function apply(s: Followed | null, [event, data]: GameEvent, myId?: number): Followed | null {
  if (event === 'gamedata') {
    const d = data as GobanEngineConfig, players = { black: player(d.players!.black), white: player(d.players!.white) }
    const game = gameFrom(d), result = d.phase === 'finished' ? resultOf(d) : undefined
    if (result) game.info.result = result.re
    return {
      id: +d.game_id!, game, players, phase: d.phase ?? 'play', clock: d.clock, tc: d.time_control, rules: d.rules ?? 'japanese', result, offset: freeStones(d),
      me: myId === undefined ? 0 : myId === players.black.id ? 1 : myId === players.white.id ? -1 : 0,
      removed: typeof d.removed === 'string' ? stonesOf(d.removed) : [],
      pausedSince: pauseOf(d.pause_control, d.paused_since ?? d.clock?.paused_since),
    }
  }
  if (!s) return s
  switch (event) {
    case 'move': {
      const g = s.game, i = data.move_number - 1 - s.offset, v = fromOgs(data.move)
      if (i < g.moves.length) return i >= 0 && same(g.moves[i].vertex, v) ? s : { ...s, reload: true } // our own move echoed back
      if (i > g.moves.length) return { ...s, reload: true }
      g.goTo(g.moves.length) // play() would cut the record at a browsed position
      // a refusal includes play resuming after stone removal (two passes "end" a Game): the full gamedata replays it
      return g.play(v) === 'ok' ? { ...s } : { ...s, reload: true }
    }
    case 'clock': {
      const p = (data as protocol.GameClock).pause
      return { ...s, clock: data, pausedSince: p ? (p.paused ? pauseOf(p.pause_control, p.paused_since) : undefined) : s.pausedSince }
    }
    // a resignation or timeout may only change the phase: fetch the game for its outcome
    case 'phase': {
      const n = { ...s, phase: data, removed: data === 'play' ? [] : s.removed }
      return data === 'finished' && !s.result ? { ...n, reload: true } : n
    }
    case 'undo_accepted': return { ...s, reload: true }
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

// --- Session: one socket for the whole app, authenticated on every (re)connect.

export type Status = 'connecting' | 'online' | 'offline'
let status: Status = 'offline'
const watchers = new Set<() => void>()
const setStatus = (s: Status) => { status = s; watchers.forEach(w => w()) }
/** For useSyncExternalStore(onStatus, getStatus). */
export const getStatus = () => status
export const onStatus = (w: () => void) => { watchers.add(w); return () => { watchers.delete(w) } }

export let me: Player | null = null
let socket: GobanSocket | null = null
/** Local minus server time (ms), for clockOf. */
export const drift = () => socket?.clock_drift ?? 0
let session: Promise<Player> | null = null
const followed = new Set<number>()
// game/<id>/<event> names are template-literal keys in goban-engine's types: subscribe through a plain signature
type Loose = { on(e: string, f: (d: any) => void): unknown; off(e: string, f: (d: any) => void): unknown }

function deviceId(): string {
  try {
    let id = localStorage.getItem('masame.ogs.device')
    if (!id) localStorage.setItem('masame.ogs.device', id = crypto.randomUUID())
    return id
  } catch { return crypto.randomUUID() } // private mode: a fresh id per launch
}

async function rest(path: string): Promise<Response> {
  const headers = { Authorization: `Bearer ${await call<string>('ogs_token')}` }
  const r = await fetch(SITE + path, { headers }).catch(e => { throw fail('ogs_network', String(e)) })
  if (!r.ok) throw fail('ogs_http', String(r.status))
  return r
}
const json = async <T>(path: string) => (await rest(path)).json().catch(() => { throw fail('ogs_http', 'unreadable body') }) as Promise<T>

let generation = 0 // bumped by disconnect(): a connect() still awaiting gives up

/** Logs in with the stored OGS token and opens the socket; later calls return the same session. */
export function connect(): Promise<Player> {
  if (session) return session
  const gen = generation
  setStatus('connecting')
  return session = (async () => {
    const cfg = await json<{ user_jwt: string; user: { id: number; username: string; ranking: number } }>('/api/v1/ui/config')
    const version = await getVersion()
    if (gen !== generation) throw fail('ogs_offline')
    me = { id: cfg.user.id, username: cfg.user.username, rank: rankLabel(cfg.user.ranking) }
    const auth = {
      jwt: cfg.user_jwt, device_id: deviceId(), user_agent: navigator.userAgent, language: navigator.language,
      client: 'masame', client_version: version,
    }
    const s = socket = new GobanSocket(SITE, { quiet: true })
    s.on('connect', () => {
      // sent here rather than through s.authenticate(), which would send it after this handler's game/connects
      s.send('authenticate', auth)
      for (const id of followed) s.send('game/connect', { game_id: id, chat: false })
      setStatus('online')
    })
    s.on('disconnect', () => setStatus(socket === s ? 'connecting' : 'offline')) // GobanSocket reconnects by itself
    s.on('unrecoverable_error', () => setStatus('offline'))
    s.on('user/jwt', jwt => { auth.jwt = jwt })
    return me
  })().catch(e => {
    if (gen === generation) { session = null; setStatus('offline') }
    throw e
  })
}

export function disconnect() {
  const s = socket
  generation++
  socket = null; session = null; me = null
  followed.clear()
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

const EVENTS = ['gamedata', 'move', 'clock', 'phase', 'removed_stones', 'removed_stones_accepted', 'undo_accepted', 'error']

/**
 * Follows a game: `onEvent` gets each event with the state it leads to (null until the first usable gamedata).
 * A gamedata Masame cannot show arrives as ['error', code]. Returns leave().
 */
export function follow(id: number, onEvent: (ev: GameEvent, state: Followed | null) => void): () => void {
  const s = live(), ee = s as unknown as Loose
  let state: Followed | null = null, asked = false // a reload is requested once, until the gamedata answers it
  const join = () => s.send('game/connect', { game_id: id, chat: false })
  const handlers = EVENTS.map(name => [`game/${id}/${name}`, (data: unknown) => {
    let ev: GameEvent = [name, data]
    try { state = apply(state, ev, me?.id) } catch (e) { state = null; ev = ['error', (e as { code?: string }).code ?? String(e)] }
    // without a state, a move means handicap placement went on: fetch the game again until it is complete
    if (name === 'gamedata') asked = false
    else if (!asked && (state?.reload || (!state && name === 'move'))) { asked = true; join() }
    onEvent(ev, state)
  }] as const)
  for (const [e, h] of handlers) ee.on(e, h)
  followed.add(id)
  if (s.connected) join() // otherwise the connect handler sends it
  return () => {
    for (const [e, h] of handlers) ee.off(e, h)
    followed.delete(id)
    if (socket === s) s.send('game/disconnect', { game_id: id })
  }
}

export const move = (id: number, v: Vertex | null) => live().send('game/move', { game_id: id, move: toOgs(v) })
export const pass = (id: number) => move(id, null)
export const resign = (id: number) => live().send('game/resign', { game_id: id })
export const setRemoved = (id: number, stones: Vertex[], removed: boolean) =>
  live().send('game/removed_stones/set', { game_id: id, removed, stones: stonesString(stones) })
export const acceptRemoved = (id: number, stones: Vertex[]) =>
  live().send('game/removed_stones/accept', { game_id: id, stones: stonesString(stones), strict_seki_mode: false })

/** Automatch: `started` resolves with the new game's id; nothing resolves after cancel(). */
export function findMatch(size: BoardSize, speed: Speed): { cancel(): void; started: Promise<number> } {
  const s = live(), uuid = crypto.randomUUID()
  let stop = () => {}
  const started = new Promise<number>(resolve => {
    const on = (d: { uuid: string; game_id: number }) => { if (d.uuid === uuid) { stop(); resolve(d.game_id) } }
    s.on('automatch/start', on)
    stop = () => { s.off('automatch/start', on) }
  })
  s.send('automatch/find_match', findMatchRequest(size, speed, uuid))
  return { cancel: () => { stop(); s.send('automatch/cancel', { uuid }) }, started }
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
type RestPlayer = { id: number; username: string; ranking?: number }
const side = (black: RestPlayer, white: RestPlayer, myId: number) => {
  const color: Sign = black.id === myId ? 1 : -1
  const o = color === 1 ? white : black
  return { color, opponent: { id: o.id, username: o.username, rank: rankLabel(o.ranking) } }
}

// One endpoint for both lists (its filter is verified live); the ongoing rows carry no clock, so no "whose turn".
const ONGOING = '/api/v1/me/games/?ended__isnull=true&ordering=-id&page_size=10'
const FINISHED = '/api/v1/me/games/?ended__isnull=false&ordering=-ended&page_size=10'
async function games(ended: boolean): Promise<GameRow[]> {
  const { id: myId } = await connect()
  type Row = { id: number; width: number; players: { black: RestPlayer; white: RestPlayer }; outcome: string; black_lost: boolean; white_lost: boolean; started: string; ended: string | null }
  const { results } = await json<{ results: Row[] }>(ended ? FINISHED : ONGOING)
  return results.map(g => ({
    id: g.id, size: g.width, ...side(g.players.black, g.players.white, myId), date: Date.parse(g.ended ?? g.started),
    result: g.ended ? resultOf({ outcome: g.outcome, winner: g.white_lost && !g.black_lost ? 'black' : g.black_lost && !g.white_lost ? 'white' : undefined }).re : undefined,
  }))
}
export const activeGames = () => games(false)
export const finishedGames = () => games(true)

export const sgf = async (id: number) => (await rest(`/api/v1/games/${id}/sgf`)).text()
