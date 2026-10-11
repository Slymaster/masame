import { describe, expect, it } from 'vitest'
import { bowlHeap, contrast, dims, dropStones, Governor, gx, gz, jitter, lens, panFor, qualityLadder, RB, relax, RW, silhouette, TOD, todAt, type Placed } from './logic'
import { rng } from '../board/noise'

describe('dimensions', () => {
  it('matches a real 19×19 board and keeps the cell size on small boards', () => {
    expect(dims(19, false).BW).toBeCloseTo(424); expect(dims(19, false).BD).toBeCloseTo(454)
    expect(gx(19, 0)).toBeCloseTo(-198); expect(gz(19, 18)).toBeCloseTo(213.3)
    expect(gx(9, 8) - gx(9, 7)).toBeCloseTo(22)
    expect(dims(19, true).BW).toBeGreaterThan(dims(19, false).BW)
  })
})

describe('jitter + relaxation', () => {
  it('is stable per point and move, and within 1.5 mm', () => {
    const a = jitter(19, 3, 4, 10), b = jitter(19, 3, 4, 10)
    expect(a).toEqual(b)
    expect(Math.hypot(a.jx - gx(19, 3), a.jz - gz(19, 4))).toBeLessThanOrEqual(1.5)
  })

  it('leaves no two neighbours interpenetrating, even on a full board', () => {
    const N = 19, m = new Map<number, Placed>()
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const R = (x + y) % 2 ? RB : RW, j = jitter(N, x, y, y * N + x)
      m.set(y * N + x, { x, y, R, jx: j.jx, jz: j.jz, tx: 0, tz: 0 })
    }
    relax(m, N)
    let worst = Infinity
    for (const s of m.values()) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const o = m.get((s.y + dy) * N + s.x + dx)
      if (o && s.x + dx < N) worst = Math.min(worst, Math.hypot(o.tx - s.tx, o.tz - s.tz) - s.R - o.R)
    }
    expect(worst).toBeGreaterThan(-0.15) // a packed full board may keep ~0.1 mm contacts: sub-pixel even in close-up
    for (const s of m.values()) expect(Math.hypot(s.tx - s.jx, s.tz - s.jz)).toBeLessThan(3) // nudged, never off its point
  })
})

describe('stones in a bowl', () => {
  it('heaps a bowl and a lid without two stones interpenetrating', () => {
    const r = rng(7)
    for (const [pts, R] of [[bowlHeap(RB, 40, 8, r), RB], [Array.from({ length: 60 }, (_, k) => [Math.cos(k * 2.4) * 13 * Math.sqrt(k % 8), Math.sin(k * 2.4) * 13 * Math.sqrt(k % 8)]), RW]] as const) {
      const st = dropStones(pts as number[][], R, d => 50 + 0.05 * d, r)
      expect(st.length).toBeGreaterThan(14)
      for (let i = 0; i < st.length; i++) for (let j = 0; j < i; j++) {
        const a = st[i], b = st[j], d = Math.hypot(a.x - b.x, a.z - b.z)
        if (d < 2 * R) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(2 * lens(d / 2, R) - 1e-9)
      }
      expect(Math.max(...st.map(s => s.y))).toBeGreaterThan(55) // some stones rest on others
    }
  })
})

describe('time of day', () => {
  it('follows the hour, with the presets at their anchor hours', () => {
    expect(todAt(10)).toEqual(TOD.morning)
    expect(todAt(15)).toEqual(TOD.afternoon)
    expect(todAt(22)).toEqual(TOD.evening)
    expect(todAt(3)).toEqual(TOD.evening)
    const t = todAt(12.75).K
    expect(t).toBeLessThan(TOD.morning.K); expect(t).toBeGreaterThan(TOD.afternoon.K)
  })
})

describe('governor', () => {
  it('steps down after a slow window and asks for the 2D fallback only at the bottom', () => {
    const levels = qualityLadder(2).length, g = new Governor(levels, 10)
    for (let i = 0; i < 10; i++) expect(g.sample(16.7)).toBeNull() // 60 fps: stays
    expect(g.level).toBe(0)
    const decisions: (string | null)[] = []
    for (let w = 0; w < levels + 1; w++) for (let i = 0; i < 10; i++) decisions.push(g.sample(40))
    expect(decisions.filter(d => d === 'down')).toHaveLength(levels - 1)
    expect(decisions.at(-1)).toBe('fallback')
  })

  it('ignores hidden-tab gaps and moderate slowness at the bottom', () => {
    const g = new Governor(2, 5)
    for (let i = 0; i < 20; i++) expect(g.sample(500)).toBeNull()
    g.level = 1
    for (let i = 0; i < 5; i++) expect(g.sample(25)).toBeNull() // 40 fps on the lowest level is acceptable
  })

  it('caps the pixel ratio and degrades monotonically', () => {
    const l = qualityLadder(3)
    expect(l[0].dpr).toBe(2)
    for (let i = 1; i < l.length; i++) {
      expect(l[i].dpr).toBeLessThanOrEqual(l[i - 1].dpr)
      expect(l[i].shadow).toBeLessThanOrEqual(l[i - 1].shadow)
    }
    expect(l.at(-1)).toMatchObject({ dpr: 1, shadow: 1024, msaa: 0 })
  })
})

describe('readability + sound', () => {
  it('computes WCAG contrast', () => {
    expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21)
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 1)
  })
  it('finds the weakest direction around a stone, counting only edges darker than the board', () => {
    const wood = [200, 150, 90], dark = [70, 45, 25], white = [245, 243, 238]
    expect(silhouette([[white, dark]], wood)).toBeGreaterThan(3)
    expect(silhouette([[white, dark], [white, [150, 110, 70]]], wood)).toBeLessThan(2)
    expect(silhouette([[white]], wood)).toBe(1)
  })
  it('pans by column', () => {
    expect(panFor(19, 0)).toBeCloseTo(-0.55); expect(panFor(19, 9)).toBeCloseTo(0); expect(panFor(9, 8)).toBeCloseTo(0.55)
  })
})
