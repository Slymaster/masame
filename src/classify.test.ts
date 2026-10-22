import { describe, expect, it } from 'vitest'
import { Game, type Move, type Sign, type Vertex } from './game'
import { accuracy, classify, deepCandidates, ep, parseRank, sacrificed, sigma, tally, type Cand, type Facts, type Judged, type Pos } from './classify'

/** Alternating moves from Black; null = pass. */
const record = (vs: (Vertex | null)[]): Move[] => vs.map((vertex, i) => ({ sign: (i % 2 ? -1 : 1) as Sign, vertex }))
const row = (n: number): Vertex[] => Array.from({ length: n }, (_, i) => [i % 9, Math.floor(i / 9)] as Vertex)
const game = (vs: (Vertex | null)[], info = {}) => Game.fromRecord({ size: 9, ...info }, record(vs))
const PRO = { black: 10, white: 10 } // σ = 11 at u = 1
const S = 11
/** Black's lead that gives the mover (sign s) this EP at σ = 11, no handicap. */
const leadFor = (p: number, s: Sign = 1) => s * S / 1.702 * Math.log(p / (1 - p))
const cand = (v: Vertex | null, lead: number, o: Partial<Cand> = {}): Cand => ({ v, lead, visits: 100, prior: 0.1, ...o })
const P = (lead: number, cands: Cand[] = [], o: Partial<Pos> = {}): Pos => ({ lead, u: 1, cands, pv: [], ...o })
const OTHER: Vertex = [8, 8]

/** One Black move at A9 losing exactly `d` EP from 0.5, measured on the same search. */
function one(d: number) {
  const g = game([[0, 0]])
  return classify(g, [P(0, [cand(OTHER, 0), cand([0, 0], leadFor(0.5 - d))])], [], PRO, 1)[0]!
}

describe('ep and sigma', () => {
  it('is a logistic around 0.5', () => {
    expect(ep(0, 10)).toBe(0.5)
    expect(ep(5, 10) + ep(-5, 10)).toBeCloseTo(1)
    expect(ep(leadFor(0.8), S)).toBeCloseTo(0.8)
  })
  it('interpolates σ0 and σmin, clamps outside the table', () => {
    expect([-19, -9, -4, 1, 5, 10].map(l => sigma(l, 1))).toEqual([23, 18, 16.5, 14, 12.5, 11])
    expect([-19, -9, -4, 1, 5, 10].map(l => sigma(l, 0))).toEqual([6, 5, 4, 3, 2.5, 2])
    expect(sigma(20, 1)).toBe(11)
    expect(sigma(-30, 1)).toBe(23)
    expect(sigma(-14, 1)).toBe(20.5) // halfway between 20k and 10k
    expect(sigma(1, 0.25)).toBe(7)
    expect(sigma(-40, 0)).toBe(6)
    expect(sigma(3, 0)).toBe(2.75) // σmin interpolated between 1d and 5d
    expect(sigma(10, 0.01)).toBe(2) // settled board: σmin
  })
})

describe('parseRank', () => {
  it('reads kyu, dan, pro and titles', () => {
    expect(parseRank('12k?')).toBe(-11)
    expect(parseRank('25k')).toBe(-24)
    expect(parseRank('1k')).toBe(0)
    expect(parseRank('7d')).toBe(7)
    expect(parseRank('3p')).toBe(10)
    expect(parseRank('9 dan pro')).toBe(10)
    expect(parseRank('Meijin')).toBe(10)
    expect(parseRank('Honinbo')).toBe(10)
    expect(parseRank('5 kyu')).toBe(-4)
    expect(parseRank('')).toBeNull()
    expect(parseRank(null)).toBeNull()
    expect(parseRank(undefined)).toBeNull()
    expect(parseRank('?')).toBeNull()
  })
  it('reads CJK ranks and titles', () => {
    expect(parseRank('5段')).toBe(5)
    expect(parseRank('P9段')).toBe(10)
    expect(parseRank('5级')).toBe(-4)
    expect(parseRank('3단')).toBe(3)
    expect(parseRank('初段')).toBe(1)
    expect(parseRank('本因坊')).toBe(10)
    expect(parseRank('名人')).toBe(10)
    expect(parseRank('九段')).toBe(9)
    expect(parseRank('二段')).toBe(2)
    expect(parseRank('五級')).toBe(-4)
    expect(parseRank('十段')).toBe(10) // the title
    expect(parseRank('职业九段')).toBe(10)
  })
  it('reads pro only from a p next to the rank', () => {
    expect(parseRank('abc p1 3d')).toBe(3)
    expect(parseRank('9p')).toBe(10)
    expect(parseRank('3 pro')).toBe(10)
    expect(parseRank('p 9段')).toBe(10)
  })
})

