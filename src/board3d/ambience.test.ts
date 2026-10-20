import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Ambience, AMBIENT_FADE, AMBIENT_LEVEL, fadeCurve, loopBounds } from './ambience'

describe('ambient fade', () => {
  it('runs from end to end, monotonic, equal power across a crossfade', () => {
    const up = fadeCurve(0, AMBIENT_LEVEL), down = fadeCurve(AMBIENT_LEVEL, 0)
    expect(up[0]).toBe(0); expect(up.at(-1)).toBeCloseTo(AMBIENT_LEVEL, 9)
    expect(down[0]).toBe(AMBIENT_LEVEL); expect(down.at(-1)).toBeCloseTo(0, 9)
    for (let i = 1; i < up.length; i++) { expect(up[i]).toBeGreaterThan(up[i - 1]); expect(down[i]).toBeLessThan(down[i - 1]) }
    for (let i = 0; i < up.length; i++) expect(up[i] ** 2 + down[i] ** 2).toBeCloseTo(AMBIENT_LEVEL ** 2, 9)
  })
  it('starts a cut-short fade from where it is', () => {
    const c = fadeCurve(0.04, 0)
    expect(c[0]).toBe(0.04); expect(c.at(-1)).toBeCloseTo(0, 9)
  })
})

describe('loop bounds', () => {
  it('skips the decoder padding at both ends', () => {
    const ch = new Float32Array(1000); ch.fill(0.5, 100, 900)
    expect(loopBounds(ch, 1000)).toEqual([0.1, 0.9])
    expect(loopBounds(new Float32Array(10).fill(0.3), 10)).toEqual([0, 1])
  })
})

/* ---------- the player, on a fake audio graph ---------- */
class Param {
  value = 0
  events: [string, number, number][] = []
  cancelScheduledValues(t: number) { this.events = this.events.filter(e => e[2] < t) }
  setValueAtTime(v: number, t: number) { this.events.push(['set', v, t]); this.value = v }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(['ramp', v, t]) }
  /** The value the automation has reached at time t. */
  at(t: number) { let v = 0; for (const [, x, u] of this.events) if (u <= t) v = x; return v }
}
class FakeContext {
  currentTime = 0
  state: AudioContextState = 'running'
  destination = {}
  sources: { buffer: unknown; loop: boolean; loopStart: number; loopEnd: number; started?: number; stopped?: number; gain?: Param }[] = []
  createGain() { const gain = new Param(); return { gain, connect: (d: unknown) => d } }
  createBufferSource() {
    const s = { buffer: null as unknown, loop: false, loopStart: 0, loopEnd: 0, started: undefined as number | undefined, stopped: undefined as number | undefined, gain: undefined as Param | undefined,
      connect: (g: { gain: Param }) => { s.gain = g.gain; return g }, start: (t: number) => { s.started = t }, stop: (t: number) => { s.stopped = t } }
    this.sources.push(s); return s
  }
  resume() { this.state = 'running'; return Promise.resolve() }
  suspend() { this.state = 'suspended'; return Promise.resolve() }
}
const buffer = (n: number) => { const ch = new Float32Array(n).fill(0.2); ch.fill(0, 0, 10); return { sampleRate: 1000, getChannelData: () => ch } }
const flush = () => new Promise(r => setTimeout(r, 0))

describe('ambience player', () => {
  let doc: { hidden: boolean; listeners: Record<string, () => void>; addEventListener(k: string, f: () => void): void }
  beforeEach(() => {
    doc = { hidden: false, listeners: {}, addEventListener(k, f) { this.listeners[k] = f } }
    vi.stubGlobal('document', doc); vi.stubGlobal('addEventListener', () => {})
  })
  afterEach(() => vi.unstubAllGlobals())

  const make = () => {
    const ac = new FakeContext(), loads: string[] = []
    const amb = new Ambience('/a/', (_, url) => { loads.push(url); return Promise.resolve(buffer(2000) as unknown as AudioBuffer) }, () => ac as unknown as AudioContext)
    return { ac, amb, loads }
  }

  it('stays silent and sets nothing up without a loop', async () => {
    const { ac, amb, loads } = make()
    amb.play(undefined); amb.play(null); await flush()
    expect(loads).toEqual([]); expect(ac.sources).toEqual([])
  })

  it('fades a loop in, crossfades to the next décor, fades out', async () => {
    const { ac, amb, loads } = make()
    amb.play('snow.mp3'); await flush()
    const [a] = ac.sources
    expect(loads).toEqual(['/a/snow.mp3'])
    expect(a.loop).toBe(true); expect(a.loopStart).toBe(0.01); expect(a.loopEnd).toBe(2)
    expect(a.gain!.at(0)).toBe(0); expect(a.gain!.at(AMBIENT_FADE)).toBeCloseTo(AMBIENT_LEVEL, 9)

    ac.currentTime = 10; a.gain!.value = AMBIENT_LEVEL
    amb.play('rain.mp3'); await flush()
    const b = ac.sources[1]
    expect(a.stopped).toBeCloseTo(10 + AMBIENT_FADE + 0.05, 9)
    expect(a.gain!.at(10)).toBe(AMBIENT_LEVEL); expect(a.gain!.at(10 + AMBIENT_FADE)).toBeCloseTo(0, 9)
    expect(b.started).toBe(10); expect(b.gain!.at(10 + AMBIENT_FADE)).toBeCloseTo(AMBIENT_LEVEL, 9)

    amb.play('rain.mp3'); await flush()
    expect(ac.sources).toHaveLength(2) // the same loop again: nothing restarts

    ac.currentTime = 20; b.gain!.value = AMBIENT_LEVEL
    amb.play(null); await flush()
    expect(b.stopped).toBeCloseTo(20 + AMBIENT_FADE + 0.05, 9); expect(b.gain!.at(20 + AMBIENT_FADE)).toBeCloseTo(0, 9)
  })

  it('keeps only the latest choice when the décor changes during a load', async () => {
    const { ac, amb, loads } = make()
    amb.play('a.mp3'); amb.play('b.mp3'); await flush()
    expect(loads).toEqual(['/a/a.mp3', '/a/b.mp3'])
    expect(ac.sources).toHaveLength(1)
  })

  it('sleeps while the window is hidden and wakes when shown', async () => {
    const { ac, amb } = make()
    amb.play('snow.mp3'); await flush()
    doc.hidden = true; doc.listeners.visibilitychange(); await flush()
    expect(ac.state).toBe('suspended')
    doc.hidden = false; doc.listeners.visibilitychange(); await flush()
    expect(ac.state).toBe('running')
    expect(ac.sources).toHaveLength(1) // the same loop, held in place
  })
})
