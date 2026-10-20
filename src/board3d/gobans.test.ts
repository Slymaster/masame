import { describe, expect, it } from 'vitest'
import { GOBAN_SHAPES, groundY, legInset, isReadyShape, isReadyWood, KAYA, readyShapes, readyWoods, SHAPES, shapeOf, TABLE, WOOD_DATA, woodOf, WOODS } from './gobans'
import { dims } from './logic'

describe('goban shapes', () => {
  it("the table board is v0.5's: 6 cm, on the table", () => {
    expect(TABLE.thickness).toBe(60)
    expect(groundY(SHAPES.table)).toBe(-60)
    expect(shapeOf(undefined)).toBe(TABLE)
  })
  it('the legged and folding boards are ready, with sourced proportions (gobans.md)', () => {
    expect(readyShapes()).toEqual(['table', 'ashi', 'pliant'])
    const a = SHAPES.ashi, p = SHAPES.pliant
    expect(a.thickness).toBeGreaterThanOrEqual(85); expect(a.thickness).toBeLessThanOrEqual(220) // 3 to 7 sun
    expect(a.legs!.height).toBeGreaterThanOrEqual(90); expect(a.legs!.height).toBeLessThanOrEqual(130) // about 12 cm
    expect(p.thickness).toBeGreaterThanOrEqual(13); expect(p.thickness).toBeLessThanOrEqual(21) // 5 to 7 gō
    expect(p.fold!.gap).toBeGreaterThan(0); expect(p.fold!.gap).toBeLessThan(1)
  })
  for (const s of GOBAN_SHAPES) it(`${s}: the ground lies under the board, the legs stand on it inside the block's footprint`, () => {
    const d = SHAPES[s]
    expect(groundY(d)).toBeLessThanOrEqual(-d.thickness)
    const L = d.legs
    if (!L) return
    expect(L.profile[0][1]).toBe(0); expect(L.profile.at(-1)![1]).toBe(L.height)
    for (let i = 1; i < L.profile.length; i++) expect(L.profile[i][1]).toBeGreaterThanOrEqual(L.profile[i - 1][1])
    const r = Math.max(...L.profile.map(q => q[0])) * (1 + (L.depth ?? 0))
    for (const N of [9, 13, 19]) for (const c of [false, true]) {
      const { BW, BD } = dims(N, c), [ix, iz] = legInset(d, BW, BD)
      expect(ix).toBeGreaterThan(r); expect(iz).toBeGreaterThan(r) // nothing pokes past the block, so the bowls beside it stay clear
      expect(BW / 2 - ix).toBeGreaterThan(r); expect(BD / 2 - iz).toBeGreaterThan(r) // two legs never meet
    }
  })
  it('a pending shape is the table board', () => {
    expect(isReadyShape('table')).toBe(true)
    for (const s of GOBAN_SHAPES) if (!isReadyShape(s)) expect(SHAPES[s]).toBe(TABLE)
  })
})

describe('woods', () => {
  it('kaya is always ready and all defaults; a pending wood is kaya', () => {
    expect(isReadyWood('kaya')).toBe(true); expect(readyWoods()[0]).toBe('kaya')
    expect(woodOf('kaya')).toBe(KAYA); expect(woodOf(undefined)).toBe(KAYA)
    for (const w of WOODS) if (!isReadyWood(w)) expect(WOOD_DATA[w]).toBe(KAYA)
  })
})

describe('scenes stand on the ground', () => {
  // every décor's table or floor is ctx.board.groundY: a fixed table height would float or sink under another shape
  const files = import.meta.glob<string>(['./scenes/*.ts', '!./scenes/*.test.ts', '!./scenes/index.ts'], { query: '?raw', import: 'default', eager: true })
  it('finds the scenes', () => expect(Object.keys(files).length).toBeGreaterThan(5))
  for (const [f, src] of Object.entries(files)) it(f, () => {
    expect(src).not.toMatch(/\bBT\b/)
    expect(src).not.toMatch(/[[,(]\s*-60\s*[,)\]]/) // the old table top as a coordinate
  })
})
