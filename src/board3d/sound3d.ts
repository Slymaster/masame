// Recorded stone sounds (CC0, see public/assets/board3d/CREDITS.md): round-robin hits with pitch, velocity and stereo
// variation, a capture built from the same material (stones clicking onto a wooden lid), a room tail, and the quiet
// "stones stirred in the bowl" loop while the AI thinks. Silent (never throws) when audio is unavailable.

import { panFor } from './logic'

type Slots = { buf: AudioBuffer; starts: number[] }

/** Each sprite is fixed-length slots; the hit is found by scanning (MP3 encoder delay differs between decoders). */
function slots(buf: AudioBuffer, slot: number): Slots {
  const d = buf.getChannelData(0), n = Math.round(slot * buf.sampleRate), starts: number[] = []
  for (let s = 0; s + n <= d.length + n / 2; s += n) {
    let peak = 0
    for (let i = s; i < Math.min(s + n, d.length); i++) peak = Math.max(peak, Math.abs(d[i]))
    if (peak < 1e-3) continue
    let i = s
    while (i < s + n && Math.abs(d[i]) < peak * 0.08) i++
    starts.push(Math.max(s, i - Math.round(0.002 * buf.sampleRate)) / buf.sampleRate)
  }
  return { buf, starts }
}

export class StoneSound {
  enabled = true
  private ac: AudioContext | null = null
  private out: GainNode | null = null
  private room: GainNode | null = null
  private raw: Promise<ArrayBuffer[]> | null = null
  private place: Slots | null = null
  private clicks: Slots | null = null
  private bowl: AudioBuffer | null = null
  private ready: Promise<void> | null = null
  private recent: number[] = []
  private loop: { src: AudioBufferSourceNode; gain: GainNode } | null = null
  private thinking = false

  constructor(private base: string) {}

  /** Fetches early (no AudioContext needed); decoding waits for the first user gesture. */
  preload() {
    this.raw ??= Promise.all(['place', 'clicks', 'bowl'].map(n => fetch(`${this.base}${n}.mp3`).then(r => {
      if (!r.ok) throw new Error(`${n}.mp3: ${r.status}`)
      return r.arrayBuffer()
    })))
    this.raw.catch(() => {})
  }