describe('classify bands', () => {
  const e = 1e-4
  it.each([
    [0.005, 'best', 'excellent'], [0.02, 'excellent', 'good'], [0.05, 'good', 'inaccuracy'],
    [0.1, 'inaccuracy', 'mistake'], [0.2, 'mistake', 'blunder'],
  ])('ΔEP %s: just under → %s, just over → %s', (t, under, over) => {
    expect(one(t - e).cat).toBe(under)
    expect(one(t + e).cat).toBe(over)
  })
  it('fills loss, ΔEP, EP after, KataGo’s move and line', () => {
    const g = game([[0, 0]]), pv: Vertex[] = [OTHER, [1, 1]]
    const j = classify(g, [P(0, [cand(OTHER, 2), cand([0, 0], -3)], { pv })], [], PRO, 1)[0]!
    expect(j.loss).toBeCloseTo(5)
    expect(j.dEP).toBeCloseTo(ep(2, S) - ep(-3, S))
    expect(j.ep).toBeCloseTo(ep(-3, S))
    expect(j.best).toEqual(OTHER)
    expect(j.pv).toBe(pv)
  })
  it('measures from White’s side', () => {
    const g = game([[0, 0], [1, 1]])
    const j = classify(g, [P(0), P(0, [cand(OTHER, 0), cand([1, 1], leadFor(0.38, -1))])], [], PRO, 2)[1]!
    expect(j.cat).toBe('mistake')
    expect(j.dEP).toBeCloseTo(0.12)
    expect(j.loss).toBeGreaterThan(0)
  })
  it('the top move is best with no loss', () => {
    const j = classify(game([[0, 0]]), [P(0, [cand([0, 0], -9), cand(OTHER, -20)])], [], PRO, 1)[0]!
    expect(j).toMatchObject({ cat: 'best', loss: 0, dEP: 0, best: null })
    expect(j.ep).toBeCloseTo(ep(-9, S))
  })
  it('falls back to the next root without a candidate of ≥ 30 visits, else null', () => {
    const g = game([[0, 0]])
    const thin = [cand(OTHER, 0), cand([0, 0], 10, { visits: 29 })] // same-search value ignored
    expect(classify(g, [P(0, thin), P(leadFor(0.4))], [], PRO, 1)[0]!.dEP).toBeCloseTo(0.1)
    expect(classify(g, [P(0, [cand(OTHER, 0)]), P(leadFor(0.4))], [], PRO, 1)[0]!.cat).toBe('inaccuracy')
    expect(classify(g, [P(0, [cand(OTHER, 0)])], [], PRO, 1)[0]).toBeNull()
  })
  it('uses the mover’s level', () => {
    const g = game([[0, 0]]), pos = [P(0, [cand(OTHER, 0), cand([0, 0], -2)])]
    expect(classify(g, pos, [], PRO, 1)[0]!.cat).toBe('inaccuracy') // σ 11: −2 pts costs 0.077
    expect(classify(g, pos, [], { black: -19, white: 10 }, 1)[0]!.cat).toBe('good') // σ 23: 0.037
  })
})

