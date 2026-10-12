// Synthesized wood clack: a short band-passed noise burst (stone on kaya) plus a low falling sine (board body).

let ac: AudioContext | null = null
let noise: AudioBuffer | null = null

function context(): AudioContext {
  if (!ac) {
    ac = new AudioContext()
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate)
    const ch = noise.getChannelData(0)
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1
  }
  if (ac.state === 'suspended') void ac.resume()
  return ac
}

function burst(c: AudioContext, t0: number, freq: number, q: number, decay: number, gain: number) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
  s.buffer = noise
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = q
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  s.connect(f).connect(g).connect(c.destination)
  s.start(t0, Math.random() * 0.5) // random offset: no two clacks are identical
  s.stop(t0 + decay + 0.02)
}

function tone(c: AudioContext, t0: number, f0: number, f1: number, decay: number, gain: number) {
  const o = c.createOscillator(), g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f0, t0)
  o.frequency.exponentialRampToValueAtTime(f1, t0 + decay)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  o.connect(g).connect(c.destination)
  o.start(t0)
  o.stop(t0 + decay + 0.02)
}

/** A soft high tap (the bot passing): a short bright noise burst over a faint sine. */
export function playTap() {
  let c: AudioContext
  try { c = context() } catch { return }
  const t = c.currentTime + 0.005
  burst(c, t, 3600, 4, 0.03, 0.3)
  tone(c, t, 3600, 3400, 0.03, 0.1)
}

export function playClack() {
  let c: AudioContext
  try { c = context() } catch { return } // no audio device: stay silent
  const t = c.currentTime + 0.005
  burst(c, t, 2500, 1.6, 0.045, 0.9)
  tone(c, t, 200, 150, 0.06, 0.45)
}
