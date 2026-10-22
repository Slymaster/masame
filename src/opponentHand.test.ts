import { describe, expect, it, vi } from 'vitest'
import type { Board3D } from './board3d/Board3D'
import type { OpponentHand } from './board3d/hand'
import { handMove, handTiming, handWanted, LATE, MIN_K } from './opponentHand'

describe('handTiming', () => {
  it('starts the gesture at its natural pace so its handoff lands at the end of the natural delay', () => {
    expect(handTiming(5000, 1940)).toEqual({ start: 3060, land: 5000, k: 1 })
    expect(handTiming(1940, 1940)).toEqual({ start: 0, land: 1940, k: 1 })
  })
  it('plays faster on a shorter delay, the stone landing on time', () => {
    expect(handTiming(1200, 1940)).toEqual({ start: 0, land: 1200, k: 1200 / 1940 })
  })
  it('never faster than MIN_K: a quick move lands handoffMs·MIN_K in', () => {
    const fastest = { start: 0, land: 1940 * MIN_K, k: MIN_K }
    expect(handTiming(500, 1940)).toEqual(fastest)
    expect(handTiming(0, 1940)).toEqual(fastest)
    expect(handTiming(-300, 1940)).toEqual(fastest) // the engine took longer than the delay
  })
})

describe('handMove', () => {
  it('puts the hand away and lets the move land when the handoff never comes (frames paused)', async () => {
    vi.useFakeTimers()
    try {
      let done = () => {}
      const h = { handoffMs: 1940, play: vi.fn((..._: unknown[]) => new Promise<void>(r => { done = r })), stop: vi.fn(() => done()) } // never ticks
      const view = { setThinking: vi.fn() }
      let landed = false
      void handMove(h as unknown as OpponentHand, view as unknown as Board3D, [3, 3], 1940, () => true).then(() => { landed = true })
      await vi.advanceTimersByTimeAsync(1940 + LATE - 50)
      expect(landed).toBe(false)
      expect(h.stop).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(h.stop).toHaveBeenCalledOnce()
      expect(landed).toBe(true)
      expect(h.play.mock.calls[0][3]).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('resolves at the handoff, the timer cleared', async () => {
    vi.useFakeTimers()
    try {
      const h = { handoffMs: 1940, play: vi.fn((_v: unknown, _p: unknown, handoff: () => void, _k: number) => { setTimeout(handoff, 1940 * MIN_K); return new Promise<void>(() => {}) }), stop: vi.fn() }
      let landed = false
      void handMove(h as unknown as OpponentHand, { setThinking() {} } as unknown as Board3D, [3, 3], 500, () => true).then(() => { landed = true })
      await vi.advanceTimersByTimeAsync(1940 * MIN_K + 1)
      expect(landed).toBe(true)
      expect(h.play.mock.calls[0][3]).toBe(MIN_K)
      await vi.advanceTimersByTimeAsync(5000)
      expect(h.stop).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
})

describe('handWanted', () => {
  const on = { opponentHand: true, mobile: false, renderer: '3d', camera: 'contemplation', delay: true, opponent: 'ai', color: 'b', reducedMotion: false }
  it('fetches the hand when it could play: the option on, 3D Contemplation on a desktop, thinking time, against the AI', () => {
    expect(handWanted(on)).toBe(true)
    expect(handWanted({ ...on, color: 'r' })).toBe(true) // a random colour may give the AI White
  })
  it('not when any of them is missing', () => {
    for (const off of [{ opponentHand: false }, { mobile: true }, { renderer: '2d' }, { camera: 'study' }, { delay: false }, { opponent: 'human' }, { opponent: 'ogs' }, { color: 'w' }, { reducedMotion: true }])
      expect(handWanted({ ...on, ...off }), JSON.stringify(off)).toBe(false)
  })
})
