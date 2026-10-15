import { describe, expect, it } from 'vitest'
import { Game, type Sign, type Vertex } from '../game'
import { review } from '../joseki/fsrs'
import { NEW_PER_DAY, today } from '../joseki/store'
import type { Moment } from '../review'
import { loadSgf } from '../sgf'
import {
  addReview, BAD, counts, emptyDeck, exerciseOf, GAMES, gapOf, hand, KEY, keyOf, lineOf, load, mv, nextExercise, positionOf, ratingOf, save,
  weakest, whereLost, type Deck, type Exercise,
} from './deck'

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}
const moment = (o: Partial<Moment> = {}): Moment =>
  ({ at: 6, sign: 1, loss: 5, lead: -2, punish: [[3, 3], [5, 5]], better: [[4, 2], null], lost: null, kept: null, ...o })
const ex = (o: Partial<Exercise> = {}): Exercise => ({
  t: 0, vs: '', size: 9, komi: 6.5, b: '', w: '', moves: 'aabb', sign: 1, played: 'ge', loss: 5, best: 3, better: 'ectt', punish: 'dd', ...o,
})
const NOW = new Date(2026, 9, 13, 15).getTime(), H = 3_600_000, YESTERDAY = NOW - 24 * H

describe('an exercise', () => {
  // White first (a handicap stone), a pass, a comment-only node, then Black's mistake G4 (index 6)
  const game = loadSgf('(;SZ[9]KM[0.5]PB[Ann]PW[Bob]AB[cc];W[gg];B[gc];W[];B[cg];C[note];W[ee];B[ge])')
  it('is the position before the mistake', () => {
    const x = exerciseOf(game, moment(), NOW)
    expect(x).toEqual({ t: NOW, vs: 'Bob', size: 9, komi: 0.5, b: 'cc', w: '', moves: 'gggcttcgee', sign: 1, played: 'ge', loss: 5, best: 3, better: 'ectt', punish: 'ddff' })
    const g = positionOf(x)
    expect(g.board.signMap).toEqual(game.boards[6].signMap)
    expect([g.toPlay, g.lastMove?.vertex, mv(x)]).toEqual([1, [4, 4], 6])
    expect(lineOf(x.better)).toEqual([[4, 2], null])
    expect(exerciseOf(game, moment({ at: 5, sign: -1 }), NOW)).toMatchObject({ vs: 'Ann', moves: 'gggcttcg', played: 'ee' })
  })
  it('is added once, the statistic only for a known player, once per game', () => {
    const a = addReview(emptyDeck(), game, [moment()], [], 0, NOW)
    expect([Object.keys(a.items), a.games]).toEqual([[keyOf(exerciseOf(game, moment(), NOW))], []])
    const b = addReview(a, game, [moment()], [], 1, NOW + H)
    expect(b.items).toEqual(a.items) // made at NOW still
    expect(b.games).toEqual([{ k: expect.any(String), t: NOW + H, loss: [0, 0, 0] }])
    const c = addReview(b, game, [], [], 1, NOW + 2 * H)
    expect(c.games).toEqual([{ ...b.games[0], t: NOW + 2 * H }])
    let d = c
    for (let i = 0; i < GAMES + 1; i++) d = addReview(d, new Game({ size: 9, komi: i }), [], [], -1, NOW + i)
    expect([d.games.length, d.games.at(-1)!.t, d.games.some(g => g.k === c.games[0].k)]).toEqual([GAMES, NOW + GAMES, false])
  })
  it('tells apart the same moves played by the other colour first', () => {
    const b = loadSgf('(;SZ[9];B[aa];W[bb];B[cc])'), w = loadSgf('(;SZ[9];W[aa];B[bb];W[cc])')
    const d = addReview(addReview(emptyDeck(), b, [moment({ at: 2 })], [], 1, NOW), w, [moment({ at: 2, sign: -1 })], [], 1, NOW)
    expect([Object.keys(d.items).length, d.games.length]).toEqual([2, 2])
  })
})

