// The opponent's hand in the app (Workshop option): hand.ts and the downloaded model, loaded once per session on first
// need, and the bot's move timed so its stone lands when it would have without the hand.
import type { Vertex } from '@sabaki/go-board'
import type { Board3D } from './board3d/Board3D'
import type { OpponentHand } from './board3d/hand'
import { handBytes } from './handAsset'

/** The gesture's fastest pace: up to the handoff, it may play this much faster than its natural timeline. */
export const MIN_K = 0.55
/** ms from the decision: when the gesture starts, when its stone lands, and k, the share of its natural time it takes up
 *  to the handoff. It lands when the stone would have without the hand (after wait); a shorter wait plays the gesture
 *  faster (k < 1), down to MIN_K, so the stone lands at max(wait, handoffMs·MIN_K). */
export function handTiming(wait: number, handoffMs: number) {
  const k = Math.min(1, Math.max(MIN_K, wait / handoffMs)), lead = handoffMs * k
  return { start: Math.max(0, wait - lead), land: Math.max(wait, lead), k }
}

let loading: Promise<OpponentHand> | null = null
/** hand.ts (a lazy chunk) and the verified model, built once; a failure is forgotten so a retry loads again. */
export function loadHand() {
  return (loading ??= Promise.all([import('./board3d/hand'), handBytes()])
    .then(([m, glb]) => m.OpponentHand.load(glb))
    .catch(e => { loading = null; throw e }))
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Waits out the bot's natural delay (wait, ms) while the hand plays v. Resolves at the handoff, or at the stone's planned
 *  landing if the hand is stopped first (Study, the option off) or ok() is false when the gesture is due. A handoff
 *  that never comes (a hidden window pauses the frames the gesture runs on) puts the hand away LATE ms after the landing. */
export async function handMove(h: OpponentHand, view: Board3D, v: Vertex, wait: number, ok: () => boolean) {
  const { start, land, k } = handTiming(wait, h.handoffMs), end = performance.now() + land
  if (start > 0) await sleep(start)
  if (ok()) {
    view.setThinking(false) // the stirring in the bowl stops as his hand reaches for it
    let late: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>(handoff => {
      late = setTimeout(() => h.stop(), end + LATE - performance.now())
      void h.play(view, v, handoff, k).then(handoff)
    })
    clearTimeout(late)
  }
  const left = end - performance.now()
  if (left > 0) await sleep(left)
}
export const LATE = 600
