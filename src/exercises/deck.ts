// Exercises from your own games: each review's key moments become cards (FSRS, as the joseki), and the scan's leads say
// where you lose your points. Pure, plus load/save in localStorage like the joseki progress.
import { parseVertex, stringifyVertex } from '@sabaki/sgf'
import { Game, type Move, type Sign, type Vertex } from '../game'
import type { Card, Rating } from '../joseki/fsrs'
import { isCard, NEW_PER_DAY, today } from '../joseki/store'
import { hash64 } from '../joseki/sym'
import { phaseLosses, phaseOf, reviewEnd, verdict, type Moment } from '../review'

/** A key moment as a card: the position before the mistake (2-letter SGF codes, 'tt' = pass), its player to find better. */
export interface Exercise {
  t: number // made at (ms): new exercises wait for the next day
  vs: string // the opponent of the side that made the mistake, as named in the game ('' if unnamed)
  size: number; komi: number
  b: string; w: string // setup (handicap) stones
  moves: string // the real moves before the mistake (pseudo-moves dropped; they alternate, ending with the opponent's)
  sign: Sign // who made the mistake, to play here
  played: string // the mistake
  loss: number // points it lost (the review's deep check)
  best: number // Black's lead with the better move
  better: string; punish: string // KataGo's better line from here, and the line punishing the mistake (after it)
  // a tsumego ('ld', src/tsumego/mine.ts): the whole position set up (moves ''), `sign` saves or kills the chain;
  // a yose position ('yose', never stored): `played` is the second biggest move, `loss` what it gives up
  kind?: 'ld' | 'yose'
  chain?: string // the chain at stake
  n?: number // the move number the position was taken at
}
/** A reviewed game: points your moves lost in the opening, middle game and endgame; t: when reviewed, d: when played (its
 *  library entry's date, absent when the game isn't in the library or for reviews kept before v0.5). */
export interface Played { k: string; t: number; loss: number[]; d?: number }
export interface Deck { v: 1; items: Record<string, Exercise>; cards: Record<string, Card>; day: string; fresh: number; games: Played[] }
export interface StoredDeck { p: Deck; readOnly: boolean }
export const KEY = 'masame.exercises', BAD = 'masame.exercises.bad', GAMES = 20
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const code = (v: Vertex | null) => (v ? stringifyVertex(v) : 'tt')
const codes = (vs: (Vertex | null)[]) => vs.map(code).join('')
const real = (moves: Move[]) => codes(moves.filter(m => !m.setup).map(m => m.vertex))
/** A line from its codes; 'tt' is a pass. */
export const lineOf = (s: string): (Vertex | null)[] => (s.match(/../g) ?? []).map(c => (c === 'tt' ? null : parseVertex(c)))

export function exerciseOf(game: Game, m: Moment, now: number): Exercise {
  const { size, komi, setup, playerBlack, playerWhite } = game.info
  return {
    t: now, vs: m.sign === 1 ? playerWhite : playerBlack, size, komi, b: codes(setup.black), w: codes(setup.white),
    moves: real(game.moves.slice(0, m.at)), sign: m.sign, played: code(game.moves[m.at].vertex), loss: m.loss,
    best: m.lead + m.sign * m.loss, better: codes(m.better), punish: codes(m.punish),
  }
}
/** The position before the mistake: reviewing the same game twice adds nothing. */
export const keyOf = (x: Exercise) => hash64(`${x.size}|${x.komi}|${x.b}|${x.w}|${x.sign}|${x.moves}`)
/** The mistake's move number. */
export const mv = (x: Exercise) => x.n ?? x.moves.length / 2 + 1

/** The position before the mistake; its moves alternate and end with the opponent's, which sets who started. */
export function positionOf(x: Exercise): Game {
  const moves = lineOf(x.moves), firstSign = (moves.length % 2 ? -x.sign : x.sign) as Sign
  return Game.fromRecord({ size: x.size, komi: x.komi, setup: { black: lineOf(x.b) as Vertex[], white: lineOf(x.w) as Vertex[] }, firstSign },
    moves.map((vertex, i) => ({ sign: (i % 2 ? -firstSign : firstSign) as Sign, vertex })))
}

/** A reviewed record: the same game, from any file or source, reviewed once (its readable range only). */
export function recordKey(game: Game): string {
  const { size, komi, setup } = game.info, moves = game.moves.slice(0, reviewEnd(game))
  return hash64(`${size}|${komi}|${codes(setup.black)}|${codes(setup.white)}|${moves.find(m => !m.setup)?.sign ?? 0}|${real(moves)}`)
}

