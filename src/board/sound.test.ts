import { describe, expect, it } from 'vitest'
import { clack, LOWPASS_HZ } from './sound'

/** Records the graph a sound builds: every node with its type, settings and gain automation. */
function fake() {
  const nodes: Record<string, unknown>[] = []
  const param = () => { const p = { value: 0, ev: [] as number[][], setValueAtTime: (v: number, t: number) => p.ev.push([v, t]), exponentialRampToValueAtTime: (v: number, t: number) => p.ev.push([v, t]) }; return p }
  const node = (kind: string, extra: Record<string, unknown> = {}) => {
    const n: Record<string, unknown> = { kind, to: null, connect: (d: Record<string, unknown>) => { n.to = d.kind; return d }, start() {}, stop() {}, ...extra }
    nodes.push(n); return n
  }
  const c = {
    destination: { kind: 'out' },
    createBufferSource: () => node('src'),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: param() }),
    createGain: () => node('gain', { gain: param() }),
    createOscillator: () => node('osc', { frequency: param() }),
  }
  return { c: c as unknown as BaseAudioContext, nodes }
}
const freq = (n: Record<string, unknown>) => (n.frequency as { value: number; ev: number[][] })
const peak = (n: Record<string, unknown>) => (n.gain as { ev: number[][] }).ev[1][0]

describe('the 2D stone sound follows the set', () => {
  it('1, 1, 1 is the plain clack: no low-pass, the recorded frequencies and levels', () => {
    const { c, nodes } = fake()
    clack(c, 0, { rate: 1, lowpass: 1, gain: 1 })
    const [, bp, g1, osc, g2] = nodes
    expect(nodes.map(n => n.kind)).toEqual(['src', 'filter', 'gain', 'osc', 'gain'])
    expect(freq(bp).value).toBe(2500); expect(freq(osc).ev).toEqual([[200, 0], [150, 0.06]])
    expect(peak(g1)).toBe(0.9); expect(peak(g2)).toBe(0.45)
    expect(g1.to).toBe('out'); expect(g2.to).toBe('out')
  })
  it('rate, lowpass and gain scale it', () => {
    const { c, nodes } = fake()
    clack(c, 0, { rate: 0.8, lowpass: 0.5, gain: 0.7 })
    const [lp, , bp, g1, osc, g2] = nodes
    expect(lp.kind).toBe('filter'); expect(freq(lp).value).toBe(LOWPASS_HZ * 0.5); expect(lp.to).toBe('out')
    expect(freq(bp).value).toBe(2000); expect(freq(osc).ev).toEqual([[160, 0], [120, 0.06 / 0.8]])
    expect(peak(g1)).toBeCloseTo(0.63, 9); expect(peak(g2)).toBeCloseTo(0.315, 9)
    expect(g1.to).toBe('filter'); expect(g2.to).toBe('filter')
  })
})
