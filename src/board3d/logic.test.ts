declare const process: { env: Record<string, string> } // node's, without its types
process.env.TZ = 'Europe/Paris' // the seasons' tests read local clock times, DST included
import { describe, expect, it } from 'vitest'
import { skipPinchWheel, bowlHeap, cardSkin, clampOrbit, contrast, dims, DROP_MS, dropPose, dropStones, fit, FIT_REACH, FOV, Governor, gx, gz, HOME, JIT_ACROSS, JIT_ALONG, jitter, lens, LOOKS, orbitEye, panBy, panFor, pickPoint, qualityLadder, seatHeight, settle, SX, SZ, silhouette, SLIDE_MS, stepOrbit, TOD, todAt, seasonTod, snowOn, sunOn, wheelIntent, worstGap, zoomAt, type Orbit, type Placed } from './logic'
import { STONES } from './stones'

const J = STONES.japonaise, RB = J.rB, RW = J.rW, SH = J.shTop
import { DECORS } from './decors'
import { rng } from '../board/noise'

describe('dimensions', () => {
  it('matches a real 19×19 board and keeps the cell size on small boards', () => {
    expect(dims(19, false).BW).toBeCloseTo(424); expect(dims(19, false).BD).toBeCloseTo(454)
    expect(gx(19, 0)).toBeCloseTo(-198); expect(gz(19, 18)).toBeCloseTo(213.3)
    expect(gx(9, 8) - gx(9, 7)).toBeCloseTo(22)
    expect(dims(19, true).BW).toBeGreaterThan(dims(19, false).BW)
  })
})

