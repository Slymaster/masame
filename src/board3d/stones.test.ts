import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ambientOn, cardSkin, clampOrbit, HOME, dropStones, gx, gz, isReadyDecor, lens, lensBot, lensTop, LOOKS, pickPoint, qualityLadder, type Placed, type StoneShape } from './logic'
import { DECORS } from './decors'
import { isReadySet, STONE_DATA, STONE_SETS } from './stoneSets'
import { dimOf, ghostOf, pendingOf, STONES, stoneGeo } from './stones'

const hex = (c: THREE.Color) => c.getHex()
/** A single convex stone (Chinese yunzi-like), only for these tests. */
const YUNZI: StoneShape = { rB: 11.1, rW: 11.1, shTop: 6.6, shBot: 0.8, expTop: 0.7, expBot: 0.25 }
const hc = { value: 0 }

describe('stone sets', () => {
  it('has one row per set, with real-world sizes, both materials and a 2D palette', () => {
    expect(Object.keys(STONES).sort()).toEqual([...STONE_SETS].sort())
    for (const [name, s] of Object.entries(STONES)) {
      for (const r of [s.rB, s.rW]) { expect(r, name).toBeGreaterThanOrEqual(10.6); expect(r, name).toBeLessThanOrEqual(11.3) }
      const half = (s.shTop + s.shBot) / 2 // half the stone's thickness
      expect(half, name).toBeGreaterThanOrEqual(3.8); expect(half, name).toBeLessThanOrEqual(5.5)
      expect(s.shBot, name).toBeGreaterThanOrEqual(0.5); expect(s.shTop, name).toBeGreaterThanOrEqual(s.shBot) // the dome is on top
      for (const e of [s.expTop, s.expBot]) { expect(e, name).toBeGreaterThan(0); expect(e, name).toBeLessThanOrEqual(1.5) }
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
    expect([j.rB, j.rW, j.shTop, j.shBot, j.expTop, j.expBot]).toEqual([11.1, 10.95, 4.5, 4.5, 0.78, 0.78])
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

  it('shapes the stone geometry: shBot under the girdle, shTop over it, 2·R across', () => {
    for (const [sh, top, bot] of [[STONES.japonaise, 4.5, 4.5], [YUNZI, YUNZI.shTop, YUNZI.shBot]] as const) {
      const g = stoneGeo(11.1, sh)
      g.computeBoundingBox()
      const b = g.boundingBox!
      expect(b.max.y).toBeCloseTo(top, 6); expect(b.min.y).toBeCloseTo(-bot, 6)
      expect(b.max.x - b.min.x).toBeCloseTo(22.2, 2)
    }
  })

  it('a single convex stone: picked through its tall dome, heaped without interpenetrating', () => {
    const N = 19, R = 11.1, s: Placed = { x: 9, y: 9, R, jx: 0, jz: 0, tx: gx(N, 9), tz: gz(N, 9) }, map = new Map([[9 * N + 9, s]])
    // a ray grazing 1 mm under the dome's top, one cell across: it hits the stone, not the point behind it
    const top = YUNZI.shBot + YUNZI.shTop - 1, eye = [s.tx - 300, top + 300 * 0.3, s.tz]
    expect(pickPoint(eye, [1, -0.3, 0], N, map, YUNZI)).toEqual([9, 9])
    // the dome stands higher than a Japanese stone's
    expect(lensTop(0, R, YUNZI)).toBeGreaterThan(lensTop(0, R, STONES.japonaise))
    expect(lensBot(R * 0.8, R, YUNZI)).toBeGreaterThan(0.5 * YUNZI.shBot) // the bottom stays nearly flat out to its rounded rim
    const pts = Array.from({ length: 40 }, (_, k) => [Math.cos(k * 2.4) * 12 * Math.sqrt(k % 6), Math.sin(k * 2.4) * 12 * Math.sqrt(k % 6)])
    const st = dropStones(pts, R, YUNZI, () => 0, () => 0.5)
    for (let i = 0; i < st.length; i++) for (let j = 0; j < i; j++) {
      const a = st[i], b = st[j], d = Math.hypot(a.x - b.x, a.z - b.z)
      if (d < 2 * R) expect(a.y - b.y).toBeGreaterThanOrEqual(lensTop(d / 2, R, YUNZI) + lensBot(d / 2, R, YUNZI) - 1e-9)
    }
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

describe('ambient animation gate', () => {
  const ok = { animated: true, contemplation: true, fx: 2, visible: true, focused: true, reducedMotion: false, busy: false }
  it('runs only for an animated scene in Contemplation at fx 2, visible, focused, still, motion allowed', () => {
    expect(ambientOn(ok)).toBe(true)
    for (const k of ['animated', 'contemplation', 'visible', 'focused'] as const) expect(ambientOn({ ...ok, [k]: false }), k).toBe(false)
    for (const k of ['reducedMotion', 'busy'] as const) expect(ambientOn({ ...ok, [k]: true }), k).toBe(false)
    expect(ambientOn({ ...ok, fx: 1 })).toBe(false)
  })
  it('is allowed on the two best quality levels only', () => {
    expect(qualityLadder(2).map(q => q.fx)).toEqual([2, 2, 1, 1, 0])
  })
})

describe('pending ids', () => {
  // An id listed in DECORS / STONE_SETS before its files exist is pending: it falls back, it never crashes.
  // The final pass asserts both lists are empty.
  const decors = DECORS.filter(d => !isReadyDecor(d)), sets = STONE_SETS.filter(s => !isReadySet(s))
  it('lists the pending décors and stone sets', () => {
    console.info('pending décors:', decors.join(', ') || 'none', '| pending stone sets:', sets.join(', ') || 'none')
    expect(isReadyDecor('atelier') && isReadySet('japonaise')).toBe(true)
  })
  it('shows a pending décor as the Atelier and plays a pending set as the Japanese one', () => {
    for (const d of decors) expect(LOOKS[d]).toBe(LOOKS.atelier)
    for (const s of sets) { expect(STONES[s]).toBe(STONES.japonaise); expect(STONE_DATA[s]).toBe(STONE_DATA.japonaise) }
  })
})

describe('Look fields', () => {
  it('lets a décor raise the seated camera (tiltMax), keeps 58° otherwise', () => {
    const o = { ...HOME, tilt: 1.5 }
    expect(clampOrbit(o, 600, 424, 454).tilt).toBeCloseTo(58 * Math.PI / 180, 9)
    expect(clampOrbit(o, 600, 424, 454, 1.4).tilt).toBe(1.4)
  })
  it('gives the card the v0.5 skins on the four first décors', () => {
    const got = (['atelier', 'washitsu', 'lanterne', 'clair'] as const).map(d => [cardSkin('3d', 'study', d), cardSkin('3d', 'contemplation', d), cardSkin('2d', 'contemplation', d)].join())
    expect(got).toEqual(['washi,laque,washi', 'washi,washi,washi', 'laque,laque,washi', 'washi,washi,washi'])
  })
})
