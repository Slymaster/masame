// The library: every game played or opened lives on this machine, as an SGF file per game plus one index, in the app
// data dir's games/ folder (Rust: src-tauri/src/library.rs). Outside the app every call rejects, and Mes parties says so.
// One store for the whole UI (Mes parties, Apprendre, Progrès), loaded once; every write goes through one queue, in order.
import type { Facts, Pos } from './classify'
import type { Game, Sign } from './game'
import { hash64 } from './joseki/sym'
import { call } from './katago'
import type { Reading } from './rank'
import type { Moment } from './review'
import { saveSgf } from './sgf'

export type Source = 'ai' | 'two' | 'ogs' | 'file' | 'position'
export interface Side { name: string; rank: string }
export interface Entry {
  id: string // [A-Za-z0-9_-]{1,64}: the file name too (see newId)
  date: number // when the game began (ms since the epoch)
  source: Source
  size: number; komi: number; handicap: number
  black: Side; white: Side
  me: 1 | -1 | 0 // the player's colour; 0: a two-player game, or a file without the player's name
  result?: string // SGF RE ("B+R", "W+4.5", "0"); absent while unfinished
  ogsId?: number
  era?: number // against a Master of an era (B1)
  mentor?: { stops: number } // played with the mentor on (B2): a lesson, never a rank reading
  rankRead?: Reading // the player's rank read in their moves
  classic?: true // kept from Les Classiques: judged at pro level for both sides
  review?: { moments: number } // reviewed (automatically or by hand): its leads and moments are in the 'review' sidecar
  memory?: { recalled: number; total: number; helps: number } // replayed from memory (C2), the best run
  counted?: number // positions of this game counted so far (C1)
  added?: number // a file: when it entered the library (the monthly letter counts it then, not at its SGF date)
}
/** The 'review' sidecar (<id>.review.json): the scan's leads per move (Black's lead, null where unread) and the moments;
 * v2 adds what the move classifier needs: a Pos per position and Facts per move (ownership maps are never stored), the
 * line read (recordKey: a variation or an undone line is another record) and the side the moments were picked for. */
export interface ReviewSidecar { leads: (number | null)[]; moments: Moment[]; v?: 2; pos?: Pos[]; facts?: Facts[]; key?: string; side?: Sign | 0 }
export interface ReviewData { key: string; side: Sign | 0; pos: Pos[]; facts: Facts[]; moments: Moment[] }
/** current.json: the unfinished local game to restore at launch (A1). */
export interface Current {
  id: string; cursor: number
  line?: number[] // the shown line, as child indices from the root (absent: the main line)
  bot: { sign: 1 | -1; rank: string; ritual?: true; era?: number; mentor?: boolean } | null
  clock: unknown // the local clock's state (src/localClock.ts), or null
  handicap: number
}

export const PAGE = 50 // Mes parties shows the list 50 rows at a time ("See more")

// ---------- the Rust commands ----------
const listAll = () => call<Entry[]>('library_list') // newest first; a corrupt entry is skipped by Rust
export const read = (id: string) => call<string>('library_read', { id })
export const sidecar = <T>(id: string, name: string) => call<T | null>('library_sidecar_read', { id, name })
export const current = () => call<Current | null>('library_current_read')

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
/** A reviewed game's classification data, so it reopens without a scan; null for a v1 sidecar (leads only), none, or a
 * damaged one (anything off the board of `size`, or moments outside the positions read). */
export async function reviewData(id: string, size: number): Promise<ReviewData | null> {
  const r = await sidecar<ReviewSidecar>(id, 'review')
  const vert = (v: unknown) => v === null || Array.isArray(v) && v.length === 2 && v.every(c => Number.isInteger(c) && c >= 0 && c < size)
  const line = (l: unknown) => Array.isArray(l) && l.every(vert), map = (m: unknown) => m === null || Array.isArray(m) && m.every(num)
  const isPos = (p: Pos) => !!p && num(p.lead) && num(p.u) && line(p.pv) && Array.isArray(p.cands)
    && p.cands.every(c => !!c && vert(c.v) && num(c.lead) && num(c.visits) && num(c.prior))
  const isFacts = (f: Facts) => !!f && num(f.sac) && typeof f.book === 'boolean'
  const n = Array.isArray(r?.facts) ? r.facts.length : -1
  const isMoment = (m: Moment) => !!m && Number.isInteger(m.at) && m.at >= 0 && m.at < n && (m.sign === 1 || m.sign === -1) && num(m.loss) && num(m.lead)
    && line(m.punish) && line(m.better) && map(m.lost) && map(m.kept)
  return r?.v === 2 && typeof r.key === 'string' && (r.side === 1 || r.side === -1 || r.side === 0) && Array.isArray(r.pos) && r.pos.length === n + 1
    && r.pos.every(isPos) && r.facts!.every(isFacts) && Array.isArray(r.moments) && r.moments.every(isMoment)
    ? { key: r.key, side: r.side, pos: r.pos, facts: r.facts!, moments: r.moments } : null
}

// ---------- one queue for every write ----------
let queue: Promise<unknown> = Promise.resolve()
const queued = <T>(f: () => Promise<T>): Promise<T> => { const r = queue.catch(() => {}).then(f); queue = r; return r }

