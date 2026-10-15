import { describe, expect, it, vi } from 'vitest'
import { rng } from '../board/noise'
import { openingBook } from '../today/ritual'
import { failureText } from '../i18n'
import { en } from '../i18n/en'
import { loadJoseki, reach, validate, type JosekiDb } from './db'
import fixture from './fuseki-fixture.json'
import josekiFixture from './fixture.json'
import { review } from './fsrs'
import {
  accepted, answer, contextOf, continuation, exploreOf, focus, isCard, isTenuki, nextCard, node, pathTo, plies, position, randomOrient, shown, shownAt, startLine, storedAt, walk,
} from './practice'
import { FUSEKI_KEY, KEY, load, record, save } from './store'
import { ALL, positionKey } from './sym'

const db: JosekiDb = { ...validate(structuredClone(fixture) as unknown as JosekiDb), family: 'fuseki' }
const joseki = validate(structuredClone(josekiFixture) as unknown as JosekiDb)
const R = reach(db), P = 2, now = Date.UTC(2026, 9, 14)
const paths = db.nodes.map((_, i) => pathTo(db, R, P, i))
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m } }

describe('the fuseki book', () => {
  it('starts from the empty board, Black first, with the whole board in view and no tenuki anywhere', () => {
    expect(contextOf(db)).toEqual([])
    expect(contextOf(joseki)).toHaveLength(3)
    expect(exploreOf(db)).toEqual({ k: 0, swap: false })
    expect(focus(db, { k: 3, swap: false })).toBeNull()
    expect(focus(joseki, { k: 0, swap: true })).not.toBeNull()
    expect(db.nodes.every(x => x.e.every(e => !isTenuki(db, e[0])))).toBe(true)
    expect(joseki.nodes.some(x => x.e.some(e => isTenuki(joseki, e[0])))).toBe(true)
    // openings are close in value: any book move within a point answers, however many there are
    expect(db.nodes.some((x, i) => isCard(db, i) && new Set(accepted(db, i).map(j => x.e[j][1])).size > 3)).toBe(true)
    // a "tenuki" answer is simply off the book
    const card = db.nodes.findIndex(x => x.e.length)
    expect(answer(db, startLine(db, paths[card], { k: 0, swap: false }), 'tenuki').phase).toBe('wrong')
  })
  it('replays every node in all 8 turns as the position stored, Black on the first move', () => {
    paths.forEach((p, i) => {
      const w = walk(db, p)
      expect(node(w)).toBe(i)
      expect(w.moves).toHaveLength(plies(db)[i])
      for (let k = 0; k < 8; k++) {
        const ms = shown(w.moves, { k, swap: false }, contextOf(db))
        expect(ms[0].sign).toBe(1)
        expect(positionKey(position(ms).signMap, w.moves.length, ALL)).toBe(db.nodes[i].k)
        for (const e of db.nodes[i].e) expect(storedAt(w, { k, swap: false }, shownAt(w, { k, swap: false }, e[0]))).toBe(e[0])
      }
    })
  })
  it('ends a line on KataGo’s own moves where the book stops', () => {
    const leaf = db.nodes.findIndex(x => !x.e.length && x.pv)
    const w = walk(db, paths[leaf])
    expect(continuation(db, leaf, w.frames.at(-1)!).length).toBeGreaterThan(0)
  })
})

describe('practising the fuseki', () => {
  it('turns the board at random but never swaps the colours (komi: Black plays first)', () => {
    const r = rng(7), os = Array.from({ length: 200 }, () => randomOrient('fuseki', r))
    expect(os.every(o => !o.swap)).toBe(true)
    expect(new Set(os.map(o => o.k)).size).toBe(8)
    const js = Array.from({ length: 200 }, () => randomOrient('joseki', r))
    expect(js.some(o => o.swap) && js.some(o => !o.swap)).toBe(true)
  })
  it('lets you play Black or White: the new card goes to the colour drawn', () => {
    const ply = plies(db)
    const b = nextCard(db, R, P, {}, 0, now, 0)!, w = nextCard(db, R, P, {}, 0, now, 1)!
    expect(ply[b] % 2).toBe(0) // an even number of moves played: Black to play
    expect(ply[w] % 2).toBe(1)
    // the learner is the side to move at the card
    expect(shown(walk(db, paths[w]).moves, { k: 0, swap: false }, []).at(-1)!.sign).toBe(1) // Black just played
  })
  it('keeps its progress apart from the joseki’s, in the same format', () => {
    const st = mem(), card = review(undefined, 3, now)
    save({ p: record(load(st, FUSEKI_KEY).p, 'f1', card), readOnly: false }, st, FUSEKI_KEY)
    save({ p: record(load(st).p, 'j1', card), readOnly: false }, st)
    expect(Object.keys(load(st, FUSEKI_KEY).p.cards)).toEqual(['f1'])
    expect(Object.keys(load(st, KEY).p.cards)).toEqual(['j1'])
    st.setItem(FUSEKI_KEY, 'garbage')
    expect(load(st, FUSEKI_KEY).p.cards).toEqual({})
    expect(st.m.get(`${FUSEKI_KEY}.bad`)).toBe('garbage')
    expect(st.m.has(`${KEY}.bad`)).toBe(false)
  })
})

describe('the ritual', () => {
  it('takes the fuseki when the opening is your weakest phase, the joseki otherwise', () => {
    expect(openingBook(0)).toBe('fuseki')
    expect([openingBook(1), openingBook(2), openingBook(null)]).toEqual(['joseki', 'joseki', 'joseki'])
  })
})

describe('a missing book', () => {
  it('reads as one plain sentence, not a JSON parse error, and is fetched again next time', async () => {
    const page = () => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))
    const f = vi.fn(page); vi.stubGlobal('fetch', f)
    const e = await loadJoseki('fuseki').catch(x => x)
    expect(failureText(e, en)).toBe(en.bookMissing)
    await loadJoseki('fuseki').catch(() => {})
    expect(f).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })
  it('a network or data error reads in your language, not the browser’s', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const e = await loadJoseki('fuseki').catch(x => x)
    expect(en.fFailed(failureText(e, en))).toBe('Couldn’t load the fuseki: the book can’t be read.')
    vi.unstubAllGlobals()
  })
})
