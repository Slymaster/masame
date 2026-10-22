// Bridge to the Rust side (network manager + KataGo analysis engine).
// Outside Tauri (plain Vite dev server) every call rejects and listeners are no-ops, so the UI degrades quietly.

import type { Game, Sign, Vertex } from './game'
import { LocalizedError } from './i18n'

/** Checked per call (not at import) so a browser preview can install a stand-in before opening a view. */
export const inTauri = () => '__TAURI_INTERNALS__' in window

export interface NetEntry {
  key: string; section: 'recommended' | 'current'; name: string; url: string
  bytes: number; sha256: string; createdAt: string; elo: number | null; games: number | null; evaluating: boolean
}
export interface NetState {
  installed: { name: string; bytes: number; complete: boolean }[]
  active: string | null
  activeKey: string | null // preset key of the active net, if it is one
  downloading: string[]
  human: string
}
/** Rust-side error: a stable code (texts live in strings.ts) + optional technical detail. */
export interface Failure { code: string; detail?: string }
export interface Progress { name: string; state: 'downloading' | 'verifying' | 'done' | 'error' | 'cancelled'; received: number; total: number; error: Failure | null }
export type EngineStatus = { state: 'stopped' | 'starting' | 'warming' | 'ready' } | { state: 'tuning'; step: number; done: number; total: number }
  | { state: 'error'; error: Failure }

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri()) throw new LocalizedError(d => d.engineInAppOnly)
  return (await import('@tauri-apps/api/core')).invoke<T>(cmd, args)
}

export async function on<T>(event: string, cb: (payload: T) => void): Promise<() => void> {
  if (!inTauri()) return () => {}
  return (await import('@tauri-apps/api/event')).listen<T>(event, e => cb(e.payload))
}

const COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'
export const gtp = ([x, y]: Vertex, n: number) => `${COLS[x]}${n - y}`
/** A GTP move from the engine: null for a pass, undefined when unreadable or off an n×n board. */
function vertex(s: unknown, n: number): Vertex | null | undefined {
  if (typeof s !== 'string') return undefined
  if (s.toLowerCase() === 'pass') return null
  const x = COLS.indexOf(s[0]), row = s.slice(1)
  if (x < 0 || x >= n || !/^\d+$/.test(row) || +row < 1 || +row > n) return undefined
  return [x, n - +row]
}

export interface Analysis {
  winrate: number // Black's (the engine is started with reportAnalysisWinratesAs=BLACK)
  scoreLead: number // Black's
  topMove: string
  pv: (Vertex | null)[] // [0] is the best move itself
  ownership: number[] | null // row-major from the top-left, +1 = Black
  humanPolicy: number[] | null // row-major + pass, -1 = illegal
  moves: { v: Vertex | null; scoreLead: number; visits: number; prior?: number }[] // the candidates, in KataGo's order (prior: policy; parseAnalysis always sets it, 0 when absent)
}

const nums = (v: unknown, len: number): number[] | null =>
  Array.isArray(v) && v.length === len && v.every(x => typeof x === 'number' && Number.isFinite(x)) ? v : null

/** Engine output is untrusted: keep only well-formed fields of the expected sizes. */
export function parseAnalysis(raw: unknown, n: number): Analysis {
  const r = raw as { rootInfo?: { winrate?: unknown; scoreLead?: unknown }; moveInfos?: { move?: unknown; order?: unknown; pv?: unknown; scoreLead?: unknown; visits?: unknown; prior?: unknown }[]; ownership?: unknown; humanPolicy?: unknown }
  const { winrate, scoreLead } = r?.rootInfo ?? {}
  if (typeof winrate !== 'number' || typeof scoreLead !== 'number') throw new LocalizedError(d => d.badAnswer)
  const top = Array.isArray(r.moveInfos) ? r.moveInfos.find(m => m?.order === 0) : undefined
  const pv: (Vertex | null)[] = []
  for (const s of Array.isArray(top?.pv) ? top.pv : []) {
    const v = vertex(s, n)
    if (v === undefined) break
    pv.push(v)
  }
  return {
    winrate, scoreLead, topMove: typeof top?.move === 'string' ? top.move.toLowerCase() === 'pass' ? 'pass' : top.move : '', pv,
    ownership: nums(r.ownership, n * n), humanPolicy: nums(r.humanPolicy, n * n + 1),
    moves: (Array.isArray(r.moveInfos) ? r.moveInfos : []).flatMap(m => {
      const v = vertex(m?.move, n), { order, scoreLead, visits, prior } = m ?? {}
      return v !== undefined && typeof order === 'number' && Number.isFinite(scoreLead) && Number.isFinite(visits) && (visits as number) > 0
        ? [{ order, v, scoreLead: scoreLead as number, visits: visits as number, prior: Number.isFinite(prior) ? Math.min(1, Math.max(0, prior as number)) : 0 }] : []
    }).sort((a, b) => a.order - b.order).map(({ v, scoreLead, visits, prior }) => ({ v, scoreLead, visits, prior })),
  }
}

export interface Candidate { v: Vertex | null; label: string; loss: number }
/** The engine's candidates for `toPlay` (the side to move in `a`), lettered in its order: points lost against the best, rare reads (noise) left out. */
export function candidates(a: Analysis, toPlay: Sign, max = 8): Candidate[] {
  const best = a.moves[0]
  if (!best) return []
  const top = Math.max(...a.moves.map(m => m.visits))
  let k = 0 // a pass takes no letter: it is never marked
  return a.moves.filter(m => m === best || m.visits * 10 >= top).slice(0, max)
    .map(m => ({ v: m.v, label: m.v ? LETTERS[k++] : '', loss: Math.max(0, toPlay * (best.scoreLead - m.scoreLead)) }))
}
const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'

/** The displayed position: the last position at or before the cursor (the root otherwise) with setup stones or a new side
 * to play (PL) as the initial stones and player, then the moves. */
export function positionQuery(game: Game) {
  const { size, komi, firstSign } = game.info
  const color = (s: number) => (s === 1 ? 'B' : 'W')
  // a pseudo-move's sign is the side that does not play next: it changes the side when it differs from the move before
  const cut = (i: number) => { const m = game.moves[i - 1]; return !!game.nodes[i].stones || !!m.setup && (i > 1 ? m.sign !== game.moves[i - 2].sign : -m.sign !== firstSign) }
  let at = game.cursor
  while (at > 0 && !cut(at)) at--
  return {
    rules: 'japanese', komi, boardXSize: size, boardYSize: size,
    initialStones: game.boards[at].signMap.flatMap((row, y) => row.flatMap((c, x) => (c ? [[color(c), gtp([x, y], size)]] : []))),
    initialPlayer: color(at ? -game.moves[at - 1].sign : firstSign),
    moves: game.moves.slice(at, game.cursor).filter(m => !m.setup).map(m => [color(m.sign), m.vertex ? gtp(m.vertex, size) : 'pass']),
  }
}

export async function analyze(game: Game, extra: Record<string, unknown>): Promise<Analysis> {
  const n = game.info.size
  return parseAnalysis(await call('engine_analyze', { query: { ...positionQuery(game), ...extra } }), n)
}
