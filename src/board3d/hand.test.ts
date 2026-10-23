import { describe, expect, it } from 'vitest'
import { L1, L2, mhName, reach, REACH, seat, solveArm, type V3 } from './hand'
import { groundY, TABLE } from './gobans'
import ashi from './gobans/ashi'
import pliant from './gobans/pliant'
import { dims, gx, gz } from './logic'

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

describe('reach', () => {
  const hip: V3 = [0, 140, -587], S0: V3 = [-190, 660, -587], cap = REACH * (L1 + L2)
  it('stays upright for a target within reach', () => {
    expect(dist(reach(hip, S0, [-150, 300, -400]).shoulder, S0)).toBeLessThan(1e-6)
  })
  it('bows just enough toward a far target, the shoulder going forward and down, pivoting at the hips', () => {
    const T: V3 = [-80, 60, -150], { shoulder } = reach(hip, S0, T)
    expect(dist(shoulder, T)).toBeLessThanOrEqual(cap)
    expect(dist(shoulder, T)).toBeGreaterThan(cap - 5)
    expect(shoulder[2]).toBeGreaterThan(S0[2]); expect(shoulder[1]).toBeLessThan(S0[1])
    expect(dist(shoulder, hip)).toBeCloseTo(dist(S0, hip), 6)
  })
  // the wrist at the press, from the stone's rest spot, in the frame of his heading (from the shoulder toward the stone):
  // measured on the MakeHuman hand (src-tauri/assets/hand/hand-v1.glb) in the grip pose
  const WRIST = { along: -181, side: 20, up: 25 }
  const shapes = { table: TABLE, ashi, pliant }
  for (const [name, shape] of Object.entries(shapes)) for (const N of [19, 13, 9]) for (const coords of [false, true]) {
    it(`brings the wrist onto every point: ${name}, ${N}×${N}${coords ? ', coordinates' : ''}`, () => {
      const { BD } = dims(N, coords), { hip: h0, S0: s0 } = seat(groundY(shape), BD)
      let worst = 0
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const R: V3 = [gx(N, i), 5, gz(N, j)], hx = R[0] - s0[0], hz = R[2] - s0[2], L = Math.hypot(hx, hz), ux = hx / L, uz = hz / L
        const W: V3 = [R[0] + WRIST.along * ux - WRIST.side * uz, R[1] + WRIST.up, R[2] + WRIST.along * uz + WRIST.side * ux]
        const b = reach(h0, s0, W), ik = solveArm(b.shoulder, W, L1, L2, [-1, -0.7, -0.2])
        worst = Math.max(worst, dist(ik.wrist, W))
        expect(dist(ik.elbow, b.shoulder)).toBeCloseTo(L1, 3)
      }
      expect(worst).toBeLessThanOrEqual(3)
    })
  }
})

describe('mhName (WebXR joint → MakeHuman game_engine bone)', () => {
  it('maps the wrist, the thumb and the fingers', () => {
    expect(mhName('wrist')).toBe('hand_r')
    expect(['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'].map(j => mhName(`thumb-${j}`))).toEqual(['thumb_01_r', 'thumb_02_r', 'thumb_03_r', 'thumb_tip_r'])
    expect(['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => mhName(`pinky-finger-${j}`))).toEqual(['pinky_01_r', 'pinky_02_r', 'pinky_03_r', 'pinky_tip_r'])
    expect(mhName('index-finger-tip')).toBe('index_tip_r')
  })
})