describe('jitter + fitting', () => {
  it('is stable per point and move, within its amplitudes and never dead centre', () => {
    expect(jitter(19, 3, 4, 10)).toEqual(jitter(19, 3, 4, 10))
    for (let k = 0; k < 2000; k++) {
      const x = k % 19, y = (k * 7) % 19, j = jitter(19, x, y, k), dx = j.jx - gx(19, x), dz = j.jz - gz(19, y)
      expect(Math.abs(dx)).toBeLessThanOrEqual(JIT_ACROSS); expect(Math.abs(dz)).toBeLessThanOrEqual(JIT_ALONG)
      expect(Math.hypot(dx / JIT_ACROSS, dz / JIT_ALONG)).toBeGreaterThanOrEqual(0.4 - 1e-9)
    }
    expect([JIT_ACROSS, JIT_ALONG]).toEqual([0.8, 2.2])
  })

  // A full board filled in a random order: 3D (real spacing, slate and shell radii, default jitter) or the 2D view's
  // square 22 mm cells (R 0.482 cell, 1.2 mm both ways). Returns the worst gap (8 neighbours), the largest distance from a
  // grid point, and whether a stone already down ever moved.
  const fill = (N: number, seed: number, flat: boolean) => {
    const r = rng(seed), order = Array.from({ length: N * N }, (_, i) => i), m = new Map<number, Placed>()
    for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); [order[i], order[k]] = [order[k], order[i]] }
    let nudge = 0, moved = false
    order.forEach((p, k) => {
      const x = p % N, y = (p / N) | 0, cx = flat ? x * 22 : gx(N, x), cz = flat ? y * 22 : gz(N, y)
      const j = flat ? jitter(N, x, y, k, 1.2, 1.2) : jitter(N, x, y, k), R = flat ? 0.482 * 22 : r() < 0.5 ? RB : RW
      const s: Placed = { x, y, R, jx: cx + j.jx - gx(N, x), jz: cz + j.jz - gz(N, y), tx: 0, tz: 0 }
      const o = m.get(order[k - 1]), was = o && [o.tx, o.tz]
      m.set(p, s)
      if (flat) settle(s, m, N, cx, cz, 22, 22); else settle(s, m, N, cx, cz)
      if (o && (o.tx !== was![0] || o.tz !== was![1])) moved = true
      nudge = Math.max(nudge, Math.hypot(s.tx - cx, s.tz - cz))
    })
    return { worst: Math.min(...[...m.values()].map(s => worstGap(s, m, N))), nudge, moved }
  }

  it('fits each newcomer around the stones already down, which never move, in any order', () => {
    // Bounds from 600 random orders per size: worst gap 3D -0.98 mm (v0.1's jitter + fit: -1.21), 2D -0.52 mm. The guard
    // that matters is FIT_ROOM: stones never move, so a stone that crowds an empty point would squeeze its later occupant.
    let w3 = 0, w2 = 0
    for (const N of [9, 13, 19]) for (let seed = 1; seed <= 100; seed++) for (const flat of [false, true]) {
      const { worst, nudge, moved } = fill(N, seed * 7919 + N, flat)
      expect(moved).toBe(false)
      expect(nudge).toBeLessThanOrEqual(FIT_REACH + 1e-9)
      if (flat) w2 = Math.min(w2, worst); else w3 = Math.min(w3, worst)
    }
    expect(w3).toBeGreaterThan(-1.05)
    expect(w2).toBeGreaterThan(-0.6)
  })

  it('keeps the full jitter for an isolated stone (slate: across up to the room it leaves its neighbours)', () => {
    const N = 19, m = new Map<number, Placed>(), cx = gx(N, 9), cz = gz(N, 9)
    const max = { [RB]: [0, 0], [RW]: [0, 0] }
    for (let k = 0; k < 4000; k++) {
      const R = k % 2 ? RB : RW, j = jitter(N, 9, 9, k), s: Placed = { x: 9, y: 9, R, jx: j.jx, jz: j.jz, tx: 0, tz: 0 }
      m.clear(); m.set(9 * N + 9, s); settle(s, m, N, cx, cz)
      if (R === RW) expect([s.tx, s.tz]).toEqual([j.jx, j.jz]) // shell: untouched
      max[R][0] = Math.max(max[R][0], Math.abs(s.tx - cx)); max[R][1] = Math.max(max[R][1], Math.abs(s.tz - cz))
    }
    expect(max[RW][0]).toBeGreaterThan(0.95 * JIT_ACROSS); expect(max[RW][1]).toBeGreaterThan(0.95 * JIT_ALONG)
    expect(max[RB][0]).toBeGreaterThan(0.55); expect(max[RB][1]).toBeGreaterThan(0.95 * JIT_ALONG)
  })

  it('leaves no overlap around a lone newcomer', () => {
    const N = 19, m = new Map<number, Placed>(), mk = (x: number, y: number, k: number): Placed => { const j = jitter(N, x, y, k); return { x, y, R: RB, jx: j.jx, jz: j.jz, tx: j.jx, tz: j.jz } }
    for (let k = 0; k < 200; k++) {
      m.clear()
      const a = mk(5, 5, k); m.set(5 * N + 5, a)
      const b = mk(6, 5, k + 1000); m.set(5 * N + 6, b); fit(b, m, N)
      expect(Math.hypot(b.tx - a.tx, b.tz - a.tz)).toBeGreaterThanOrEqual(2 * RB + 0.12 - 1e-9)
    }
  })
})