/** The game's SGF (null: unchanged) and its entry (null: unchanged); the entry also updates the store at once. */
export function write(id: string, sgf: string | null, entry: Entry | null): Promise<void> {
  if (entry) change(id, entry)
  return queued(() => call<void>('library_write', { id, sgf, entry }))
}
/** Merges fields into a stored entry (memory score, counted, rankRead…), loading the index first if needed; unknown ids are ignored. */
export function patch(id: string, p: Partial<Omit<Entry, 'id'>>): Promise<void> {
  if (!entries) return load().then(() => patch(id, p))
  const e = entries.find(x => x.id === id)
  return e ? write(id, null, { ...e, ...p }) : Promise.resolve()
}
export function remove(id: string): Promise<void> {
  change(id, null)
  return queued(() => call<void>('library_delete', { id }))
}
export const setSidecar = (id: string, name: string, json: unknown) => queued(() => call<void>('library_sidecar_write', { id, name, json }))
export const setCurrent = (c: Current | null) => queued(() => call<void>('library_current_write', { json: c }))

// ---------- the store (for useSyncExternalStore) ----------
let entries: Entry[] | null = null // null: not loaded yet
let loading: Promise<Entry[]> | null = null
// Changes made before the index is loaded (null: removed), applied over it once it is: the list may predate them.
const early = new Map<string, Entry | null>()
const subs = new Set<() => void>()
const set = (v: Entry[]) => { entries = v; subs.forEach(f => f()) }
const applied = (xs: Entry[], id: string, e: Entry | null) => e ? upsert(xs, e) : xs.filter(x => x.id !== id)
function change(id: string, e: Entry | null) { if (entries) set(applied(entries, id, e)); else early.set(id, e) }
/** Newest first; an entry with the same id is replaced. */
export const upsert = (xs: Entry[], e: Entry) => [e, ...xs.filter(x => x.id !== e.id)].sort((a, b) => b.date - a.date)
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const get = () => entries
/** Loads the index once (again after a failure). */
export function load(): Promise<Entry[]> {
  if (entries) return Promise.resolve(entries)
  return loading ??= listAll().then(xs => {
    for (const [id, e] of early) xs = applied(xs, id, e)
    early.clear()
    set(xs)
    return xs
  }).finally(() => { loading = null })
}

/** A fresh id: the source's letter, the time and a random tail; an OGS game keeps its OGS id, a file its content hash. */
export function newId(source: Source, o: { ogsId?: number; hash?: string; now?: number } = {}): string {
  if (source === 'ogs' && o.ogsId !== undefined) return `ogs-${o.ogsId}`
  if (source === 'file' && o.hash) return `file-${o.hash}`
  return `${source}-${(o.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ---------- a game and its entry ----------
const ids = new WeakMap<Game, string>()
/** The id a shown game is kept under in the library, once it entered it. */
export const idOf = (g: Game) => ids.get(g)
/** Ties a game to its library id (a game opened from the library, a local game given its id at its first move). */
export const bind = (g: Game, id: string) => { ids.set(g, id) }

/** An entry for a game, from its info and its SGF root properties (BR/WR ranks, HA, DT); `o` sets or overrides the rest. */
export function entryOf(g: Game, o: { id: string; source: Source; me: Sign | 0 } & Partial<Entry>): Entry {
  const d = g.root.data, first = (k: string) => d[k]?.[0] ?? ''
  // "2026-10-14", or a range "2026-10-14,15": its first day, a local date (Date.parse would read it as UTC midnight)
  const [y, m, day] = first('DT').slice(0, 10).split('-').map(Number), dt = m && day ? new Date(y, m - 1, day).getTime() : NaN
  const ha = parseInt(first('HA'), 10)
  return {
    date: Number.isFinite(dt) ? dt : Date.now(), size: g.info.size, komi: g.info.komi, handicap: ha >= 2 ? ha : 0,
    black: { name: g.info.playerBlack, rank: first('BR') }, white: { name: g.info.playerWhite, rank: first('WR') },
    ...g.info.result && { result: g.info.result }, ...o,
  }
}

/**
 * Keeps a game in the library once — a file reviewed, replayed from memory or guessed, an OGS game imported — and
 * returns its id. A file is keyed by its content, so opening the same file again finds the same entry.
 */
export async function keep(g: Game, source: Source, me: Sign | 0, extra: Partial<Entry> = {}): Promise<string> {
  const known = ids.get(g)
  if (known) return known
  const sgf = saveSgf(g), id = newId(source, { ogsId: extra.ogsId, hash: source === 'file' ? hash64(sgf) : undefined })
  ids.set(g, id)
  const xs = await load().catch(() => null)
  if (!xs?.some(e => e.id === id)) await write(id, sgf, entryOf(g, { id, source, me, ...source === 'file' && { added: Date.now() }, ...extra }))
  return id
}

/** A game saved again (a position played on after Terminer): its SGF now replaces its kept copy, kept first when new. */
export async function rewrite(g: Game, source: Source, me: Sign | 0): Promise<string> {
  const id = ids.get(g)
  if (!id) return keep(g, source, me)
  const prev = (await load().catch(() => null))?.find(e => e.id === id)
  await write(id, saveSgf(g), { ...prev, ...entryOf(g, { id, source, me, ...prev && { date: prev.date } }) })
  return id
}
