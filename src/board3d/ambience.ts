// The décor's ambient sound (Look.ambient): one quiet looping buffer, crossfaded when the décor changes, silent while the
// window is hidden. No three.js. Fetched only when it is to be heard; only the current buffer is kept.

/** The loop's gain: well under the stone sounds (their hits peak at 0.35–1 × 0.9). */
export const AMBIENT_LEVEL = 0.1
/** Seconds of the crossfade between two décors' loops, and of a fade in or out. */
export const AMBIENT_FADE = 1.5

/**
 * An equal-power fade from `from` to `to` in n points: rising follows a sine, falling a cosine,
 * so a loop fading out and the next fading in keep the room's loudness steady.
 */
export function fadeCurve(from: number, to: number, n = 16): number[] {
  const c: number[] = []
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * Math.PI / 2
    c.push(to >= from ? from + (to - from) * Math.sin(x) : to + (from - to) * Math.cos(x))
  }
  return c
}

/**
 * Where a decoded loop really starts and ends: MP3 decoders pad both ends with silence, which a plain loop would make
 * audible as a gap at every turn. Scans at most `max` samples from each end for the first sample above `eps`.
 */
export function loopBounds(ch: Float32Array, sampleRate: number, eps = 1e-4, max = 8192): [number, number] {
  let a = 0, b = ch.length
  while (a < Math.min(max, ch.length - 1) && Math.abs(ch[a]) < eps) a++
  while (b > Math.max(a + 1, ch.length - max) && Math.abs(ch[b - 1]) < eps) b--
  return [a / sampleRate, b / sampleRate]
}

type Voice = { url: string; src: AudioBufferSourceNode; gain: GainNode }

export class Ambience {
  private ac: AudioContext | null = null
  private url: string | null = null // what should be heard (null: silence)
  private voice: Voice | null = null
  private buf: { url: string; data: Promise<AudioBuffer | null> } | null = null
  private gen = 0
  private wired = false

  /** `base`: where Look.ambient paths live; `load` fetches and decodes (replaceable in tests). */
  constructor(private base = `${import.meta.env.BASE_URL}assets/board3d/`,
    private load = (ac: BaseAudioContext, url: string) => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer() }).then(b => ac.decodeAudioData(b)),
    private context = () => new AudioContext()) {}

  /** The loop to hear (a Look.ambient path), or null for silence; the change crossfades over AMBIENT_FADE. */
  play(path: string | null | undefined) {
    const url = path ? this.base + path : null
    if (url === this.url) return
    this.url = url
    if (!url && !this.ac) return // never heard anything: nothing to set up
    void this.apply()
  }

  private async apply() {
    const g = ++this.gen, url = this.url
    let ac: AudioContext
    try { ac = this.ac ??= this.wire(this.context()) } catch { return } // no audio device: stay silent
    if (url && !document.hidden && ac.state === 'suspended') void ac.resume().catch(() => {})
    if (document.hidden && ac.state === 'running') void ac.suspend().catch(() => {})
    if (this.voice?.url === url) return
    if (this.voice) { this.fade(this.voice, 0, true); this.voice = null }
    if (!url) { setTimeout(() => { if (!this.url) void ac.suspend().catch(() => {}) }, AMBIENT_FADE * 1000 + 200); return } // silent: let the context sleep
    if (this.buf?.url !== url) this.buf = { url, data: this.load(ac, url).catch(e => (console.warn('ambience', e), null)) } // the previous buffer goes with its voice
    const data = await this.buf.data
    if (!data || g !== this.gen) return // failed, or the décor changed again while loading
    const src = ac.createBufferSource(), gain = ac.createGain()
    src.buffer = data; src.loop = true
    ;[src.loopStart, src.loopEnd] = loopBounds(data.getChannelData(0), data.sampleRate)
    gain.gain.value = 0
    src.connect(gain).connect(ac.destination)
    src.start(ac.currentTime, src.loopStart)
    this.voice = { url, src, gain }
    this.fade(this.voice, AMBIENT_LEVEL, false)
  }

  /** Ramps a voice from where it is now (a fade cut short starts from its current gain); `stop` ends it at the bottom. */
  private fade({ src, gain }: Voice, to: number, stop: boolean) {
    // short linear segments along the curve: unlike setValueCurveAtTime they can be cancelled anywhere, in every engine
    const t = this.ac!.currentTime, p = gain.gain, c = fadeCurve(p.value, to, 16)
    p.cancelScheduledValues(t); p.setValueAtTime(c[0], t)
    for (let i = 1; i < c.length; i++) p.linearRampToValueAtTime(c[i], t + AMBIENT_FADE * i / (c.length - 1))
    if (stop) src.stop(t + AMBIENT_FADE + 0.05)
  }

  /** Hidden window: the context sleeps (the loop holds its place); shown again: it resumes if something is to be heard. */
  private wire(ac: AudioContext) {
    if (!this.wired) {
      this.wired = true
      const wake = () => { if (this.url && !document.hidden && this.ac?.state === 'suspended') void this.ac.resume().catch(() => {}) }
      document.addEventListener('visibilitychange', () => document.hidden ? void this.ac?.suspend().catch(() => {}) : wake())
      addEventListener('pointerdown', wake) // a context made before any gesture starts suspended: the first click lets it play
    }
    return ac
  }
}