describe('classify null rules', () => {
  it('skips unscanned positions, pseudo-moves, the game-ending pass and moves after two passes', () => {
    const moves: Move[] = [...record([[0, 0], [1, 1]]), { sign: -1, vertex: null, setup: true }, ...record([[2, 2], null, null, [3, 3]])]
    const g = Game.fromRecord({ size: 9 }, moves), pos = moves.map(() => P(0)).concat(P(0))
    const top = (i: number) => (pos[i] = P(0, [cand(moves[i].vertex, 0)]))
    moves.forEach((_, i) => top(i))
    pos[1] = undefined as unknown as Pos
    const j = classify(g, pos, [], PRO, moves.length)
    expect(j.map(x => (x ? x.cat : null))).toEqual(['best', null, null, 'best', 'best', null, null])
  })
  it('stops at end', () => {
    const g = game([[0, 0], [1, 1]])
    expect(classify(g, [P(0, [cand([0, 0], 0)]), P(0, [cand([1, 1], 0)])], [], PRO, 1)[1]).toBeNull()
  })
})

describe('miss', () => {
  // White's move 1 gives Black 0.5 → 0.8; Black's move 2 gives some back
  const g = game([[0, 0], [1, 1], [2, 2]])
  const run = (after: number) => classify(g, [
    P(0, [cand([0, 0], 0)]),
    P(0, [cand(OTHER, 0), cand([1, 1], leadFor(0.8))]),
    P(leadFor(0.8), [cand(OTHER, leadFor(0.8)), cand([2, 2], leadFor(after))]),
  ], [], PRO, 3)
  it('is a miss when the mover still ends no worse than before the gift (−0.02)', () => {
    expect(run(0.8)[1]!.cat).toBe('blunder') // White lost 0.3
    expect(run(0.49)[2]!.cat).toBe('miss')
    expect(run(0.69)[2]!.cat).toBe('miss') // lost 0.11
  })
  it('else the normal band, and not under 0.10 lost', () => {
    expect(run(0.47)[2]!.cat).toBe('blunder')
    expect(run(0.71)[2]!.cat).toBe('inaccuracy') // lost 0.09
    expect(run(0.76)[2]!.cat).toBe('good')
  })
  it('needs an opponent error of ≥ 0.15', () => {
    const at = (gift: number) => classify(g, [
      P(0, [cand([0, 0], 0)]),
      P(0, [cand(OTHER, 0), cand([1, 1], leadFor(0.5 + gift))]),
      P(leadFor(0.5 + gift), [cand(OTHER, leadFor(0.5 + gift)), cand([2, 2], leadFor(0.5 + gift - 0.12))]),
    ], [], PRO, 3)
    expect(at(0.14).map(j => j?.cat)).toEqual(['best', 'mistake', 'mistake'])
    expect(at(0.16).map(j => j?.cat)).toEqual(['best', 'mistake', 'miss'])
  })
})

