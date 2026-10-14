// Exercises from your own games: each review's key moments become cards (FSRS, as the joseki), and the scan's leads say
// where you lose your points. Pure, plus load/save in localStorage like the joseki progress.
import { parseVertex, stringifyVertex } from '@sabaki/sgf'
import { Game, type Move, type Sign, type Vertex } from '../game'
import type { Card, Rating } from '../joseki/fsrs'
import { isCard, NEW_PER_DAY, today } from '../joseki/store'
import { hash64 } from '../joseki/sym'
import { phaseLosses, reviewEnd, verdict, type Moment } from '../review'

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
}
/** A reviewed game: points your moves lost in the opening, middle game and endgame. */
export interface Played { k: string; t: number; loss: number[] }
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
export const mv = (x: Exercise) => x.moves.length / 2 + 1

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
export function addReview(d: Deck, game: Game, moments: Moment[], leads: (number | undefined)[], me: Sign | 0, now: number): Deck {
  const items = { ...d.items }
  for (const m of moments) { const x = exerciseOf(game, m, now); const k = keyOf(x); if (!Object.hasOwn(items, k)) items[k] = x }
  if (!me) return { ...d, items }
  const k = recordKey(game), moves = game.moves.slice(0, reviewEnd(game))
  return { ...d, items, games: [...d.games.filter(g => g.k !== k), { k, t: now, loss: phaseLosses(leads, moves, me, game.info.size) }].slice(-GAMES) }
}

const fresh = (d: Deck, now: number) => (d.day === today(now) ? d.fresh : 0)
const midnight = (now: number) => new Date(now).setHours(0, 0, 0, 0)
const isNew = (d: Deck) => Object.entries(d.items).filter(([k]) => !Object.hasOwn(d.cards, k))

/** The most overdue card first; then, within today's quota, the oldest new exercise made before today (in game order). */
export function nextExercise(d: Deck, now: number): string | null {
  const due = Object.entries(d.cards).filter(([k, c]) => Object.hasOwn(d.items, k) && c.due <= now).sort((a, b) => a[1].due - b[1].due)
  if (due.length) return due[0][0]
  if (fresh(d, now) >= NEW_PER_DAY) return null
  // made today: the review itself was today's lesson
  const m = midnight(now), news = isNew(d).filter(([, x]) => x.t < m).sort(([, a], [, b]) => a.t - b.t || mv(a) - mv(b))
  return news[0]?.[0] ?? null
}

/** Due cards, new exercises available today (within the quota), new ones made today (from tomorrow). */
export function counts(d: Deck, now: number) {
  const m = midnight(now), news = isNew(d), later = news.filter(([, x]) => x.t >= m).length
  return {
    due: Object.entries(d.cards).filter(([k, c]) => Object.hasOwn(d.items, k) && c.due <= now).length,
    fresh: Math.min(Math.max(0, NEW_PER_DAY - fresh(d, now)), news.length - later), later,
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
const isItem = (x: unknown) => obj(x) && num(x.t) && num(x.komi) && num(x.loss) && num(x.best) && typeof x.vs === 'string'
  && Number.isInteger(x.size) && (x.size as number) >= 2 && (x.size as number) <= 19 && (x.sign === 1 || x.sign === -1)
  && ['b', 'w', 'moves', 'better', 'punish', 'played'].every(k => fits(x[k], x.size as number)) && (x.played as string).length === 2
  && [x.b, x.w].every(s => !lineOf(s as string).includes(null)) // setup stones are never passes
const isGame = (g: unknown) => obj(g) && typeof g.k === 'string' && num(g.t) && Array.isArray(g.loss) && g.loss.length === 3 && g.loss.every(num)

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
