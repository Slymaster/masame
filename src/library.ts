// The library: every game played or opened lives on this machine, as an SGF file per game plus one index, in the app
// data dir's games/ folder (Rust: src-tauri/src/library.rs). Outside the app every call rejects, and Mes parties says so.
// One store for the whole UI (Mes parties, Apprendre, Progrès), loaded once; every write goes through one queue, in order.
import { call } from './katago'
import type { Reading } from './rank'
import type { Moment } from './review'

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
  review?: { moments: number } // reviewed (automatically or by hand): its leads and moments are in the 'review' sidecar
  memory?: { recalled: number; total: number; helps: number } // replayed from memory (C2), the best run
  counted?: number // positions of this game counted so far (C1)
}
/** The 'review' sidecar (<id>.review.json): the scan's leads per move (Black's lead, null where unread) and the moments. */
export interface ReviewSidecar { leads: (number | null)[]; moments: Moment[] }
/** current.json: the unfinished local game to restore at launch (A1). */
export interface Current {
  id: string; cursor: number
  bot: { sign: 1 | -1; rank: string; era?: number; mentor?: boolean } | null
  clock: unknown // the local clock's state (src/localClock.ts), or null
  handicap: number
}

export const PAGE = 50 // Mes parties shows the list 50 rows at a time ("See more")

// ---------- the Rust commands ----------
const listAll = () => call<Entry[]>('library_list') // newest first; a corrupt entry is skipped by Rust
export const read = (id: string) => call<string>('library_read', { id })
export const sidecar = <T>(id: string, name: string) => call<T | null>('library_sidecar_read', { id, name })
export const current = () => call<Current | null>('library_current_read')

// ---------- one queue for every write ----------
let queue: Promise<unknown> = Promise.resolve()
const queued = <T>(f: () => Promise<T>): Promise<T> => { const r = queue.catch(() => {}).then(f); queue = r; return r }

/** The game's SGF (null: unchanged) and its entry (null: unchanged); the entry also updates the store at once. */
export function write(id: string, sgf: string | null, entry: Entry | null): Promise<void> {
  if (entry) set(upsert(entries ?? [], entry))
  return queued(() => call<void>('library_write', { id, sgf, entry }))
}
/** Merges fields into a stored entry (memory score, counted, rankRead…); unknown ids are ignored. */
export function patch(id: string, p: Partial<Omit<Entry, 'id'>>): Promise<void> {
  const e = entries?.find(x => x.id === id)
  return e ? write(id, null, { ...e, ...p }) : Promise.resolve()
}
export function remove(id: string): Promise<void> {
  if (entries) set(entries.filter(e => e.id !== id))
  return queued(() => call<void>('library_delete', { id }))
}
export const setSidecar = (id: string, name: string, json: unknown) => queued(() => call<void>('library_sidecar_write', { id, name, json }))
export const setCurrent = (c: Current | null) => queued(() => call<void>('library_current_write', { json: c }))

// ---------- the store (for useSyncExternalStore) ----------
let entries: Entry[] | null = null // null: not loaded yet
let loading: Promise<Entry[]> | null = null
const subs = new Set<() => void>()
const set = (v: Entry[]) => { entries = v; subs.forEach(f => f()) }
/** Newest first; an entry with the same id is replaced. */
export const upsert = (xs: Entry[], e: Entry) => [e, ...xs.filter(x => x.id !== e.id)].sort((a, b) => b.date - a.date)
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const get = () => entries
/** Loads the index once (again after a failure). */
export function load(): Promise<Entry[]> {
  if (entries) return Promise.resolve(entries)
  return loading ??= listAll().then(xs => { set(xs); return xs }).finally(() => { loading = null })
}

/** A fresh id: the source's letter, the time and a random tail; an OGS game keeps its OGS id, a file its content hash. */
export function newId(source: Source, o: { ogsId?: number; hash?: string; now?: number } = {}): string {
  if (source === 'ogs' && o.ogsId !== undefined) return `ogs-${o.ogsId}`
  if (source === 'file' && o.hash) return `file-${o.hash}`
  return `${source}-${(o.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
