import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { lens } from './logic'
import { STONE_SETS } from './stoneSets'
import { dimOf, ghostOf, pendingOf, STONES, stoneGeo } from './stones'

const hex = (c: THREE.Color) => c.getHex()
const hc = { value: 0 }

describe('stone sets', () => {
  it('has one row per set, with real-world sizes, both materials and a 2D palette', () => {
    expect(Object.keys(STONES).sort()).toEqual([...STONE_SETS].sort())
    for (const [name, s] of Object.entries(STONES)) {
      for (const r of [s.rB, s.rW]) { expect(r, name).toBeGreaterThanOrEqual(10.6); expect(r, name).toBeLessThanOrEqual(11.3) }
      expect(s.sh, name).toBeGreaterThanOrEqual(3.8); expect(s.sh, name).toBeLessThanOrEqual(5.5)
      expect(s.lensExp, name).toBeGreaterThan(0); expect(s.lensExp, name).toBeLessThanOrEqual(1.5)
      for (const m of [s.black({ hc, R: s.rB }), s.white({ hc, R: s.rW })]) {
        expect(m).toBeInstanceOf(THREE.MeshPhysicalMaterial)
        expect(m.onBeforeCompile, name).toBeTypeOf('function')
        expect(m.customProgramCacheKey(), name).not.toBe('') // one program per set and colour
      }
      expect(s.skin2d.black.length, name).toBeGreaterThan(1); expect(s.skin2d.white.length, name).toBeGreaterThan(1)
      for (const v of Object.values(s.snd)) expect(v, name).toBeGreaterThan(0)
    }
  })

  it('keeps the Japanese set exactly as in v0.5', () => {
    const j = STONES.japonaise
    expect([j.rB, j.rW, j.sh, j.lensExp]).toEqual([11.1, 10.95, 4.5, 0.78])
    expect(j.snd).toEqual({ rate: 1, lowpass: 1, gain: 1 })
  })
})

describe('lens', () => {
  it('is the half thickness at the axis, zero at the girdle and beyond, and follows its exponent', () => {
    expect(lens(0, 11, 4.5, 0.78)).toBe(4.5)
    expect(lens(11, 11, 4.5, 0.78)).toBe(0)
    expect(lens(12, 11, 4.5, 0.78)).toBe(0)
    expect(lens(5, 11, 4.5, 0.78)).toBeCloseTo(4.5 * Math.pow(1 - (5 / 11) ** 2, 0.78), 12)
    // a smaller exponent makes a fuller, more domed stone
    expect(lens(8, 11, 4.5, 0.5)).toBeGreaterThan(lens(8, 11, 4.5, 0.78))
    for (let r = 0; r < 11; r += 0.5) expect(lens(r + 0.5, 11, 4.5, 0.78)).toBeLessThanOrEqual(lens(r, 11, 4.5, 0.78))
  })

  it('shapes the stone geometry: its height is 2·sh, its width 2·R', () => {
    const g = stoneGeo(11.1, STONES.japonaise)
    g.computeBoundingBox()
    const b = g.boundingBox!
    expect(b.max.y - b.min.y).toBeCloseTo(9, 6)
    expect(b.max.x - b.min.x).toBeCloseTo(22.2, 2)
  })
})

describe('derived materials', () => {
  const j = STONES.japonaise, slate = j.black({ hc, R: j.rB }), shell = j.white({ hc, R: j.rW })

  it('dims the Japanese stones to exactly v0.5 dying stones', () => {
    const b = dimOf(slate), w = dimOf(shell)
    expect(hex(b.color)).toBe(0x5a5a60); expect(Math.fround(b.roughness)).toBe(Math.fround(0.6))
    expect(hex(w.color)).toBe(0xb4b0a8); expect(Math.fround(w.roughness)).toBe(Math.fround(0.5)); expect(w.sheen).toBe(0)
  })

  it('keeps the stone shader, and fades any colour towards grey without inverting it', () => {
    const d = dimOf(slate)
    expect(d.onBeforeCompile).toBe(slate.onBeforeCompile)
    expect(d.customProgramCacheKey()).toBe(slate.customProgramCacheKey())
    const lum = (c: THREE.Color) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722
    for (const c of [0x000000, 0x0c3020, 0xf0f0e8, 0xffffff]) {
      const m = slate.clone(); m.color.setHex(c)
      const o = dimOf(m)
      expect(o.roughness).toBeGreaterThanOrEqual(m.roughness)
      if (c < 0x808080) expect(lum(o.color)).toBeGreaterThan(lum(m.color)); else expect(lum(o.color)).toBeLessThan(lum(m.color))
    }
    expect(lum(dimOf(slate).color)).toBeLessThan(lum(dimOf(shell).color)) // dead black stays darker than dead white
  })

  it('derives the hover ghost and the stopped stone as in v0.5', () => {
    expect(hex(ghostOf(slate, 1).color)).toBe(0x18181b); expect(hex(ghostOf(shell, -1).color)).toBe(0xf4efe4)
    expect(Math.fround(ghostOf(slate, 1).roughness)).toBe(Math.fround(0.45)); expect(Math.fround(ghostOf(shell, -1).roughness)).toBe(Math.fround(0.35))
    expect([ghostOf(slate, 1).opacity, ghostOf(shell, -1).opacity]).toEqual([0.5, 0.6])
    const p = pendingOf(shell, -1)
    expect([hex(p.color), p.roughness, p.clearcoat, p.opacity]).toEqual([0xfdfbf6, 0.3, 0.5, 0.78])
  })
})