describe('the next exercise', () => {
  const card = (due: number) => ({ ...review(undefined, 3, 0), due })
  const news = { old: ex({ t: YESTERDAY - H, moves: 'aabbcc' }), first: ex({ t: YESTERDAY - H }), new: ex({ t: YESTERDAY }), today: ex({ t: NOW - H }) }
  const deck = (o: Partial<Deck> = {}): Deck => ({
    ...emptyDeck(), day: today(NOW), items: { late: ex(), later: ex(), soon: ex(), ...news },
    cards: { late: card(NOW - 2 * H), later: card(NOW - H), soon: card(NOW + H) },
    ...o,
  })
  it('takes the most overdue card first', () => {
    expect(nextExercise(deck(), NOW)).toBe('late')
    expect(counts(deck(), NOW)).toEqual({ due: 2, fresh: 3, later: 1 })
  })
  it('then the oldest new one made before today, in game order', () => {
    const d = deck({ cards: {}, items: news })
    expect(nextExercise(d, NOW)).toBe('first')
    expect(nextExercise({ ...d, items: { new: news.new, today: news.today } }, NOW)).toBe('new')
    expect(nextExercise({ ...d, items: { today: news.today } }, NOW)).toBe(null)
    expect(nextExercise(deck({ cards: { late: card(NOW + H), later: card(NOW + H), soon: card(NOW + H) } }), NOW)).toBe('first')
  })
  it('ignores cards keyed like Object’s own properties', () => {
    const d = deck({ items: news, cards: { toString: card(NOW - H), constructor: card(NOW - 2 * H) } as Deck['cards'] })
    expect(nextExercise(d, NOW)).toBe('first')
    expect(counts(d, NOW)).toEqual({ due: 0, fresh: 3, later: 1 })
  })
  it('respects the daily quota of new ones', () => {
    const d = deck({ cards: {}, items: news, fresh: NEW_PER_DAY - 1 })
    expect(counts(d, NOW)).toEqual({ due: 0, fresh: 1, later: 1 })
    expect(nextExercise({ ...d, fresh: NEW_PER_DAY }, NOW)).toBe(null)
    expect(counts({ ...d, fresh: NEW_PER_DAY }, NOW)).toEqual({ due: 0, fresh: 0, later: 1 })
    expect(nextExercise({ ...d, fresh: NEW_PER_DAY, day: '2001-1-1' }, NOW)).toBe('first') // yesterday's count
  })
})

describe('the ritual\'s hand', () => {
  const card = (due: number) => ({ ...review(undefined, 3, 0), due })
  const end = 'aa'.repeat(40) // move 41 on 9×9: the endgame
  const d: Deck = {
    ...emptyDeck(), day: today(NOW),
    items: { a: ex(), b: ex({ moves: end }), c: ex(), e: ex({ moves: end }), n1: ex({ t: YESTERDAY }), n2: ex({ t: YESTERDAY - H, moves: end }) },
    cards: { a: card(NOW - 3 * H), b: card(NOW - H), c: card(NOW - 2 * H), e: card(NOW + H) },
  }
  it('takes the due cards first, then the new ones, up to the hand', () => {
    expect(hand(d, NOW, 6)).toEqual(['a', 'c', 'b', 'n2', 'n1'])
    expect(hand(d, NOW, 2)).toEqual(['a', 'c'])
    expect(nextExercise(d, NOW)).toBe('a')
  })
  it('leans toward the weakest phase within each group', () => {
    expect(hand(d, NOW, 6, 2)).toEqual(['b', 'a', 'c', 'n2', 'n1'])
    expect(nextExercise(d, NOW, 2)).toBe('b')
    expect(hand(d, NOW, 6, 0)).toEqual(['a', 'c', 'b', 'n1', 'n2'])
  })
  it('finds the weakest phase, none before a loss', () => {
    expect(weakest([])).toBe(null)
    expect(weakest([{ k: 'x', t: 0, loss: [0.2, -1, 0] }])).toBe(null)
    expect(weakest([{ k: 'x', t: 0, loss: [3, 9, 4] }, { k: 'y', t: 0, loss: [3, 1, 2] }])).toBe(1)
  })
})

