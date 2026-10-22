// The local game in progress survives closing the app (A1). A local game (against the AI or two players) gets its library
// id at its first move; then its SGF and entry are written 500 ms after the last change (at once when it ends), and
// current.json points at it while it is unfinished. At launch it comes back as it was, its clock paused. OGS games never
// come here: they live on OGS (they enter the library at their end or when imported, see App).
import { useEffect, useRef } from 'react'
import { clampRank } from './bot'
import type { Facts, Pos } from './classify'
import type { Game, Sign } from './game'
import { inTauri, on } from './katago'
import * as library from './library'
import type { Current, Entry } from './library'
import { sync, type LocalClock } from './localClock'
import type { Reading } from './rank'
import type { Moment } from './review'
import { loadSgf, saveSgf } from './sgf'

/** The AI of a local game. ritual: the daily 9×9 (never moves the AI level); era, mentor: a Master of an era, the mentor on. */
export interface Bot { sign: Sign; rank: string; ritual?: true; era?: number; mentor?: true }
/** What a write reads: the shown game, its AI, its clock, the player's level (the rank on the player's side). */
export interface Shown { game: Game; bot: Bot | null; clock: LocalClock | null; myRank: string }

const dates = new WeakMap<Game, number>() // the local games → when they began (0: not yet, set at the first move)
/** Marks a game as local: kept from its first move. `e`: its library entry, for a game reopened or restored. */
export function local(g: Game, e?: Pick<Entry, 'id' | 'date'>): Game {
  dates.set(g, e?.date ?? 0)
  if (e) library.bind(g, e.id)
  return g
}
export const isLocal = (g: Game) => dates.has(g)
/** An unfinished local game with moves: leaving it asks first (it stays in the library, unfinished). */
export const unfinished = (g: Game) => dates.has(g) && g.moves.length > 0 && !g.info.result

/** An entry of the library played again: an unfinished game against the AI or between two players, its AI from the entry. */
export function resumable(e: Entry): { bot: Bot | null } | null {
  if (e.result || (e.source !== 'ai' && e.source !== 'two')) return null
  if (e.source !== 'ai' || !e.me) return { bot: null }
  const sign = -e.me as Sign
  return { bot: { sign, rank: clampRank((sign === 1 ? e.black : e.white).rank), ...e.era !== undefined && { era: e.era }, ...e.mentor && { mentor: true as const } } }
}

/** The shown line as child indices from the root (a variation played on comes back as the shown line). */
const lineOf = (g: Game) => g.nodes.slice(1).map((n, i) => g.nodes[i].children.indexOf(n))

/** What to write for a local game: its SGF, its entry (over the stored one: other fields stay), current.json (null once decided). */
export function snapshot(id: string, { game, bot, clock, myRank }: Shown, now: number, prev?: Entry) {
  const side = (s: Sign) => ({ name: s === 1 ? game.info.playerBlack : game.info.playerWhite, rank: bot ? (s === bot.sign ? bot.rank : prev?.[s === 1 ? 'black' : 'white']?.rank || myRank) : '' })
  const entry: Entry = { ...prev, ...library.entryOf(game, {
    id, source: bot ? 'ai' : 'two', me: bot ? -bot.sign as Sign : 0, date: dates.get(game) || now, black: side(1), white: side(-1),
    result: game.info.result, ...bot?.era !== undefined && { era: bot.era }, ...bot?.mentor && { mentor: prev?.mentor ?? { stops: 0 } },
  }) }
  const current: Current | null = game.info.result ? null : {
    id, cursor: game.cursor, line: lineOf(game), bot: bot && { ...bot, sign: bot.sign as 1 | -1 }, handicap: entry.handicap,
    clock: clock && sync(clock, null, now, clock.len), // paused, the running side charged
  }
  return { sgf: saveSgf(game), entry, current }
}

/** The writer: call changed() after every change of the shown game; `get` gives the latest state when the write happens. */
export function keeper(out: Pick<typeof library, 'write' | 'setCurrent'> = library, delay = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined, job: (() => void) | null = null, last: (() => void) | null = null, lastId = '', shown: Game | null = null
  const flush = () => { clearTimeout(timer); const j = job; job = null; j?.() }
  const report = (p: Promise<void>) => { p.catch(e => console.error('library', e)) }
  return {
    flush,
    /** Closing the app: the pending write, or the shown unfinished game written again, its clock charged up to now. */
    close() { if (job) flush(); else if (shown && unfinished(shown) && library.idOf(shown) === lastId) last?.() },
    changed(get: () => Shown) {
      const s = get(), g = s.game
      if (g !== shown) { // another game: the last one's pending write first; an unfinished one is no longer the current game
        flush()
        if (shown && unfinished(shown) && library.idOf(shown)) report(out.setCurrent(null))
        shown = g
      }
      if (!dates.has(g) || !g.moves.length) return
      let id = library.idOf(g)
      if (!id) library.bind(g, id = library.newId(s.bot ? 'ai' : 'two'))
      if (!dates.get(g)) dates.set(g, Date.now())
      const key = id
      lastId = key
      job = last = () => {
        const now = get(), x = snapshot(key, now.game === g ? now : s, Date.now(), library.get()?.find(e => e.id === key))
        report(out.write(key, x.sgf, x.entry)); report(out.setCurrent(x.current))
      }
      clearTimeout(timer); timer = setTimeout(flush, delay)
      if (g.info.result) flush()
    },
  }
}