  /** Call from a user gesture (pointerdown): creates/resumes the context so the very first stone is heard. */
  prime() {
    if (!this.enabled) return
    try {
      if (!this.ac) {
        const ac = new AudioContext()
        this.ac = ac
        this.out = ac.createGain(); this.out.gain.value = 0.9; this.out.connect(ac.destination)
        // small wooden room: a short synthetic tail, low in the mix
        const conv = ac.createConvolver(), len = Math.round(ac.sampleRate * 0.5), ir = ac.createBuffer(2, len, ac.sampleRate)
        for (let c = 0; c < 2; c++) {
          const ch = ir.getChannelData(c)
          for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.09)) * (i < 200 ? i / 200 : 1)
        }
        conv.buffer = ir
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800
        this.room = ac.createGain(); this.room.gain.value = 0.16
        this.room.connect(lp).connect(conv).connect(this.out)
        this.preload()
        this.ready = this.raw!.then(bufs => Promise.all(bufs.map(b => ac.decodeAudioData(b.slice(0))))).then(([p, c, b]) => {
          this.place = slots(p, 0.5); this.clicks = slots(c, 0.2); this.bowl = b
          if (this.thinking) this.setThinking(true)
        }).catch(() => {})
      }
      if (this.ac.state === 'suspended') void this.ac.resume()
    } catch { this.ac = null }
  }

  private voice(s: Slots, k: number, t: number, opt: { rate?: number; gain?: number; pan?: number; lp?: number; wet?: number; dur?: number }) {
    const ac = this.ac!, src = ac.createBufferSource(), g = ac.createGain(), p = ac.createStereoPanner()
    src.buffer = s.buf
    src.playbackRate.value = opt.rate ?? 1
    g.gain.value = opt.gain ?? 1
    p.pan.value = opt.pan ?? 0
    let node: AudioNode = src
    if (opt.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opt.lp; node = node.connect(f) }
    node.connect(g).connect(p).connect(this.out!)
    if (opt.wet !== 0) { const w = ac.createGain(); w.gain.value = opt.wet ?? 1; p.connect(w).connect(this.room!) }
    const dur = opt.dur ?? 0.45
    src.start(t, s.starts[k], dur)
  }

  /** Round robin without immediate repeats. */
  private pick(n: number) {
    let k = 0
    for (let tries = 0; tries < 8; tries++) { k = Math.floor(Math.random() * n); if (!this.recent.includes(k)) break }
    this.recent.push(k); if (this.recent.length > Math.min(4, n - 1)) this.recent.shift()
    return k
  }

  private live() { return this.enabled && this.ac && this.place && this.ac.state !== 'closed' }

  /** A stone placed at column x on an N board; velocity 0–1 (default: a natural spread). */
  stone(N: number, x: number, velocity = 0.6 + Math.random() * 0.4) {
    this.prime()
    if (!this.live()) { void this.ready?.then(() => this.live() && this.stone(N, x, velocity)); return }
    const t = this.ac!.currentTime + 0.003
    this.voice(this.place!, this.pick(this.place!.starts.length), t, {
      rate: 1 + (Math.random() * 2 - 1) * 0.03,
      gain: 0.35 + 0.65 * velocity,
      pan: panFor(N, x),
      lp: 5000 + 9000 * velocity, // softer hits are duller
    })
  }

  /** n stones taken off the board, landing on a wooden lid after `delay` seconds. */
  capture(n: number, N: number, x: number, delay = 0.08) {
    if (n <= 0 || !this.live()) return
    const t0 = this.ac!.currentTime + delay, pan = panFor(N, x) * 0.6
    // the lid: a stone hit pitched down and darkened reads as a hollow wooden thunk
    this.voice(this.place!, this.pick(this.place!.starts.length), t0, { rate: 0.6 + Math.random() * 0.05, gain: 0.55, pan, lp: 1600, wet: 1.5, dur: 0.6 })
    const k = Math.min(n, 6) + 1
    for (let i = 0; i < k; i++) {
      const t = t0 + 0.02 + Math.random() * (0.08 + 0.04 * k)
      this.voice(this.clicks!, Math.floor(Math.random() * this.clicks!.starts.length), t, {
        rate: 0.88 + Math.random() * 0.24, gain: 0.25 + Math.random() * 0.35, pan: pan + (Math.random() - 0.5) * 0.2, lp: 7000, dur: 0.15,
      })
    }
  }

  /** A pass: one soft click from the passer's bowl (Black's to the right, White's to the left). */
  tap(c: number) {
    this.prime()
    if (!this.live()) { void this.ready?.then(() => this.live() && this.tap(c)); return }
    this.voice(this.clicks!, Math.floor(Math.random() * this.clicks!.starts.length), this.ac!.currentTime + 0.003, { gain: 0.3, pan: c === 1 ? 0.45 : -0.45, dur: 0.15 })
  }

  /** Quiet stones stirred in the bowl while the AI thinks. */
  setThinking(on: boolean) {
    this.thinking = on
    const ac = this.ac
    if (!ac || !this.bowl) return
    const t = ac.currentTime
    if (on && this.enabled && !this.loop) {
      const src = ac.createBufferSource(), gain = ac.createGain(), lp = ac.createBiquadFilter(), p = ac.createStereoPanner()
      src.buffer = this.bowl; src.loop = true
      lp.type = 'lowpass'; lp.frequency.value = 3200
      p.pan.value = 0.45 // the AI's bowl sits to the side
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.13, t + 0.5)
      src.connect(lp).connect(gain).connect(p).connect(this.out!)
      src.start(t, Math.random() * this.bowl.duration)
      this.loop = { src, gain }
    } else if ((!on || !this.enabled) && this.loop) {
      const { src, gain } = this.loop
      gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + 0.6)
      src.stop(t + 0.65)
      this.loop = null
    }
  }

  setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    this.setThinking(this.thinking)
  }

  destroy() {
    this.loop?.src.stop(); this.loop = null
    void this.ac?.close().catch(() => {}); this.ac = null
  }
}
