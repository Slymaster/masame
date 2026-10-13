import { describe, expect, it } from 'vitest'
import { rng } from '../board/noise'
import { reach, validate, type JosekiDb } from './db'
import fixture from './fixture.json'
import { DAY, review } from './fsrs'
import {
  accepted, answer, EXPLORE, grade, isCard, nextCard, node, pathTo, position, programme, reply, sample, shown, shownAt, startLine,
  storedAt, walk, type Line, type Orient,
} from './practice'
import { positionKey, sym } from './sym'

const db = validate(structuredClone(fixture) as unknown as JosekiDb), R = reach(db), P = 2 // 10k
const ORIENTS: Orient[] = [0, 1, 2, 3, 4, 5, 6, 7].flatMap(k => [{ k, swap: false }, { k, swap: true }])
const paths = db.nodes.map((_, i) => pathTo(db, R, P, i))
const now = Date.UTC(2026, 9, 13)

describe('walking the tree', () => {
  it('reaches every node, mirrored edges included, as a direct replay of the shown moves', () => {
    expect(db.nodes.some(x => x.e.some(e => e[5] === 1))).toBe(true)
    paths.forEach((p, i) => {
      const w = walk(db, p)
      expect(node(w)).toBe(i)
      const b = position(shown(w.moves, { k: 0, swap: false }))
      expect(positionKey(b.signMap, w.moves.length)).toBe(db.nodes[i].k)
      for (const o of ORIENTS) { // the same stones, turned and recoloured
        const s = position(shown(w.moves, o)).signMap
        b.signMap.forEach((row, y) => row.forEach((c, x) => { const [a, z] = sym(o.k, [x, y]); expect(s[z][a]).toBe(o.swap ? -c || 0 : c) }))
      }
    })
  })
  it('maps a click back to the stored move in all 8 symmetries, colours swapped or not', () => {
    for (const p of paths.slice(0, 40)) {
      const w = walk(db, p), x = db.nodes[node(w)]
      for (const o of ORIENTS) for (const e of x.e) {
        const v = shownAt(w, o, e[0])
        expect(storedAt(w, o, v)).toBe(e[0])
        const b = position(shown(w.moves, o))
        expect(b.get(v)).toBe(0)
        const next = walk(db, { ...p, picks: [...p.picks, x.e.indexOf(e)] })
        expect(position(shown(next.moves, o)).get(v)).toBe(shown(next.moves, o).at(-1)!.sign)
      }
    }
  })
})

