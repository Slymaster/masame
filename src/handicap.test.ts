import { describe, expect, it } from 'vitest'
import { Game } from './game'
import { gtp } from './katago'
import { handicapStones, proposeHandicap, stepHandicap } from './handicap'
import { loadSgf, saveSgf } from './sgf'

const names = (size: number, n: number) => handicapStones(size, n).map(v => gtp(v, size))

describe('handicapStones', () => {
  it('follows GTP fixed placement on 19×19', () => {
    expect(names(19, 0)).toEqual([])
    expect(names(19, 2)).toEqual(['D4', 'Q16'])
    expect(names(19, 3)).toEqual(['D4', 'Q16', 'D16'])
    expect(names(19, 4)).toEqual(['D4', 'Q16', 'D16', 'Q4'])
    expect(names(19, 5)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'K10'])
    expect(names(19, 6)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10'])
    expect(names(19, 7)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K10'])
    expect(names(19, 8)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K4', 'K16'])
    expect(names(19, 9)).toEqual(['D4', 'Q16', 'D16', 'Q4', 'D10', 'Q10', 'K4', 'K16', 'K10'])
  })
  it('uses the 3-3 points below 13×13', () => {
    expect(names(13, 4)).toEqual(['D4', 'K10', 'D10', 'K4'])
    expect(names(9, 2)).toEqual(['C3', 'G7'])
    expect(names(9, 9)).toEqual(['C3', 'G7', 'C7', 'G3', 'C5', 'G5', 'E3', 'E7', 'E5'])
  })
})

describe('proposeHandicap', () => {
  it('scales the rank gap by board area', () => {
    expect(proposeHandicap('5k', '1d', 19)).toBe(5)
    expect(proposeHandicap('5k', '1d', 13)).toBe(2) // 5 × 169/361 = 2.3
    expect(proposeHandicap('5k', '1d', 9)).toBe(0) // 1.1: below 2
    expect(proposeHandicap('15k', '5d', 19)).toBe(9) // capped
    expect(proposeHandicap('1d', '5k', 19)).toBe(0) // a weaker bot: none
    expect(proposeHandicap('3k', '2k', 19)).toBe(0)
  })
  it('steps through 0, 2…9', () => {
    expect([stepHandicap(0, 1), stepHandicap(2, -1), stepHandicap(2, 1), stepHandicap(9, 1), stepHandicap(0, -1)]).toEqual([2, 0, 3, 9, 0])
  })
})

describe('a handicap game', () => {
  const g = new Game({ size: 19, komi: 0.5, setup: { black: handicapStones(19, 4), white: [] }, firstSign: -1 })
  g.root.data.HA = ['4']
  it('starts with the stones on the board, White to play', () => {
    expect(g.toPlay).toBe(-1)
    expect(g.board.get([3, 15])).toBe(1)
    expect(g.board.get([15, 3])).toBe(1)
    expect(g.info.komi).toBe(0.5)
    expect(g.play([16, 2])).toBe('ok')
    expect([g.board.get([16, 2]), g.toPlay]).toEqual([-1, 1])
  })
  it('survives an SGF round trip', () => {
    const text = saveSgf(g)
    expect(text).toMatch(/HA\[4\]/)
    expect(text).toMatch(/PL\[W\]/)
    expect(text).toMatch(/KM\[0.5\]/)
    const h = loadSgf(text)
    expect([h.info.komi, h.info.firstSign, h.info.setup.black.length, h.root.data.HA]).toEqual([0.5, -1, 4, ['4']])
    expect(h.moves.map(m => m.sign)).toEqual([-1])
    h.goTo(0)
    expect(h.toPlay).toBe(-1)
  })
})