describe('great and brilliant', () => {
  const g = game([[0, 0]]), A: Vertex = [0, 0]
  const great = (o: Partial<Pos> = {}, alt: Partial<Cand> = {}, prior = 0.4) =>
    classify(g, [P(0, [cand(A, 0, { prior }), cand(OTHER, leadFor(0.39), alt)], { deep: true, ...o })], [], PRO, 1)[0]!
  it('great: the only good move, deep, not obvious', () => {
    const j = great()
    expect(j.cat).toBe('great')
    expect(j.gap).toBeCloseTo(0.11)
    expect(great({}, { lead: leadFor(0.41) }).cat).toBe('best')
    expect(great({ deep: undefined }).cat).toBe('best')
    expect(great({}, {}, 0.8).cat).toBe('great')
    expect(great({}, {}, 0.81).cat).toBe('best')
    expect(great({}, { visits: 29 }).cat).toBe('great') // a starved alternative far behind is evidence too
    expect(great({}, { lead: leadFor(0.41), visits: 5 }).cat).toBe('best') // a close one blocks it, however few its visits
  })
  const bril = (sac: number, o: { before?: number; after?: number; prior?: number; deep?: true; book?: boolean; level?: number; u?: number } = {}) => {
    const after = leadFor(o.after ?? 0.5), before = leadFor(o.before ?? 0.5)
    const pos = [P(before, [cand(A, after, { prior: o.prior ?? 0.1 }), cand(OTHER, after - 1)], { deep: 'deep' in o ? o.deep : true, u: o.u ?? 1 })]
    return classify(g, pos, [{ sac, book: !!o.book }], { black: o.level ?? 10, white: 5 }, 1)[0]!.cat
  }
  it('brilliant: a deep sacrifice, hard to find, not already winning, not bad after', () => {
    expect(bril(2)).toBe('brilliant')
    expect(bril(1)).toBe('brilliant') // open board: one stone is enough
    expect(bril(1, { u: 0.35 })).toBe('brilliant')
    expect(bril(1, { u: 0.34 })).not.toBe('brilliant') // an endgame throw-in
    expect(bril(2, { u: 0.34 })).toBe('brilliant')
    expect(bril(1, { u: 0.34, level: -14 })).toBe('brilliant') // 15k: one stone is enough anywhere
    expect(bril(1, { u: 0.34, level: -13 })).not.toBe('brilliant')
    expect(bril(0)).not.toBe('brilliant')
    expect(bril(2, { before: 0.9, after: 0.9 })).toBe('brilliant')
    expect(bril(2, { before: 0.91, after: 0.91 })).not.toBe('brilliant')
    expect(bril(2, { after: 0.351, before: 0.351 })).toBe('brilliant')
    expect(bril(2, { after: 0.349, before: 0.349 })).not.toBe('brilliant')
    expect(bril(2, { prior: 0.3 })).toBe('brilliant')
    expect(bril(2, { prior: 0.31 })).not.toBe('brilliant')
    expect(bril(2, { deep: undefined })).toBe('best')
  })
  it('brilliant also for an excellent move, not a good one', () => {
    const at = (d: number) => classify(g, [P(0, [cand(OTHER, 0), cand(A, leadFor(0.5 - d))], { deep: true })], [{ sac: 3, book: false }], PRO, 1)[0]!.cat
    expect(at(0.019)).toBe('brilliant')
    expect(at(0.021)).toBe('good')
  })
  it('book wins over everything while it loses ≤ 0.05, else its normal band', () => {
    const book = (d: number) => classify(g, [P(0, [cand(OTHER, 0), cand(A, leadFor(0.5 - d))])], [{ sac: 0, book: true }], PRO, 1)[0]!.cat
    expect(bril(2, { book: true })).toBe('book')
    expect(book(0.05 - 1e-4)).toBe('book')
    expect(book(0.05 + 1e-4)).toBe('inaccuracy')
    expect(book(0.3)).toBe('blunder')
  })
})

describe('handicap baseline', () => {
  it('takes away the first lead, shrinking with u', () => {
    const vs = row(3), setup = { black: [[4, 4]] as Vertex[], white: [] }
    const pos = [P(10, [cand(vs[0], 10)]), P(10, [cand(vs[1], 10)], { u: 0.8 }), P(5, [cand(vs[2], 5)], { u: 0.5 })]
    const j = classify(game(vs, { setup }), pos, [], PRO, 3)
    expect(j[0]!.ep).toBeCloseTo(0.5)
    expect(j[2]!.ep).toBeCloseTo(0.5) // 5 − 10 · 0.5/1
    expect(j[1]!.ep).toBeCloseTo(1 - ep(10 - 8, sigma(10, 0.8)))
    // even game: no baseline
    expect(classify(game(vs), pos, [], PRO, 3)[0]!.ep).toBeCloseTo(ep(10, S))
  })
})

