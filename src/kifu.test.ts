import { describe, expect, it } from 'vitest'
import { Game, type Vertex } from './game'
import { diagrams, kifuName } from './kifu'
import { loadSgf } from './sgf'

/** A legal game of n moves on 19×19: points in reading order, alternating colours. */
function long(n: number) {
  const g = new Game({ size: 19 })
  for (let i = 0; g.moveNumber() < n; i++) { const v: Vertex = [i % 19, Math.floor(i / 19)]; if (g.isLegal(v)) g.play(v) }
  return g
}

describe('kifu', () => {
  it('cuts the record per 100 moves', () => {
    const ds = diagrams(long(250))
    expect(ds).toHaveLength(3)
    expect(ds.map(d => [d.from, d.to])).toEqual([[1, 100], [101, 200], [201, 250]])
    expect(ds[0].numbers).toHaveLength(100)
    expect(ds[2].numbers).toHaveLength(50)
    // each diagram starts from the position before its first move
    const g = long(250)
    expect(diagrams(g)[1].start).toEqual(g.boards[100].signMap)
    expect(diagrams(g)[2].start).toEqual(g.boards[200].signMap)
    expect(diagrams(long(200))).toHaveLength(2)
    expect(diagrams(long(201))).toHaveLength(3)
  })

  it('a position without moves is one diagram', () => {
    const g = new Game({ size: 9, setup: { black: [[2, 2]], white: [] }, firstSign: -1 })
    const ds = diagrams(g)
    expect(ds).toHaveLength(1)
    expect(ds[0].numbers).toHaveLength(0)
    expect(ds[0].start[2][2]).toBe(1)
  })

  it('lists a move on an occupied point under the diagram, as books do', () => {
    // a ko: Black takes at 5, White retakes at 6, ... the points are played on again
    const g = loadSgf('(;SZ[9];B[cb];W[db];B[bc];W[ec];B[cd];W[dd];B[dc];W[cc];B[ee];W[dc])')
    const d = diagrams(g)[0]
    // 8 (W cc) takes Black 7 (dc); 10 (W dc) is played where 7 was
    expect(d.notes).toEqual([{ n: 10, at: '7' }])
    expect(d.numbers.map(x => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('letters a stone from before the diagram that is played on again, and notes passes', () => {
    // a pass is a note without a point
    const p = new Game({ size: 9 }); p.play([2, 2]); p.play(null)
    expect(diagrams(p)[0].notes).toEqual([{ n: 2, at: null }])
    // a pre-diagram stone captured then played on again gets a letter
    const s = loadSgf('(;SZ[9]AW[aa];B[ba];W[ee];B[ab];W[aa])') // Black 1, 3 take the setup stone at aa; White 4 plays there
    const d = diagrams(s)[0]
    expect(d.letters).toEqual([{ v: [0, 0], label: 'A' }])
    expect(d.notes).toEqual([{ n: 4, at: 'A' }])
  })

  it('names the PNG after the date and the players', () => {
    expect(kifuName('2026-10-14', 'Honinbō Shūsaku', 'Gennan Inseki')).toBe('masame-kifu-2026-10-14-Honinbō-Shūsaku-Gennan-Inseki.png')
    expect(kifuName('2026-10-14', 'a/b', '')).toBe('masame-kifu-2026-10-14-a-b.png')
  })
})
