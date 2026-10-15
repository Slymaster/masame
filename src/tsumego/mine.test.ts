import { describe, expect, it } from 'vitest'
import { isItem } from '../exercises/deck'
import type { Game, Sign, Vertex } from '../game'
import { today } from '../joseki/store'
import { loadSgf } from '../sgf'
import {
  admit, boxOf, canMine, chains, detect, emptyMined, ldKey, ldVerdict, loadMined, markDone, mineGame, PER_DAY, problemsAt, reached,
  samples, saveMined, statusOf,
} from './mine'

const N = 9
const empty = (n = N) => Array.from({ length: n }, () => Array<Sign | 0>(n).fill(0))
const own = (n: number, pts: Vertex[], v: number) => { const o = Array(n * n).fill(0); for (const [x, y] of pts) o[y * n + x] = v; return o }
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } }
const NOW = new Date(2026, 9, 14, 15).getTime(), DAY = 86_400_000

// a black chain of 3 on the second line, near the top-left corner
const B3: Vertex[] = [[1, 1], [2, 1], [3, 1]]
const board = (stones: [Vertex[], Sign][], n = N) => { const m = empty(n); for (const [vs, s] of stones) for (const [x, y] of vs) m[y][x] = s; return m }

describe('detection', () => {
  const m = board([[B3, 1]])
  it('finds a group that lives if its owner plays first and dies otherwise', () => {
    expect(detect(m, own(N, B3, 0.8), own(N, B3, -0.8))).toEqual([{ owner: 1, stones: expect.arrayContaining(B3), box: [0, 0, 5, 3] }])
  })
  it('ignores the alive, the dead, seki and the unclear', () => {
    expect(detect(m, own(N, B3, 0.9), own(N, B3, 0.7))).toEqual([]) // alive either way
    expect(detect(m, own(N, B3, -0.7), own(N, B3, -0.9))).toEqual([]) // dead either way
    expect(detect(m, own(N, B3, 0.05), own(N, B3, -0.1))).toEqual([]) // seki
    expect(detect(m, own(N, B3, 0.4), own(N, B3, -0.8))).toEqual([]) // not alive enough first
  })
  it('ignores chains under 3 stones', () => {
    const two: Vertex[] = [[1, 1], [2, 1]]
    expect(detect(board([[two, 1]]), own(N, two, 1), own(N, two, -1))).toEqual([])
  })
  it('ignores a whole-board fight (the chain and its margin over 11×11)', () => {
    const long: Vertex[] = Array.from({ length: 8 }, (_, i) => [5 + i, 9] as Vertex)
    expect(detect(board([[long, -1]], 19), own(19, long, 1), own(19, long, -1))).toEqual([]) // 8 wide + 2·2 = 12
    const ok = long.slice(0, 7)
    expect(detect(board([[ok, -1]], 19), own(19, ok, 1), own(19, ok, -1))).toHaveLength(1) // 7 + 4 = 11
  })
  it('keeps one problem per area: a capturing race is one problem', () => {
    const w4: Vertex[] = [[1, 2], [2, 2], [3, 2], [4, 2]]
    const m2 = board([[B3, 1], [w4, -1]])
    const ownB = own(N, [...B3, ...w4], 0.8), ownW = own(N, [...B3, ...w4], -0.8) // Black first: both black; White first: both white
    const found = detect(m2, ownB, ownW)
    expect(found).toHaveLength(1)
    expect(found[0].owner).toBe(-1) // the bigger chain
  })
  it('reads chains and boxes', () => {
    expect(chains(board([[B3, 1], [[[5, 5]], -1]])).map(c => c.stones.length).sort()).toEqual([1, 3])
    expect(boxOf([[0, 0], [0, 1]], 9)).toEqual([0, 0, 2, 3])
  })
})

describe('the status check and verdicts', () => {
  it('reads alive, dead, seki and unclear', () => {
    expect([0.9, -0.9, 0.1, -0.15, 0.35, -0.4].map(statusOf)).toEqual(['alive', 'dead', 'seki', 'seki', 'unclear', 'unclear'])
  })
  it('saving counts seki, killing needs dead', () => {
    expect([reached(true, 0.8), reached(true, 0), reached(true, -0.8), reached(false, -0.8), reached(false, 0), reached(false, 0.8)])
      .toEqual([true, true, false, true, false, false])
  })
  it('found, almost, missed', () => {
    expect([ldVerdict(true, 0.4), ldVerdict(true, 1), ldVerdict(true, 5), ldVerdict(false, 0)]).toEqual(['found', 'short', 'short', 'missed'])
  })
})

describe('a problem', () => {
  const m = board([[B3, 1]]), p = { signMap: m, size: N, komi: 6.5, n: 42, vs: 'Bob' }
  const b = { scoreLead: 8, pv: [[2, 0], [4, 1]] as Vertex[], ownership: own(N, B3, 0.8) }
  const w = { scoreLead: -4, pv: [[2, 2]] as Vertex[], ownership: own(N, B3, -0.8) }
  it('is the whole position, the side drawn at random: save or kill', () => {
    const [save] = problemsAt(p, b, w, NOW, () => 0.1), [kill] = problemsAt(p, b, w, NOW, () => 0.9)
    expect(save).toMatchObject({ kind: 'ld', sign: 1, b: 'bbcbdb', w: '', moves: '', better: 'caeb', best: 8, loss: 12, chain: expect.any(String), n: 42, vs: 'Bob' })
    expect(kill).toMatchObject({ sign: -1, better: 'cc', best: -4, loss: 12 })
    expect(isItem(save) && isItem(kill)).toBe(true)
    expect(ldKey(save)).toBe(ldKey(kill)) // position and chain
  })
  it('needs a local answer', () => {
    expect(problemsAt(p, { ...b, pv: [[8, 8]] }, w, NOW, () => 0.1)).toEqual([])
  })
})