describe('sacrificed', () => {
  it('counts own stones going from alive-ish to dead, the played stone on the after test only', () => {
    const before = [[1, 1, 0], [0, -1, 0], [0, 0, 0]] as Sign[][]
    const after = [[1, 1, 1], [0, -1, 0], [0, 0, 0]] as Sign[][]
    const ob = [0, -0.5, 0, 0, -1, 0, 0, 0, 0], oa = [-0.6, -0.9, -0.7, 0, -1, 0, 0, 0, 0]
    expect(sacrificed(before, after, ob, oa, 1)).toBe(2) // A: 0 → −0.6, played C: −0.7; B was already dead
    expect(sacrificed(before, after, ob, oa.map((x, i) => (i === 0 ? -0.59 : x)), 1)).toBe(1)
    // White's view flips the signs
    expect(sacrificed(before, after, ob.map(x => -x), oa.map(x => -x), -1)).toBe(0)
    expect(sacrificed(before, after, [0, 0, 0, 0, 0.2, 0, 0, 0, 0], [0, 0, 0, 0, 0.6, 0, 0, 0, 0], -1)).toBe(1)
  })
})

describe('deepCandidates', () => {
  it('top moves with a big gap or a sacrifice, worst gap first, at most max', () => {
    const vs = row(5), g = game(vs)
    const pos = vs.map((v, i) => P(0, [cand(v, 0), cand(OTHER, leadFor([0.43, 0.3, 0.45, 0.5, 0.2][i], g.moves[i].sign))])).concat(P(0))
    pos[4].cands[0] = cand(OTHER, 0) // not the played move
    const facts: Facts[] = vs.map((_, i) => ({ sac: i === 3 ? 1 : 0, book: false }))
    expect(deepCandidates(g, pos, facts, PRO, 5)).toEqual([1, 0, 3])
    expect(deepCandidates(g, pos, facts, PRO, 5, 2)).toEqual([1, 0])
    expect(deepCandidates(g, pos, [], PRO, 5)).toEqual([1, 0])
  })
  it('puts moves that can still be Great or Brilliant first, keeping the others after', () => {
    const vs = row(3), g = game(vs)
    const pos = vs.map((v, i) => P(0, [cand(v, 0, { prior: [0.9, 0.4, 0.95][i] }), cand(OTHER, leadFor([0.2, 0.43, 0.3][i], g.moves[i].sign))])).concat(P(0))
    expect(deepCandidates(g, pos, [], PRO, 3)).toEqual([1, 0, 2])
    expect(deepCandidates(g, pos, [], PRO, 3, 1)).toEqual([1])
  })
  it('a sacrifice within EXCELLENT of the top move, hard to see, comes first', () => {
    const vs = row(2), g = game(vs)
    const at = (d: number, o: { prior?: number; sac?: number; u?: number } = {}) => {
      const pos = [
        P(0, [cand(vs[0], 0), cand(OTHER, leadFor(0.3))]), // top move with a big gap
        P(0, [cand(OTHER, 0), cand(vs[1], leadFor(0.5 - d, -1), { prior: o.prior ?? 0.2 })], { u: o.u ?? 1 }),
        P(0),
      ]
      return deepCandidates(g, pos, [{ sac: 0, book: false }, { sac: o.sac ?? 1, book: false }], PRO, 2)
    }
    expect(at(0.019)).toEqual([1, 0])
    expect(at(0.021)).toEqual([0])
    expect(at(0.019, { prior: 0.31 })).toEqual([0])
    expect(at(0.019, { sac: 0 })).toEqual([0])
    expect(at(0.005, { u: 0.34 })).toEqual([0]) // one stone in the endgame is no sacrifice
    expect(at(0.005, { u: 0.34, sac: 2 })).toEqual([1, 0])
  })
})