/** New exercises for a review's moments (known ones untouched) and, when `me` is known, where its moves lost points. */
export function addReview(d: Deck, game: Game, moments: Moment[], leads: (number | undefined)[], me: Sign | 0, now: number, date?: number): Deck {
  const items = { ...d.items }
  for (const m of moments) { const x = exerciseOf(game, m, now); const k = keyOf(x); if (!Object.hasOwn(items, k)) items[k] = x }
  if (!me) return { ...d, items }
  const k = recordKey(game), moves = game.moves.slice(0, reviewEnd(game))
  return { ...d, items, games: [...d.games.filter(g => g.k !== k), { k, t: now, loss: phaseLosses(leads, moves, me, game.info.size), ...date !== undefined && { d: date } }].slice(-GAMES) }
}

const fresh = (d: Deck, now: number) => (d.day === today(now) ? d.fresh : 0)
const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0)
/** Which cards a trainer shows: find-better ones, tsumego, or (null) all of them. */
export type Only = 'find' | 'ld' | null
const kept = (only: Only) => (x: Exercise) => only === null || (only === 'ld') === (x.kind === 'ld')
const isNew = (d: Deck, only: Only = null) => Object.entries(d.items).filter(([k, x]) => !Object.hasOwn(d.cards, k) && kept(only)(x))

/** The weakest phase (most points lost per game: 0 opening, 1 middle game, 2 endgame), null before any loss. */
export function weakest(games: Played[]): 0 | 1 | 2 | null {
  const w = whereLost(games), top = Math.max(...w)
  return Math.round(top) > 0 ? w.indexOf(top) as 0 | 1 | 2 : null
}
/** The next `n` exercises: the due cards, most overdue first, then within today's quota the oldest new ones made before
 *  today (in game order); with `weak`, that phase's exercises come first in each group (the daily ritual's hand). */
export function hand(d: Deck, now: number, n: number, weak: 0 | 1 | 2 | null = null, only: Only = null): string[] {
  const lean = (x: Exercise) => (weak !== null && phaseOf(mv(x), x.size) !== weak ? 1 : 0)
  const due = Object.entries(d.cards).filter(([k, c]) => Object.hasOwn(d.items, k) && c.due <= now && kept(only)(d.items[k]))
    .sort((a, b) => lean(d.items[a[0]]) - lean(d.items[b[0]]) || a[1].due - b[1].due).map(([k]) => k)
  // made today: the review itself was today's lesson
  const m = midnight(now), quota = Math.max(0, NEW_PER_DAY - fresh(d, now))
  const news = isNew(d, only).filter(([, x]) => x.t < m).sort(([, a], [, b]) => lean(a) - lean(b) || a.t - b.t || mv(a) - mv(b)).slice(0, quota).map(([k]) => k)
  return [...due, ...news].slice(0, n)
}
/** The most overdue card first; then, within today's quota, the oldest new exercise made before today (in game order). */
export const nextExercise = (d: Deck, now: number, weak: 0 | 1 | 2 | null = null, only: Only = null): string | null => hand(d, now, 1, weak, only)[0] ?? null

/** A practice session on one phase: `n` cards of that phase (find-better and tsumego), the due and today's new first,
 *  then the soonest due; shuffled so both kinds mix. */
export function sessionKeys(d: Deck, now: number, n: number, phase: 0 | 1 | 2, random = Math.random): string[] {
  const of = (k: string) => phaseOf(mv(d.items[k]), d.items[k].size) === phase
  const first = hand(d, now, Infinity).filter(of)
  const rest = Object.keys(d.items).filter(k => of(k) && !first.includes(k)).sort((a, b) => (d.cards[a]?.due ?? d.items[a].t) - (d.cards[b]?.due ?? d.items[b].t))
  const keys = [...first, ...rest].slice(0, n)
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]] }
  return keys
}

/** Due cards, new exercises available today (within the quota), new ones made today (from tomorrow). The two rows
 *  (find-better, tsumego) share one quota: half each, the half one row can't use going to the other, so that together
 *  they never promise more new cards than today opens. */
export function counts(d: Deck, now: number, only: Only = null) {
  const m = midnight(now), news = isNew(d, only), later = news.filter(([, x]) => x.t >= m).length
  const q = Math.max(0, NEW_PER_DAY - fresh(d, now)), ready = (o: Only) => isNew(d, o).filter(([, x]) => x.t < m).length
  const find = Math.min(ready('find'), Math.max(Math.ceil(q / 2), q - ready('ld')))
  return {
    due: Object.entries(d.cards).filter(([k, c]) => Object.hasOwn(d.items, k) && c.due <= now && kept(only)(d.items[k])).length,
    fresh: only === null ? Math.min(q, news.length - later) : only === 'find' ? find : Math.min(ready('ld'), q - find), later,
  }
}

