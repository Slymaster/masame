import { describe, expect, it } from 'vitest'
import { lean, L1, L2, REACH, solveArm, type V3 } from './hand'

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('solveArm (two-bone IK)', () => {
  const S: V3 = [-190, 660, -587]
  it('reaches a reachable target with both bones at their length, the elbow toward the pole', () => {
    const T: V3 = [-80, 300, -250]
    const { elbow, wrist, capped } = solveArm(S, T, L1, L2, [-1, -0.7, -0.2])
    expect(capped).toBe(false)
    expect(dist(wrist, T)).toBeLessThan(1e-6)
    expect(dist(elbow, S)).toBeCloseTo(L1, 6)
    expect(dist(wrist, elbow)).toBeCloseTo(L2, 6)
    expect(elbow[0]).toBeLessThan((S[0] + T[0]) / 2) // out to his right (−x)
  })
  it('caps an out-of-reach target, never straight, along the line to it', () => {
    const T: V3 = [0, 0, 400]
    const { elbow, wrist, capped } = solveArm(S, T, L1, L2, [-1, -0.7, -0.2])
    expect(capped).toBe(true)
    expect(dist(wrist, S)).toBeCloseTo(REACH * (L1 + L2), 6)
    expect(dist(elbow, S)).toBeCloseTo(L1, 6)
    expect(dist(wrist, elbow)).toBeCloseTo(L2, 6)
    const u = (a: V3, b: V3) => { const d = dist(a, b); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d] }
    u(S, wrist).forEach((x, i) => expect(x).toBeCloseTo(u(S, T)[i], 6))
  })
})

describe('lean', () => {
  const hip: V3 = [0, 140, -587], S0: V3 = [-190, 660, -587], cap = REACH * (L1 + L2)
  it('stays upright for a target within reach', () => {
    expect(dist(lean(hip, S0, [-150, 300, -400], cap).shoulder, S0)).toBeLessThan(1e-6)
  })
  it('leans just enough (at most 350 mm) toward a far target', () => {
    const T: V3 = [-80, 60, -150], { shoulder } = lean(hip, S0, T, cap)
    expect(dist(shoulder, T)).toBeLessThanOrEqual(cap)
    expect(dist(shoulder, S0)).toBeLessThanOrEqual(350 + 1e-6)
    expect(dist(shoulder, hip)).toBeCloseTo(dist(S0, hip), 6) // it pivots at the hips
  })
})