describe('practice', () => {
  it('grades by points lost', () => {
    expect([0, 0.5, 0.6, 1, 1.1, undefined].map(grade)).toEqual([3, 3, 2, 2, 1, 1])
  })
  it('makes cards of positions with one to three right answers, and grades answers there', () => {
    const cards = db.nodes.map((_, i) => i).filter(i => isCard(db, i))
    expect(cards.length).toBeGreaterThan(5)
    const n = cards.find(i => db.nodes[i].e.some(e => e[2] > 10 && !e[5]))!
    for (const o of ORIENTS) {
      const l = startLine(db, paths[n], o), w = walk(db, l.path), x = db.nodes[n]
      expect(l.phase).toBe('ask')
      const good = answer(db, l, shownAt(w, o, x.e[accepted(db, n)[0]][0]))
      expect(good.last).toEqual({ rating: grade(x.e[accepted(db, n)[0]][2] / 10), card: x.k })
      expect(['reply', 'end']).toContain(good.phase)
      const bad = answer(db, l, shownAt(w, o, x.e.find(e => e[2] > 10)![0]))
      expect(bad).toMatchObject({ phase: 'wrong', last: { rating: 1 } })
      expect(bad.more.length).toBeGreaterThan(0) // the punishment to replay
      expect(answer(db, l, [0, 0]).last!.rating).toBe(1) // off the tree
    }
  })
  it('lets the opponent play only the node’s moves, at about their frequency', () => {
    const n = db.nodes.findIndex(x => x.e.filter(e => e[3][P] > 0).length >= 3), e = db.nodes[n].e
    const r = rng(42), hits = e.map(() => 0)
    for (let i = 0; i < 1000; i++) hits[sample(db, n, P, r)]++
    const tot = e.reduce((a, x) => a + x[3][P], 0)
    e.forEach((x, i) => expect(Math.abs(hits[i] / 1000 - x[3][P] / tot)).toBeLessThan(0.05))
    expect(hits.reduce((a, b) => a + b)).toBe(1000)
  })
  it('asks to punish when the opponent goes off-book', () => {
    // a learner answer, then an opponent move that loses more than a point
    const at = db.nodes.findIndex((x, i) => isCard(db, i) && accepted(db, i).some(j => db.nodes[x.e[j][1]].e.some(e => e[2] > 10 && e[3][P] > 0)))
    const j = accepted(db, at).find(j => db.nodes[db.nodes[at].e[j][1]].e.some(e => e[2] > 10 && e[3][P] > 0))!
    const l = startLine(db, paths[at], EXPLORE), w = walk(db, l.path)
    const mid = answer(db, l, shownAt(w, EXPLORE, db.nodes[at].e[j][0]))
    expect(mid.phase).toBe('reply')
    const opp = db.nodes[node(walk(db, mid.path))].e, k = opp.findIndex(e => e[2] > 10 && e[3][P] > 0)
    const tot = opp.reduce((a, x) => a + x[3][P], 0), before = opp.slice(0, k).reduce((a, x) => a + x[3][P], 0)
    const after = reply(db, mid, P, () => (before + 0.5) / tot)
    expect(after.path.picks.at(-1)).toBe(k)
    expect(after.dev).toBe(opp[k][2] / 10)
    expect(after.phase).toBe('ask')
    // the punishment is KataGo's reply where the tree stops, else the tree's own best answer
    const w2 = walk(db, after.path), x2 = db.nodes[node(w2)]
    const right = x2.e.length ? x2.e[0][0] : x2.pv!.slice(0, 2)
    expect(answer(db, after, shownAt(w2, EXPLORE, right)).last!.rating).toBe(3)
  })
  it('ends a line after 8 answers at most', () => {
    let l: Line = startLine(db, { root: 0, picks: [] }, EXPLORE)
    const r = rng(7)
    while (l.phase === 'ask' || l.phase === 'reply') {
      if (l.phase === 'reply') { l = reply(db, l, P, r); continue }
      const w = walk(db, l.path), x = db.nodes[node(w)]
      l = answer(db, l, shownAt(w, EXPLORE, x.e.length ? x.e[0][0] : x.pv!.slice(0, 2)))
    }
    expect(l.answers).toBeLessThanOrEqual(8)
    expect(l.phase).toBe('end')
  })
  it('serves due cards before new ones, and at most 10 new cards a day', () => {
    const first = nextCard(db, R, P, {}, 0, now)!
    expect(isCard(db, first)).toBe(true)
    const all = db.nodes.map((_, i) => i).filter(i => isCard(db, i))
    expect(Math.max(...all.map(i => R[i][P]))).toBe(R[first][P]) // most common first
    const other = all.find(i => i !== first)!
    const cards = { [db.nodes[other].k]: { ...review(undefined, 3, now - 5 * DAY) } }
    expect(nextCard(db, R, P, cards, 0, now)).toBe(other)
    expect(nextCard(db, R, P, {}, 10, now)).toBeNull()
    expect(nextCard(db, R, P, cards, 10, now)).toBe(other)
  })
})

describe('programme', () => {
  it('ranks first approaches by reach × expected loss', () => {
    const f = programme(db, R, P)
    expect(f.length).toBeGreaterThan(2)
    for (let i = 1; i < f.length; i++) expect(f[i - 1].score).toBeGreaterThanOrEqual(f[i].score)
    expect(new Set(f.map(x => db.nodes[db.roots[x.root].node].e[x.pick][1])).size).toBe(f.length) // mirror twins once
  })
})