const isClock = (c: unknown): c is LocalClock => !!c && typeof c === 'object' && ['spec', 'b', 'w'].every(k => k in c)

/** current.json and its SGF → the game at its cursor on its line, its AI, its clock paused. */
export function restore(c: Current, sgf: string): { game: Game; bot: Bot | null; clock: LocalClock | null } {
  const game = loadSgf(sgf)
  if (c.line?.some(i => i > 0)) {
    game.goTo(0)
    for (const i of c.line) {
      const m = game.nodes[game.cursor].children[i]?.move
      if (!m || m.setup || game.play(m.vertex) !== 'ok') break
    }
  }
  game.goTo(c.cursor)
  const b = c.bot
  return {
    game, clock: isClock(c.clock) ? { ...c.clock, turn: null } : null,
    bot: b && (b.sign === 1 || b.sign === -1) ? { sign: b.sign, rank: clampRank(b.rank), ...b.ritual && { ritual: true as const },
      ...typeof b.era === 'number' && { era: b.era }, ...b.mentor && { mentor: true as const } } : null,
  }
}

/** The unfinished game current.json points at, made local again under its id; null when there is none (a decided one is cleared). */
export async function resumeCurrent() {
  const c = await library.current()
  if (!c) return null
  const [sgf, xs] = await Promise.all([
    library.read(c.id).catch(e => { if ((e as { code?: string })?.code === 'library_not_found') void library.setCurrent(null); throw e }),
    library.load().catch(() => [] as Entry[]),
  ])
  const r = restore(c, sgf)
  if (r.game.info.result) { void library.setCurrent(null); return null }
  local(r.game, { id: c.id, date: xs.find(e => e.id === c.id)?.date ?? 0 })
  return r
}

/** Calls flush when the page goes away (pagehide) or the app to the background: iOS and Android kill a suspended app
 * without any close event, so its game must already be written then. Returns the cleanup. */
export function onLeave(flush: () => void, w: EventTarget = window, d: EventTarget & { visibilityState: DocumentVisibilityState } = document) {
  const hidden = () => { if (d.visibilityState === 'hidden') flush() }
  w.addEventListener('pagehide', flush); d.addEventListener('visibilitychange', hidden)
  return () => { w.removeEventListener('pagehide', flush); d.removeEventListener('visibilitychange', hidden) }
}

/** Keeps the shown local game (in the app only) and, once at launch, hands back the unfinished one to restore. */
export function useCurrentGame(s: Shown, ver: number, onRestore: (r: Awaited<ReturnType<typeof restore>>) => void) {
  const k = useRef<ReturnType<typeof keeper> | null>(null), latest = useRef(s), first = useRef(s.game), restoreRef = useRef(onRestore)
  latest.current = s; restoreRef.current = onRestore
  useEffect(() => { if (inTauri()) (k.current ??= keeper()).changed(() => latest.current) }, [ver, s.game, s.bot])
  useEffect(() => { // closing the window or quitting: the pending write now (Rust waits a moment before closing, see lib.rs)
    if (!inTauri()) return
    const flush = () => k.current?.close(), off = on<null>('library-flush', flush), stop = onLeave(flush)
    return () => { stop(); off.then(f => f()) }
  }, [])
  useEffect(() => {
    if (!inTauri()) return
    // only onto the launch's empty board: a game opened meanwhile (a file from Finder) wins
    resumeCurrent().then(r => { if (r && latest.current.game === first.current) restoreRef.current(r) }, e => console.error('resume', e))
  }, [])
}

/** A review (automatic or by hand) read: its positions, facts and moments in the 'review' sidecar (v2, leads kept for the
 * older readers), tied to the line read (`key`: recordKey) and the side the moments were picked for; the entry marked reviewed. */
export async function noteReview(id: string | undefined | Promise<string | undefined>, pos: (Pos | undefined)[], moments: Moment[], facts: Facts[], of: { key: string; side: Sign | 0 }) {
  const k = await id
  if (!k) return
  // a position never read (a review stopped short) is stored as null, and makes reviewData ignore the sidecar
  await library.setSidecar(k, 'review', { leads: pos.map(p => p?.lead ?? null), moments, v: 2, pos: pos as Pos[], facts, ...of } satisfies library.ReviewSidecar)
  await library.patch(k, { review: { moments: moments.length } })
}
/** The player's rank read in a kept game, once stored; never for a game played with the mentor (a lesson). */
export async function noteRank(id: string | undefined | Promise<string | undefined>, r: Reading) {
  const k = await id
  if (k && !(await library.load()).find(e => e.id === k)?.mentor) await library.patch(k, { rankRead: r })
}
