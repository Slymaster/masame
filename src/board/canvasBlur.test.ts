import { describe, expect, it } from 'vitest'
import { blurPlan, gaussBlur } from './canvasBlur'

describe('blurPlan', () => {
  it('works on a copy at most σ px per pixel, leaving the rest of σ to the CPU', () => {
    expect(blurPlan(1)).toEqual({ p: 1, s: 1 })
    expect(blurPlan(6.5).p).toBe(4)
    expect(blurPlan(24).p).toBe(16)
    for (const sg of [0.5, 1, 3.9, 4, 6.5, 13, 24, 40]) {
      const { p, s } = blurPlan(sg)
      expect(p).toBeLessThanOrEqual(Math.max(1, sg))
      expect(p * 2).toBeGreaterThan(sg) // the largest power of two allowed
      expect(s).toBeGreaterThanOrEqual(Math.min(sg, 0.85)) // enough left for a smooth upscale
      expect((s * p) ** 2 + (p * p - 1) / 4).toBeCloseTo(sg * sg, 6) // total variance is σ²
    }
  })
})

describe('gaussBlur', () => {
  const W = 41
  const dot = (rgba: number[]) => { const d = new Uint8ClampedArray(W * W * 4); d.set(rgba, (20 * W + 20) * 4); return d }

  it('spreads a line with a variance of σ² and keeps its weight', () => {
    const d = new Uint8ClampedArray(W * W * 4)
    for (let y = 0; y < W; y++) d[(y * W + 20) * 4 + 3] = 255
    gaussBlur(d, W, W, 3)
    let sum = 0, vx = 0
    for (let x = 0; x < W; x++) { const a = d[(20 * W + x) * 4 + 3]; sum += a; vx += a * (x - 20) ** 2 }
    expect(Math.abs(sum - 255)).toBeLessThan(6) // 8-bit rounding
    expect(Math.abs(vx / sum - 9)).toBeLessThan(0.5)
  })

  it('blurs in premultiplied alpha: a red dot on transparency fades as red, never toward black', () => {
    const d = dot([255, 0, 0, 255]); gaussBlur(d, W, W, 2)
    const o = (20 * W + 23) * 4
    expect(d[o + 3]).toBeGreaterThan(0)
    expect([d[o], d[o + 1], d[o + 2]]).toEqual([255, 0, 0])
  })

  it('leaves a flat opaque field flat away from the edges, and does nothing at σ 0', () => {
    const d = new Uint8ClampedArray(W * W * 4).fill(200); gaussBlur(d, W, W, 2)
    expect([...d.slice((20 * W + 20) * 4, (20 * W + 20) * 4 + 4)]).toEqual([200, 200, 200, 200])
    const e = dot([9, 9, 9, 99]), f = e.slice(); gaussBlur(e, W, W, 0)
    expect(e).toEqual(f)
  })
})