describe('stones in a bowl', () => {
  it('heaps a bowl and a lid without two stones interpenetrating', () => {
    const r = rng(7)
    for (const [pts, R] of [[bowlHeap(RB, 40, 8, r), RB], [Array.from({ length: 60 }, (_, k) => [Math.cos(k * 2.4) * 13 * Math.sqrt(k % 8), Math.sin(k * 2.4) * 13 * Math.sqrt(k % 8)]), RW]] as const) {
      const st = dropStones(pts as number[][], R, J, (d: number) => 50 + 0.05 * d, r)
      expect(st.length).toBeGreaterThan(14)
      for (let i = 0; i < st.length; i++) for (let j = 0; j < i; j++) {
        const a = st[i], b = st[j], d = Math.hypot(a.x - b.x, a.z - b.z)
        if (d < 2 * R) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(2 * lens(d / 2, R, SH, J.expTop) - 1e-9)
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

  it('moves the light in "Auto" only in imperceptible 15 s steps', () => {
    let az = 0, el = 0, K = 0, exp = 0
    for (let m = 0; m < 24 * 60 * 4; m++) {
      const a = todAt(m / 240), b = todAt((m + 1) / 240)
      az = Math.max(az, Math.abs(b.az - a.az)); el = Math.max(el, Math.abs(b.el - a.el)); K = Math.max(K, Math.abs(b.K - a.K)); exp = Math.max(exp, Math.abs(b.exp - a.exp))
    }
    expect(az).toBeLessThan(0.3) // degrees: a soft shadow edge shifts by well under a pixel
    expect(el).toBeLessThan(0.2)
    expect(K).toBeLessThan(15)
    expect(exp).toBeLessThan(0.003)
  })
})

describe('seasons', () => {
  // local times in Paris (vitest shares one process: set before any Date is built here)
  const at = (iso: string) => new Date(iso)
  // the golden hour: minutes after noon while the key brightens from its afternoon level to its evening one (10–90 %)
  const golden = (day: string) => {
    const I = Array.from({ length: 12 * 60 }, (_, m) => seasonTod(new Date(at(day + 'T12:00').getTime() + m * 60_000), 'atelier').I)
    const lo = Math.min(...I), hi = Math.max(...I)
    return I.filter(v => v > lo + 0.1 * (hi - lo) && v < lo + 0.9 * (hi - lo)).length
  }

  it('puts the summer noon sun higher than the winter one, and winter light colder and dimmer', () => {
    const jul = seasonTod(at('2026-07-15T13:00'), 'atelier'), jan = seasonTod(at('2026-01-15T12:00'), 'atelier')
    expect(jul.el).toBeGreaterThan(jan.el + 10)
    expect(jan.K).toBeGreaterThan(jul.K + 1500)
    expect(jan.I).toBeLessThan(jul.I)
    expect(sunOn(at('2026-06-21T12:00')).halfDay).toBeGreaterThan(7.5)
    expect(sunOn(at('2026-12-21T12:00')).halfDay).toBeLessThan(4.6)
  })

  it('keeps today\'s "Auto" at the equinox', () => {
    for (const h of [3, 8, 10, 12.5, 15, 17, 18.5, 21]) {
      const t = at('2026-03-20T00:00').getTime() + h * 3_600_000, a = seasonTod(new Date(t), 'atelier'), b = todAt(h)
      expect(Math.abs(a.K - b.K)).toBeLessThan(60); expect(Math.abs(a.el - b.el)).toBeLessThan(1); expect(Math.abs(a.az - b.az)).toBeLessThan(2)
    }
  })

  it('makes 17 h a summer afternoon and a cold winter dusk', () => {
    const jul = seasonTod(at('2026-07-15T17:00'), 'atelier'), jan = seasonTod(at('2026-01-15T17:00'), 'atelier')
    expect(jul.el).toBeGreaterThan(2 * jan.el)
    expect(jan.K - jul.K).toBeGreaterThan(1500)
  })

  it('stretches the golden hour in summer and shortens it in winter', () => {
    const jul = golden('2026-07-15'), jan = golden('2026-01-15')
    expect(jul).toBeGreaterThan(1.4 * jan); expect(jan).toBeGreaterThan(60)
  })

  it('brightens and cools the Washitsu in Dec–Feb only, and leaves the other décors alone', () => {
    const jan = at('2026-01-15T15:00'), jul = at('2026-07-15T15:00')
    const w = seasonTod(jan, 'washitsu'), a = seasonTod(jan, 'atelier')
    expect(w.env).toBeGreaterThan(a.env * 1.3); expect(w.K).toBeGreaterThan(a.K); expect(w.exp).toBeGreaterThan(a.exp)
    expect(seasonTod(jul, 'washitsu')).toEqual(seasonTod(jul, 'atelier'))
    expect(seasonTod(jan, 'clair')).toEqual(a); expect(seasonTod(jan, 'lanterne')).toEqual(a)
    expect(snowOn(at('2026-04-15T12:00'))).toBe(0); expect(snowOn(at('2026-12-15T12:00'))).toBeGreaterThan(0.6); expect(snowOn(at('2027-02-20T12:00'))).toBeGreaterThan(0.6)
  })

  it('is continuous across the day, the year, the new year and the clock changes', () => {
    // per 15 s (minute steps / 4), the "Auto" bounds above; az a little looser for summer's short nights' quicker dawn
    const lim = { az: 0.4, el: 0.2, K: 15, I: 0.01, env: 0.002, exp: 0.003, room: 0.003 }
    const keys = Object.keys(lim) as (keyof typeof lim)[]
    let worst = 0
    for (const decor of ['atelier', 'washitsu'] as const) {
      let prev = seasonTod(at('2025-12-31T00:00'), decor)
      for (let t = at('2025-12-31T00:00').getTime() + 60_000; t < at('2027-01-02T00:00').getTime(); t += 60_000) {
        const cur = seasonTod(new Date(t), decor)
        for (const k of keys) worst = Math.max(worst, Math.abs(cur[k] - prev[k]) / 4 / lim[k])
        prev = cur
      }
    }
    expect(worst).toBeLessThan(1)
    // spring forward in Paris: 01:59 and 03:00 are a minute apart, and so is their light
    const a = seasonTod(at('2026-03-29T01:59'), 'atelier'), b = seasonTod(at('2026-03-29T03:00'), 'atelier')
    expect(Math.abs(a.K - b.K)).toBeLessThan(5); expect(Math.abs(a.el - b.el)).toBeLessThan(0.1)
  })
})

describe('card skin', () => {
  it('is Laque on the dark backdrops only, Washi in 2D', () => {
    const table = Object.fromEntries((['atelier', 'washitsu', 'lanterne', 'clair'] as const).flatMap(d => (['study', 'contemplation'] as const).map(c => [`${d}/${c}`, cardSkin('3d', c, d)])))
    expect(table).toEqual({
      'atelier/study': 'washi', 'atelier/contemplation': 'laque', 'washitsu/study': 'washi', 'washitsu/contemplation': 'washi',
      'lanterne/study': 'laque', 'lanterne/contemplation': 'laque', 'clair/study': 'washi', 'clair/contemplation': 'washi',
    })
    for (const d of DECORS) for (const c of ['study', 'contemplation'] as const) expect(cardSkin('2d', c, d)).toBe('washi')
  })
})

describe('décors', () => {
  it('has a valid look per décor, with its HDRI bundled', () => {
    expect(Object.keys(LOOKS).sort()).toEqual([...DECORS].sort())
    for (const d of DECORS) {
      const L = LOOKS[d]
      for (const v of [L.tint, L.rough, L.ibl, L.exp, L.soft, L.shade]) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(2) }
      expect(['walnut', 'tatami', 'paper']).toContain(L.ground)
      if (L.sky) expect(Object.keys(import.meta.glob('../../public/assets/board3d/**/*.hdr'))).toContain(`../../public/assets/board3d/${L.sky}_1k.hdr`)
      expect(L.key > 0 || L.lamp > 0).toBe(true) // something casts the shadows
    }
    expect(LOOKS.atelier.linen).toBe(true) // the app's own look in Study
    expect(LOOKS.lanterne.tod).not.toBeNull() // night: the time of day doesn't apply
    expect(LOOKS.lanterne.key).toBe(0)
    for (const d of ['atelier', 'lanterne', 'clair'] as const) expect(LOOKS[d].shoji).toBe(0) // of the first four, the lattice is the Japanese room's (new décors may light their own cookie)
    expect(LOOKS.washitsu.shoji).toBeLessThan(0.5) // the panes carry most of the window's light
  })
})

describe('placing a stone', () => {
  it('falls, touches at DROP_MS, then slides the last millimetre and stops', () => {
    expect(dropPose(0)).toEqual({ y: 12, k: 0, slide: 1 })
    expect(dropPose(DROP_MS / 2).y).toBeCloseTo(9)
    expect(dropPose(DROP_MS)).toEqual({ y: 0, k: 1, slide: 1 }) // contact: the whole slide still to go
    let prev = 1
    for (let ms = DROP_MS + 10; ms <= DROP_MS + SLIDE_MS; ms += 10) { const s = dropPose(ms).slide; expect(s).toBeLessThan(prev); prev = s }
    expect(dropPose(DROP_MS + SLIDE_MS).slide).toBe(0)
    expect(dropPose(1e9)).toEqual({ y: 0, k: 1, slide: 0 }) // an interrupted drop (t0 = -1e9) is simply at rest
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

  it('never steps back up, whatever it measures', () => {
    const g = new Governor(5, 10), r = rng(3)
    let last = 0
    for (let i = 0; i < 5000; i++) {
      if (i % 50 === 0) g.measured(r() * 30); else g.sample(r() < 0.5 ? 8 + r() * 30 : 16)
      expect(g.level).toBeGreaterThanOrEqual(last); last = g.level
    }
  })

  it('warms up: steps down while a frame is over budget, never past the bottom', () => {
    const g = new Governor(3)
    expect(g.measured(5)).toBe(false); expect(g.level).toBe(0)
    expect(g.measured(20)).toBe(true); expect(g.measured(20)).toBe(true); expect(g.measured(20)).toBe(false)
    expect(g.level).toBe(2)
  })

  it('ignores hidden-tab gaps and moderate slowness at the bottom', () => {
    const g = new Governor(2, 5)
    for (let i = 0; i < 20; i++) expect(g.sample(500)).toBeNull()
    g.level = 1
    for (let i = 0; i < 5; i++) expect(g.sample(25)).toBeNull() // 40 fps on the lowest level is acceptable
  })

  it('caps the pixel ratio and degrades monotonically', () => {
    for (const d of [1, 1.5, 2, 2.5, 3, 4]) {
      const l = qualityLadder(d)
      expect(l[0].dpr).toBe(Math.min(d, 3))
      expect(l.map(q => q.kaya4k)).toEqual([true, true, false, false, false])
      for (let i = 1; i < l.length; i++) {
        expect(l[i].dpr).toBeLessThanOrEqual(l[i - 1].dpr)
        expect(l[i].shadow).toBeLessThanOrEqual(l[i - 1].shadow)
      }
      expect(l.at(-1)).toMatchObject({ dpr: 1, shadow: 1024, msaa: 0 })
    }
    expect(qualityLadder(3).map(q => q.dpr)).toEqual([3, 3, 2.25, 1.875, 1])
  })

  it('keeps v0.2 pixel ratios up to dpr 2', () => {
    const v02 = (d: number) => { d = Math.min(Math.max(d, 1), 2); return [d, d, Math.min(d, 1.5), Math.min(d, 1.25), 1] }
    for (const d of [0.5, 1, 1.25, 1.5, 1.75, 2]) expect(qualityLadder(d).map(q => q.dpr)).toEqual(v02(d))
  })

  it('restarts from the top', () => {
    const g = new Governor(5, 10)
    while (g.measured(30));
    g.sample(40)
    g.restart()
    expect(g.level).toBe(0)
    for (let i = 0; i < 9; i++) expect(g.sample(40)).toBeNull() // the half-filled window was dropped
    expect(g.sample(40)).toBe('down')
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

describe('seated camera', () => {
  const { BW, BD } = dims(19, false), deg = Math.PI / 180, hc = seatHeight(BW, BD, 1.5)
  const sub = (a: number[], b: number[]) => a.map((v, k) => v - b[k]), norm = (a: number[]) => a.map(v => v / Math.hypot(...a))

  it('frames the whole board, 1.33× closer than v0.2', () => {
    for (let a = 0.4; a <= 3; a += 0.05) expect(seatHeight(BW, BD, a)).toBeGreaterThanOrEqual(BD * 1.12)
    // 1280×860 with the floating card open: v0.2 showed 820 mm
    const a = (BW + 380) * 1.04 / 820
    expect(Math.max(BD * 1.22, (BW + 380) * 1.04 / a)).toBeCloseTo(820)
    expect(seatHeight(BW, BD, a)).toBeCloseTo(616.5, 0)
  })

  it('puts home exactly where v0.2 put the camera', () => {
    const dist = hc / 2 / Math.tan(FOV / 2 * deg), c = orbitEye(HOME, hc)
    expect(c.eye[0]).toBeCloseTo(0); expect(c.eye[1]).toBeCloseTo(-6 + dist * Math.cos(22 * deg)); expect(c.eye[2]).toBeCloseTo(14 + dist * Math.sin(22 * deg))
    expect(c.up.map(v => v + 0)).toEqual([0, 0, -1])
  })

  it('clamps: eye above the board, target on it', () => {
    const r = rng(5)
    for (let k = 0; k < 2000; k++) {
      const h = seatHeight(BW, BD, 0.4 + r() * 2.6)
      const o = clampOrbit({ yaw: (r() - 0.5) * 4, tilt: (r() - 0.3) * 3, zoom: r() * 1.5, tx: (r() - 0.5) * 2000, tz: (r() - 0.5) * 2000 }, h, BW, BD)
      expect(orbitEye(o, h).eye[1]).toBeGreaterThanOrEqual(100)
      expect(Math.abs(o.tx)).toBeLessThanOrEqual(BW / 2 + 1e-9); expect(Math.abs(o.tz)).toBeLessThanOrEqual(BD / 2 + 1e-9)
      expect(Math.abs(o.yaw)).toBeLessThanOrEqual(60 * deg + 1e-9); expect(o.tilt).toBeGreaterThanOrEqual(5 * deg - 1e-9); expect(o.tilt).toBeLessThanOrEqual(58 * deg + 1e-9)
    }
    // zoom 1: a quarter of the board each way from home, no further
    const far = clampOrbit({ ...HOME, tx: 300, tz: -300 }, hc, BW, BD), near = clampOrbit({ ...HOME, tx: -BW / 4, tz: HOME.tz + BD / 4 }, hc, BW, BD)
    expect([far.tx, far.tz, far.zoom]).toEqual([BW / 4, HOME.tz - BD / 4, 1]); expect([near.tx, near.tz]).toEqual([-BW / 4, HOME.tz + BD / 4])
    // fully zoomed in: the corners; zooming back out draws a corner target back to a quarter of the board
    const corner = clampOrbit({ ...HOME, zoom: 0, tx: 999, tz: 999 }, hc, BW, BD)
    expect(corner.zoom * hc).toBeCloseTo(140); expect(corner.tx).toBeCloseTo(BW / 2); expect(corner.tz).toBeCloseTo(BD / 2)
    const out = clampOrbit({ ...corner, zoom: 1 }, hc, BW, BD)
    expect(out.tx).toBeCloseTo(BW / 4); expect(out.tz).toBeCloseTo(HOME.tz + BD / 4)
  })

  it('zooms about the point under the cursor', () => {
    const o: Orbit = { yaw: 0.4, tilt: 0.7, zoom: 0.8, tx: 30, tz: -20 }, P = [120, -6, 90]
    for (const k of [0.5, 0.9, 1.3]) {
      const a = orbitEye(o, hc), b = orbitEye(zoomAt(o, k, P[0], P[2]), hc), da = norm(sub(P, a.eye))
      norm(sub(P, b.eye)).forEach((v, i) => expect(v).toBeCloseTo(da[i], 9))
      expect(b.dist).toBeCloseTo(a.dist * k)
    }
  })

  it('pans: the grabbed point stays under the cursor', () => {
    const o: Orbit = { yaw: -0.5, tilt: 0.9, zoom: 0.6, tx: 20, tz: 40 }, A = [70, -6, -30], B = [-40, -6, 110]
    // the ray from the panned eye towards A is the one the old eye had towards B: A shows where B was
    const a = orbitEye(o, hc), b = orbitEye(panBy(o, A[0], A[2], B[0], B[2]), hc), dB = norm(sub(B, a.eye))
    norm(sub(A, b.eye)).forEach((v, i) => expect(v).toBeCloseTo(dB[i], 9))
    expect(b.dist).toBe(a.dist); expect(b.up).toEqual(a.up)
  })

  it('follows the goal, at once under reduced motion', () => {
    const cur = { ...HOME }, goal: Orbit = { ...HOME, yaw: 0.5, zoom: 0.5, tx: 40 }
    expect(stepOrbit(cur, goal, 16)).toBe(true)
    expect(cur.yaw).toBeCloseTo(0.5 * (1 - Math.exp(-16 / 70)))
    let n = 0
    while (stepOrbit(cur, goal, 16)) n++
    expect(cur).toEqual(goal); expect(n).toBeLessThan(60)
    const c2 = { ...HOME }
    expect(stepOrbit(c2, goal, 16, true)).toBe(false); expect(c2).toEqual(goal)
  })

  it('tells a wheel from a trackpad', () => {
    const w = (deltaY: number, o: Partial<{ deltaX: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }> = {}) => ({ deltaX: 0, deltaMode: 0, ctrlKey: false, deltaY, ...o })
    // macOS mouse (WebKit/Chromium): notches of 4.000244 px, accelerated
    for (const d of [4.000244140625, -4.000244140625, 8.00048828125, 36.002197265625]) expect(wheelIntent(w(d), null, 1e9)).toBe('zoom')
    // Windows mouse (WebView2): 100 px per notch; Firefox: lines
    expect(wheelIntent(w(100), null, 1e9)).toBe('zoom'); expect(wheelIntent(w(3, { deltaMode: 1 }), null, 1e9)).toBe('zoom')
    // macOS trackpad two-finger swipe: small whole or fractional pixels, often with some deltaX
    for (const d of [1, 2, 4, 7, 12, 0.5, -3]) expect(wheelIntent(w(d), null, 1e9)).toBe('orbit')
    expect(wheelIntent(w(60, { deltaX: 2 }), null, 1e9)).toBe('orbit')
    // its momentum keeps the verdict, even past 40 px; a pause starts a new gesture
    expect(wheelIntent(w(80), 'orbit', 16)).toBe('orbit'); expect(wheelIntent(w(80), 'orbit', 400)).toBe('zoom')
    // pinch (Chromium, WebView2, Firefox): ctrl+wheel, small fractional deltas, wins over a gesture in progress
    for (const d of [0.5, -1.25, 3]) expect(wheelIntent(w(d, { ctrlKey: true }), 'orbit', 16)).toBe('zoom')
    // Shift turns a swipe into a pan, never a wheel notch or a pinch; a gesture keeps its verdict
    for (const d of [1, 7, -3]) expect(wheelIntent(w(d, { shiftKey: true }), null, 1e9)).toBe('pan')
    expect(wheelIntent(w(0, { deltaX: 4, shiftKey: true }), null, 1e9)).toBe('pan')
    expect(wheelIntent(w(100, { shiftKey: true }), null, 1e9)).toBe('zoom'); expect(wheelIntent(w(2, { ctrlKey: true, shiftKey: true }), null, 1e9)).toBe('zoom')
    expect(wheelIntent(w(3, { shiftKey: true }), 'orbit', 16)).toBe('orbit'); expect(wheelIntent(w(3), 'pan', 16)).toBe('pan')
    // WebKit pinches through gesture events only; Chromium, WebView2 and WebKitGTK through ctrl+wheel
    expect([skipPinchWheel(true, true), skipPinchWheel(true, false), skipPinchWheel(false, true)]).toEqual([true, false, false])
  })

  it('picks the drawn intersection, or the stone on top of it', () => {
    const N = 19, empty = new Map<number, Placed>(), r = rng(9)
    // top down: today's rounding
    for (let k = 0; k < 2000; k++) {
      const x = (r() - 0.5) * 460, z = (r() - 0.5) * 490, i = Math.round(x / SX + 9), j = Math.round(z / SZ + 9)
      expect(pickPoint([x, 3000, z], [0, -1, 0], N, empty, J)).toEqual(i < 0 || j < 0 || i >= N || j >= N ? null : [i, j])
    }
    // steepest tilt, turned and zoomed: the ray through the drawn point (y = 0) or through a stone's top
    for (const o of [{ ...HOME, tilt: 58 * deg }, { ...HOME, tilt: 58 * deg, yaw: -60 * deg, zoom: 0.3 }]) {
      const eye = orbitEye(o, hc).eye
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        expect(pickPoint(eye, sub([gx(N, i), 0, gz(N, j)], eye), N, empty, J)).toEqual([i, j])
        const s: Placed = { x: i, y: j, R: RB, jx: 0, jz: 0, tx: gx(N, i) + 0.5, tz: gz(N, j) - 1 }
        expect(pickPoint(eye, sub([s.tx, 2 * SH, s.tz], eye), N, new Map([[j * N + i, s]]), J)).toEqual([i, j])
      }
    }
    // a stone never claims a ray that misses it (the march passes y = SH exactly, where lens() is 0 outside the stone)
    const near: Placed = { x: 14, y: 1, R: RB, jx: 0, jz: 0, tx: 109.58, tz: -190.42 }
    expect(pickPoint([gx(N, 13) - 50, 100, gz(N, 0)], [0.5, -1, 0], N, new Map([[1 * N + 14, near]]), J)).toEqual([13, 0])
    // the old plane at y = SH misses by a third of a row at 58°
    expect(SH * Math.tan(58 * deg) / SZ).toBeGreaterThan(0.3)
    expect(lens(0, RB, SH, J.expTop)).toBe(SH)
  })
})