/** Points between a try and the better move: known for the better move and the game's mistake, else from `lead` (Black's, after the try). */
export function gapOf(x: Exercise, tried: Vertex, lead: number | null): number | null {
  const c = code(tried)
  return c === x.better.slice(0, 2) ? 0 : c === x.played ? x.loss : lead === null ? null : Math.max(0, x.sign * (x.best - lead))
}
/** The review's verdict on a try: found, short of the best, or no better than the game move. */
export const verdictOf = (x: Exercise, gap: number) => verdict({ loss: x.loss } as Moment, gap)
export const ratingOf = (x: Exercise, gap: number): Rating => ({ found: 3, short: 2, missed: 1 } as const)[verdictOf(x, gap)]

/** Average points lost per game in each phase, never below 0 for display. */
export const whereLost = (games: Played[]): number[] =>
  [0, 1, 2].map(p => games.length ? Math.max(0, games.reduce((s, g) => s + g.loss[p], 0) / games.length) : 0)

export const emptyDeck = (): Deck => ({ v: 1, items: {}, cards: {}, day: today(), fresh: 0, games: [] })
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
/** Codes on an n×n board, 'tt' (pass) aside. */
const fits = (s: unknown, n: number) => typeof s === 'string' && /^([a-t]{2})*$/.test(s) && lineOf(s).every(v => !v || (v[0] < n && v[1] < n))
export const isItem = (x: unknown) => obj(x) && num(x.t) && num(x.komi) && num(x.loss) && num(x.best) && typeof x.vs === 'string'
  && Number.isInteger(x.size) && (x.size as number) >= 2 && (x.size as number) <= 19 && (x.sign === 1 || x.sign === -1)
  && ['b', 'w', 'moves', 'better', 'punish', 'played'].every(k => fits(x[k], x.size as number)) && (x.played as string).length === 2
  && [x.b, x.w].every(s => !lineOf(s as string).includes(null)) // setup stones are never passes
  && (x.kind === undefined || x.kind === 'ld' && fits(x.chain, x.size as number) && !!(x.chain as string) && Number.isInteger(x.n) && (x.n as number) > 0)
const isGame = (g: unknown) => obj(g) && typeof g.k === 'string' && num(g.t) && Array.isArray(g.loss) && g.loss.length === 3 && g.loss.every(num) && (g.d === undefined || num(g.d))

export function load(st: Storage = localStorage): StoredDeck {
  let raw: string | null = null
  try { raw = st.getItem(KEY) } catch { return { p: emptyDeck(), readOnly: false } } // storage disabled
  if (raw === null) return { p: emptyDeck(), readOnly: false }
  try {
    const j = JSON.parse(raw)
    if (num(j?.v) && j.v > 1) return { p: emptyDeck(), readOnly: true }
    if (j?.v === 1 && obj(j.items) && obj(j.cards) && Array.isArray(j.games) && typeof j.day === 'string' && num(j.fresh)) {
      const items = Object.fromEntries(Object.entries(j.items).filter(([k, x]) => !(k in Object.prototype) && isItem(x))) as Deck['items'] // keys never shadow Object's
      const cards = Object.fromEntries(Object.entries(j.cards).filter(([k, c]) => isCard(c) && Object.hasOwn(items, k))) as Deck['cards']
      const games = j.games.filter(isGame) as Played[]
      // a bad entry costs that entry only; the raw text is kept aside
      if (Object.keys(items).length < Object.keys(j.items).length || Object.keys(cards).length < Object.keys(j.cards).length || games.length < j.games.length)
        try { st.setItem(BAD, raw) } catch { /* full */ }
      const p: Deck = { v: 1, items, cards, games, day: j.day, fresh: j.fresh }
      return { p: j.day === today() ? p : { ...p, day: today(), fresh: 0 }, readOnly: false }
    }
  } catch { /* garbage: below */ }
  try { st.setItem(BAD, raw) } catch { /* full: the fresh start still beats a crash */ }
  return { p: emptyDeck(), readOnly: false }
}

export function save(s: StoredDeck, st: Storage = localStorage) {
  if (s.readOnly) return
  try { st.setItem(KEY, JSON.stringify(s.p)) } catch { /* private mode: this session only */ }
}