describe('accuracy and tally', () => {
  const g = game(row(12))
  const a = (d: number) => 103.1668 * Math.exp(-0.04354 * 100 * d) - 3.1669
  // reference-scale fields as if the mover's level were ACC_LEVEL; w = Black's Win%
  const J = (dEP: number, cat: Judged['cat'] = 'good', e = 0.5): Judged => ({ cat, loss: 0, dEP, ep: e, best: null, pv: [], acc: a(dEP), w: 100 * e })
  it('Lichess’s formula on a hand-computed game', () => {
    // all EP 0.5 → flat Win% series, every weight clamps to 0.5: weighted mean = plain mean
    const blk = [0, 0.1, 0, 0.2, 0], judged = g.moves.map((_, i) => (i % 2 ? J(0, 'best') : i < 10 ? J(blk[i / 2]) : J(0.5, 'book')))
    // 99.9999, 63.58, 40.02: mean 80.72, harmonic 70.70
    const mean = (3 * a(0) + a(0.1) + a(0.2)) / 5, harm = 5 / (3 / a(0) + 1 / a(0.1) + 1 / a(0.2))
    expect(accuracy(judged, g, 1)).toBeCloseTo((mean + harm) / 2, 6)
    expect(accuracy(judged, g, 1)).toBeCloseTo(75.71, 2)
    expect(accuracy(judged, g, -1)).toBeCloseTo(99.9999, 3)
  })
  it('weights volatile moves more', () => {
    // Black's 0.2 loss sits in the swing; EP after alternates so the window around it has a big stdev
    const judged = g.moves.map((_, i) => (i === 4 ? J(0.2, 'mistake', 0.1) : J(0, 'best', 0.5)))
    const flat = g.moves.map((_, i) => (i === 4 ? J(0.2, 'mistake', 0.5) : J(0, 'best', 0.5)))
    expect(accuracy(judged, g, 1)!).toBeLessThan(accuracy(flat, g, 1)!)
  })
  it('null under 5 judged non-book moves', () => {
    const judged = g.moves.map((_, i) => (i < 8 ? J(0) : null))
    expect(accuracy(judged, g, 1)).toBeNull()
    expect(accuracy(g.moves.map((_, i) => (i === 0 ? J(0, 'book') : J(0))), g, 1)).toBeCloseTo(99.9999, 3)
    expect(accuracy(g.moves.map((_, i) => (i < 2 ? J(0, 'book') : J(0))), g, 1)).toBeCloseTo(99.9999, 3)
    expect(accuracy(g.moves.map((_, i) => (i < 4 ? J(0, 'book') : J(0))), g, 1)).toBeNull()
  })
  it('is read on one scale (1d) for every player while categories stay at the mover’s level', () => {
    // a 15k Black gives 3 pts a move, a pro White 2.5: milder categories for Black, yet the lower accuracy
    const pos = g.moves.map((m, i) => P(0, [cand(OTHER, 0), cand(m.vertex, -m.sign * (i % 2 ? 2.5 : 3))])).concat(P(0))
    const judged = classify(g, pos, [], { black: -14, white: 10 }, 12)
    expect(judged[0]!.dEP).toBeLessThan(judged[1]!.dEP)
    expect(judged[0]!.acc).toBeCloseTo(a(0.5 - ep(-3, 14)))
    expect(judged[1]!.w).toBeCloseTo(100 * ep(2.5, 14)) // Black's Win% after White's move
    expect(accuracy(judged, g, 1)!).toBeLessThan(accuracy(judged, g, -1)!)
    // swapping the levels changes the categories, not the accuracy
    const swapped = classify(g, pos, [], { black: 10, white: -14 }, 12)
    expect(swapped[0]!.cat).not.toBe(judged[0]!.cat)
    expect(accuracy(swapped, g, 1)).toBeCloseTo(accuracy(judged, g, 1)!)
  })
  it('tally counts one side’s categories, every key present', () => {
    const judged = [J(0, 'best'), J(0, 'blunder'), J(0, 'best'), null, J(0, 'miss')]
    const t = tally(judged, g, 1)
    expect(t).toMatchObject({ best: 2, miss: 1, blunder: 0, brilliant: 0 })
    expect(Object.keys(t)).toHaveLength(10)
    expect(tally(judged, g, -1).blunder).toBe(1)
  })
})
