// Synthesized wood clack: a short band-passed noise burst (stone on kaya) plus a low falling sine (board body).
// A stone set's voice (StoneData.snd) scales it: rate (pitch and speed), a low-pass cutoff, and gain; 1, 1, 1 = the slate and shell.

import type { StoneData } from '../board3d/stoneSets'

type Snd = StoneData['snd']
const PLAIN: Snd = { rate: 1, lowpass: 1, gain: 1 }
/** The cutoff a lowpass multiplier of 1 stands for: above everything the clack has, so 1 adds no filter at all. */
export const LOWPASS_HZ = 12000

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

/** Where a voice connects: the destination, or a low-pass in front of it when the set dulls its stones. */
function out(c: BaseAudioContext, snd: Snd): AudioNode {
  if (snd.lowpass >= 1) return c.destination
  const f = c.createBiquadFilter()
  f.type = 'lowpass'; f.frequency.value = LOWPASS_HZ * snd.lowpass
  f.connect(c.destination)
  return f
}

function burst(c: BaseAudioContext, to: AudioNode, t0: number, freq: number, q: number, decay: number, gain: number, buf = noise) {
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
  s.buffer = buf
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = q
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.002)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  s.connect(f).connect(g).connect(to)
  s.start(t0, Math.random() * 0.5) // random offset: no two clacks are identical
  s.stop(t0 + decay + 0.02)
}

function tone(c: BaseAudioContext, to: AudioNode, t0: number, f0: number, f1: number, decay: number, gain: number) {
  const o = c.createOscillator(), g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(f0, t0)
  o.frequency.exponentialRampToValueAtTime(f1, t0 + decay)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay)
  o.connect(g).connect(to)
  o.start(t0)
  o.stop(t0 + decay + 0.02)
}

/** The two sounds on any context (exported for an offline render); rate raises pitch and shortens the decays. */
export function tap(c: BaseAudioContext, t: number, snd: Snd = PLAIN, buf = noise) {
  const o = out(c, snd), { rate: k, gain: v } = snd
  burst(c, o, t, 3600 * k, 4, 0.03 / k, 0.3 * v, buf)
  tone(c, o, t, 3600 * k, 3400 * k, 0.03 / k, 0.1 * v)
}
export function clack(c: BaseAudioContext, t: number, snd: Snd = PLAIN, buf = noise) {
  const o = out(c, snd), { rate: k, gain: v } = snd
  burst(c, o, t, 2500 * k, 1.6, 0.045 / k, 0.9 * v, buf)
  tone(c, o, t, 200 * k, 150 * k, 0.06 / k, 0.45 * v)
}

/** A soft high tap (the bot passing): a short bright noise burst over a faint sine. */
export function playTap(snd: Snd = PLAIN) {
  let c: AudioContext
  try { c = context() } catch { return }
  tap(c, c.currentTime + 0.005, snd)
}

export function playClack(snd: Snd = PLAIN) {
  let c: AudioContext
  try { c = context() } catch { return } // no audio device: stay silent
  clack(c, c.currentTime + 0.005, snd)
}