describe('grading', () => {
  const v = (s: string) => lineOf(s)[0] as Vertex
  it('knows the better move and the game move, else asks the engine', () => {
    const x = ex()
    expect([gapOf(x, v('ec'), null), ratingOf(x, 0)]).toEqual([0, 3])
    expect([gapOf(x, v('ge'), null), ratingOf(x, 5)]).toEqual([5, 1])
    expect(gapOf(x, v('aa'), null)).toBe(null)
  })
  it('measures from the better move’s lead, never negative, for both colours', () => {
    const b = ex(), w = ex({ sign: -1 as Sign, best: -3 })
    expect([gapOf(b, v('aa'), 1), ratingOf(b, 2)]).toEqual([2, 2]) // short
    expect([gapOf(b, v('aa'), -1.5), ratingOf(b, 4.5)]).toEqual([4.5, 1]) // missed: less than 1 point better than the game move
    expect([gapOf(b, v('aa'), 3.5), gapOf(b, v('aa'), 2.2)]).toEqual([0, expect.closeTo(0.8)])
    expect(ratingOf(b, 0.8)).toBe(3)
    expect([gapOf(w, v('aa'), -1), gapOf(w, v('aa'), -4)]).toEqual([2, 0])
  })
})

describe('where you lose points', () => {
  it('averages per game, clamped at 0', () => {
    expect(whereLost([])).toEqual([0, 0, 0])
    expect(whereLost([{ k: 'a', t: 0, loss: [4, -2, 1] }, { k: 'b', t: 0, loss: [2, 4, -3] }])).toEqual([3, 1, 0])
  })
})

describe('storage', () => {
  const good = () => ({ v: 1, items: { a: ex(), b: ex() }, cards: { a: review(undefined, 3, 0) }, day: today(), fresh: 2, games: [{ k: 'g', t: 1, loss: [1, 2, 3] }] })
  it('round-trips', () => {
    const st = mem(), s = load(st)
    expect(s).toEqual({ p: emptyDeck(), readOnly: false })
    save({ p: good() as Deck, readOnly: false }, st)
    expect(load(st).p).toEqual(good())
    expect(st.m.has(BAD)).toBe(false)
  })
  it('starts fresh on garbage, keeping it aside', () => {
    for (const bad of ['{nope', 'null', JSON.stringify({ ...good(), games: {} })]) {
      const st = mem({ [KEY]: bad })
      expect(load(st)).toEqual({ p: emptyDeck(), readOnly: false })
      expect(st.m.get(BAD)).toBe(bad)
    }
  })
  it('drops a bad item with its card, an orphan card, a bad game', () => {
    for (const o of [
      { items: { a: ex({ moves: 'aab' }), b: ex() } }, { items: { a: ex({ size: 25 }), b: ex() } }, { items: { a: ex({ sign: 0 as Sign }), b: ex() } },
      { items: { a: ex({ moves: 'jj' }), b: ex() } }, { items: { a: ex({ played: '' }), b: ex() } }, { items: { a: ex({ loss: NaN }), b: ex() } },
    ]) {
      const raw = JSON.stringify({ ...good(), ...o }), st = mem({ [KEY]: raw })
      expect(load(st).p).toMatchObject({ items: { b: ex() }, cards: {} })
      expect(st.m.get(BAD)).toBe(raw)
    }
    const orphan = JSON.stringify({ ...good(), cards: { ...good().cards, z: review(undefined, 1, 0) } }), st = mem({ [KEY]: orphan })
    expect(Object.keys(load(st).p.cards)).toEqual(['a'])
    expect(st.m.get(BAD)).toBe(orphan)
    const proto = JSON.stringify({ ...good(), cards: { ...good().cards, toString: review(undefined, 3, 0), constructor: review(undefined, 3, 0) } })
    const st2 = mem({ [KEY]: proto })
    expect(Object.keys(load(st2).p.cards)).toEqual(['a'])
    expect(st2.m.get(BAD)).toBe(proto)
    const games = JSON.stringify({ ...good(), games: [{ k: 'g', t: 1, loss: [1, 2] }, good().games[0]] })
    expect(load(mem({ [KEY]: games })).p.games).toEqual(good().games)
  })
  it('restarts the daily count on a new day', () => {
    expect(load(mem({ [KEY]: JSON.stringify({ ...good(), day: '2001-1-1' }) })).p).toMatchObject({ day: today(), fresh: 0 })
  })
  it('never overwrites exercises from a newer version', () => {
    const newer = JSON.stringify({ v: 2, whatever: true }), st = mem({ [KEY]: newer })
    const s = load(st)
    expect(s).toEqual({ p: emptyDeck(), readOnly: true })
    save({ ...s, p: good() as Deck }, st)
    expect(st.m.get(KEY)).toBe(newer)
    expect(st.m.has(BAD)).toBe(false)
  })
})
