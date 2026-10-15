import { describe, expect, it } from 'vitest'
import { Game } from '../game'
import { loadSgf } from '../sgf'
import index from '../../public/assets/classics/index.json'

const files = import.meta.glob('../../public/assets/classics/*.sgf', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const sgfOf = (file: string) => files[`../../public/assets/classics/${file}`]

describe('the classics', () => {
  it('lists every shipped file once, and nothing else', () => {
    expect(index.map(g => g.file).sort()).toEqual(Object.keys(files).map(f => f.split('/').pop()).sort())
    expect(new Set(index.map(g => g.id)).size).toBe(index.length)
  })

  it('holds no game twice', () => {
    const lines = index.map(g => loadSgf(sgfOf(g.file)).moves.map(m => m.vertex?.join(',')).join(' '))
    expect(new Set(lines).size).toBe(index.length)
  })

  for (const g of index) {
    it(`${g.id}: loads, stays on a 19×19 board and replays legally`, () => {
      const rec = loadSgf(sgfOf(g.file))
      expect(rec.info.size).toBe(19)
      expect(rec.info.komi).toBe(0)
      const moves = rec.moves.filter(m => !m.setup)
      expect(moves.length).toBe(g.moves)
      // replay through the rules: Game.play refuses occupied points, suicide and ko
      const replay = new Game({ ...rec.info, result: undefined })
      for (const m of moves) {
        expect(m.vertex).not.toBeNull()
        expect(m.vertex!.every(c => c >= 0 && c < 19)).toBe(true)
        expect(replay.toPlay).toBe(m.sign)
        expect(replay.play(m.vertex)).toBe('ok')
      }
    })

    it(`${g.id}: is from the Edo period and fully described`, () => {
      expect(Number(g.date.slice(0, 4))).toBeLessThan(1868)
      expect(Number(g.date.slice(0, 4))).toBeGreaterThanOrEqual(1603)
      expect(g.result).toMatch(/^[BW]\+(R|\d+)$/)
      expect(loadSgf(sgfOf(g.file)).info.result).toBe(g.result)
      for (const s of [g.black, g.white, g.title.fr, g.title.en, g.context.fr, g.context.en]) expect(s.length).toBeGreaterThan(0)
      // French typography: no plain space before high punctuation
      expect(g.title.fr + g.context.fr).not.toMatch(/ [;:?!»]|« /)
    })
  }
})