describe('mining a game', () => {
  it('samples each moment and every 15 moves from move 30 to 20 from the end', () => {
    expect(samples([12, 50, 300], 100)).toEqual([12, 30, 45, 50, 60, 75])
    expect(samples([], 40)).toEqual([])
  })
  it('asks both sides at each position, confirms new candidates deeper and dedupes position + chain', async () => {
    // 30 moves away from the corner group, then passes: positions 30 and 45 are the same board
    const moves = Array.from({ length: 30 }, (_, i) => `;${i % 2 ? 'W' : 'B'}[${'abcdefghijklmnopqrs'[i % 19]}${'mnop'[Math.floor(i / 19)]}]`).join('')
      + Array.from({ length: 40 }, (_, i) => `;${i % 2 ? 'W' : 'B'}[]`).join('')
    const game = loadSgf(`(;SZ[19]KM[6.5]AB[bb][cb][db]${moves})`)
    const asked: string[] = []
    const ask = async (g: Game, deep: boolean) => {
      asked.push(`${g.toPlay}${deep ? 'd' : ''}`)
      return { scoreLead: 0, pv: [[2, 0]] as Vertex[], ownership: own(19, B3, g.toPlay === 1 ? 0.9 : -0.9) }
    }
    const xs = (await mineGame(game, [], game.moves.length, 'Bob', ask, () => true, NOW, () => 0.1))!
    // positions 30 and 45 (70 − 20 = 50): the second is the same board, nothing new to confirm
    expect(asked).toEqual(['1', '-1', '1d', '-1d', '1', '-1'])
    expect(xs.map(x => [x.chain, x.n, x.vs])).toEqual([[expect.any(String), 31, 'Bob']])
    // a status the deep pair no longer reads (−0.45 when the opponent plays first) is no problem
    const borderline = async (g: Game, deep: boolean) =>
      ({ scoreLead: 0, pv: [[2, 0]] as Vertex[], ownership: own(19, B3, g.toPlay === 1 ? 0.9 : deep ? -0.45 : -0.9) })
    expect(await mineGame(game, [], game.moves.length, 'Bob', borderline, () => true, NOW, () => 0.1)).toEqual([])
    // still read by the deep pair, but inside the stricter margin (−0.6): no problem either
    const close = async (g: Game, deep: boolean) =>
      ({ scoreLead: 0, pv: [[2, 0]] as Vertex[], ownership: own(19, B3, g.toPlay === 1 ? 0.9 : deep ? -0.6 : -0.9) })
    expect(await mineGame(game, [], game.moves.length, 'Bob', close, () => true, NOW, () => 0.1)).toEqual([])
    // found only by the deep pair: both reads must agree
    const late = async (g: Game, deep: boolean) =>
      ({ scoreLead: 0, pv: [[2, 0]] as Vertex[], ownership: own(19, B3, g.toPlay === 1 ? 0.9 : deep ? -0.9 : -0.3) })
    expect(await mineGame(game, [], game.moves.length, 'Bob', late, () => true, NOW, () => 0.1)).toEqual([])
  })
  it('stops when the engine is wanted elsewhere', async () => {
    const game = loadSgf(`(;SZ[19]${Array.from({ length: 60 }, (_, i) => `;${i % 2 ? 'W' : 'B'}[${'abcdefghijklmnopqrs'[i % 19]}${'cdefghijkl'[Math.floor(i / 19)]}]`).join('')})`)
    expect(await mineGame(game, [], 60, '', async () => ({ scoreLead: 0, pv: [], ownership: null }), () => false, NOW)).toBeNull()
  })
})

describe('the daily cap and the store', () => {
  const x = (i: number) => ({ kind: 'ld' as const, t: NOW, vs: '', size: 9, komi: 6.5, b: 'bbcbdb', w: `${'abcdefghi'[i]}h`, moves: '', sign: 1 as Sign, played: 'tt', loss: 10, best: 3, better: 'ca', punish: '', chain: 'bbcbdb', n: 40 })
  it('admits at most 5 new problems a day, the rest wait for the next days', () => {
    const r = admit(emptyMined(), [0, 1, 2, 3, 4, 5, 6].map(x), NOW)
    expect([r.add.length, r.m.made, r.m.wait.length, canMine(r.m, NOW)]).toEqual([PER_DAY, 5, 2, false])
    const again = admit(r.m, [x(7)], NOW + 1000)
    expect([again.add.length, again.m.wait.length]).toEqual([0, 3])
    const tomorrow = admit(again.m, [], NOW + DAY)
    expect([tomorrow.add.map(e => e.w), tomorrow.m.wait, tomorrow.m.made, tomorrow.m.day]).toEqual([['fh', 'gh', 'hh'], [], 3, today(NOW + DAY)])
    expect(canMine(tomorrow.m, NOW + DAY)).toBe(true)
  })
  it('keeps the mined games and the waiting problems', () => {
    const st = mem(), m = { ...markDone(markDone(emptyMined(), 'a'), 'a'), wait: [x(1), { bad: 1 }] } as never
    saveMined(m, st)
    expect(loadMined(st)).toMatchObject({ done: ['a'], wait: [x(1)] })
    st.setItem('masame.tsumego', '{oops')
    expect(loadMined(st)).toEqual(emptyMined())
  })
})
