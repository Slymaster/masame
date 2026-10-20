// Earned stone sets and the Heirloom patina, from data the app already keeps: the library (finished and reviewed games),
// the daily ritual's streak, the exercises deck (tsumego solved). Nothing new is tracked; masame.stones only keeps the
// Heirloom's renewal offset and the earned sets already announced (an earned set stays earned once said).
// No three.js. Owner's captures: localStorage['masame.unlockAll'] = '1' or ?unlock=1 in the URL opens every set.
import type { Deck } from './exercises/deck'
import type { Entry } from './library'
import type { Ritual } from './today/ritual'
import { readV1, writeV1 } from './store'
import { STONE_DATA, type StoneSet } from './board3d/stoneSets'

export type Unlock = 'games10' | 'streak7' | 'review' | 'tsumego'
export interface Stats { finished: number; streak: number; reviewed: boolean; tsumego: boolean }
/** Finished games for the full patina. */
export const PATINA_GAMES = 300

export function unlocked(s: Stats): Set<Unlock> {
  const u = new Set<Unlock>()
  if (s.finished >= 10) u.add('games10')
  if (s.streak >= 7) u.add('streak7')
  if (s.reviewed) u.add('review')
  if (s.tsumego) u.add('tsumego')
  return u
}

/** The Heirloom stones' age: 0 new … 1 after PATINA_GAMES finished games since the last renewal. */
export const patina = (finished: number, renewedAt = 0) => Math.min(1, Math.max(0, finished - renewedAt) / PATINA_GAMES)

/** The stats from the stores' values (entries null: the library isn't loaded, or outside the app). */
export function statsOf(entries: readonly Entry[] | null, ritual: Pick<Ritual, 'streak'>, deck: Pick<Deck, 'items' | 'cards'>): Stats {
  const xs = entries ?? []
  return {
    finished: xs.filter(e => !!e.result).length,
    streak: ritual.streak,
    reviewed: xs.some(e => !!e.review),
    // a tsumego from your games ('ld') answered right at least once: every Again is a lapse, every answer a rep
    tsumego: Object.entries(deck.cards).some(([k, c]) => deck.items[k]?.kind === 'ld' && c.reps > c.lapses),
  }
}

type Rares = Partial<Record<string, { rare?: string }>>
const rares = (data: Rares) => Object.entries(data).filter(([, d]) => d?.rare).map(([s, d]) => [s as StoneSet, d!.rare as Unlock] as const)
/** The sets still to earn: a set with `rare` whose milestone isn't reached and that was never announced. */
export const lockedSets = (have: Set<Unlock>, said: readonly string[], all = false, data: Rares = STONE_DATA) =>
  new Set(all ? [] : rares(data).filter(([s, u]) => !have.has(u) && !said.includes(s)).map(([s]) => s))
/** The earned sets not announced yet. */
export const toAnnounce = (have: Set<Unlock>, said: readonly string[], data: Rares = STONE_DATA) =>
  rares(data).filter(([s, u]) => have.has(u) && !said.includes(s)).map(([s]) => s)

/* ---------- masame.stones ---------- */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export interface StonesStore { v: 1; renewedAt: number; said: string[] }
export const KEY = 'masame.stones'
export function loadStones(st: Storage = localStorage): StonesStore {
  const j = readV1<StonesStore>(KEY, j => Number.isInteger(j.renewedAt) && Array.isArray(j.said), st)
  return { v: 1, renewedAt: j?.renewedAt ?? 0, said: (j?.said ?? []).filter(x => typeof x === 'string') }
}
export const saveStones = (s: StonesStore, st: Storage = localStorage) => writeV1(KEY, s, st)

/** The owner's capture switch: every set open, nothing announced or remembered. */
export function unlockAll(st: Storage = localStorage, search = typeof location === 'undefined' ? '' : location.search) {
  try { if (st.getItem('masame.unlockAll') === '1') return true } catch { /* storage disabled */ }
  return new URLSearchParams(search).get('unlock') === '1'
}
