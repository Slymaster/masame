import { describe, expect, it, vi } from 'vitest'
vi.mock('../library', () => ({})) // yose.ts reads the library only in libraryGames
import { gapOf, verdictOf } from '../exercises/deck'
import type { Game, Vertex } from '../game'
import type { Analysis } from '../katago'
import { loadSgf } from '../sgf'
import { findYose, YOSE_N, yoseOf, yoseSamples } from './yose'

// 9×9: Black fills rows 1–3 from the top, White rows 9–7 from the bottom (no capture); moves 35+ are the endgame on 9×9
const L = 'abcdefghi'
const moves = Array.from({ length: 50 }, (_, i) => {
  const k = i >> 1, x = L[k % 9], y = i % 2 ? L[8 - Math.floor(k / 9)] : L[Math.floor(k / 9)]
  return `;${i % 2 ? 'W' : 'B'}[${x}${y}]`
}).join('')
const game = loadSgf(`(;SZ[9]KM[6.5]${moves})`)
const NOW = 1_000
const an = (leads: [Vertex | null, number][]): Analysis => ({
  winrate: 0.5, scoreLead: leads[0][1], topMove: '', pv: leads.slice(0, 1).map(l => l[0]), ownership: null, humanPolicy: null,
  moves: leads.map(([v, scoreLead]) => ({ v, scoreLead, visits: 10 })),
})

describe('yose positions', () => {
  it('are endgame positions, one every 7 moves, so both sides are asked', () => {
    expect(yoseSamples(game)).toEqual([34, 41, 48])
    expect(yoseSamples(game).map(i => game.moves[i].sign)).toEqual([1, -1, 1])
  })
  it('are kept when the biggest move beats the second by 2 points or more, for the side to play', () => {
    const x = yoseOf(game, 34, an([[[4, 4], 5], [[4, 5], 2.5]]), 'Bob', NOW)!
    expect(x).toMatchObject({ kind: 'yose', sign: 1, played: 'ef', loss: 2.5, best: 5, better: 'ee', moves: '', n: 35, vs: 'Bob' })
    expect(yoseOf(game, 35, an([[[4, 4], -5], [[4, 5], -2]]), '', NOW)).toMatchObject({ sign: -1, loss: 3 })
    expect(yoseOf(game, 34, an([[[4, 4], 5], [[4, 5], 3.5]]), '', NOW)).toBeNull() // too close
    expect(yoseOf(game, 34, an([[[4, 4], 30], [[4, 5], 5]]), '', NOW)).toBeNull() // 25 points: a group's life, not endgame
    expect(yoseOf(game, 34, an([[null, 5], [[4, 5], 0]]), '', NOW)).toBeNull() // a pass is no question
    expect(yoseOf(game, 34, an([[[4, 4], 5]]), '', NOW)).toBeNull() // no second move read
  })
  it('are graded like the exercises: the biggest found, the second missed', () => {
    const x = yoseOf(game, 34, an([[[4, 4], 5], [[4, 5], 1]]), '', NOW)!
    expect(verdictOf(x, gapOf(x, [4, 4], null)!)).toBe('found')
    expect(verdictOf(x, gapOf(x, [4, 5], null)!)).toBe('missed')
    expect(verdictOf(x, gapOf(x, [0, 4], 3)!)).toBe('short') // 2 points from the best, 2 better than the second
  })
  it('are searched until 8 are kept, with progress, and stop when cancelled', async () => {
    const games = Array.from({ length: 5 }, () => ({ game, vs: '' }))
    let asks = 0
    const ask = async (g: Game) => { const s = g.toPlay; return ++asks % 2 ? an([[[4, 4], 6 * s], [[4, 5], s]]) : an([[[4, 4], 6 * s], [[4, 5], 5 * s]]) }
    const seen: number[] = []
    const xs = await findYose(games, ask, () => true, n => seen.push(n), NOW, () => 0.5)
    expect([xs.length, asks, seen]).toEqual([YOSE_N, 15, [1, 2, 3, 4, 5, 6, 7, 8]])
    expect(new Set(xs.map(x => x.sign))).toEqual(new Set([1, -1]))
    expect(await findYose(games, ask, () => false, () => {}, NOW)).toEqual([])
  })
})
