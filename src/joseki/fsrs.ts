// FSRS-4.5 (Open Spaced Repetition, MIT): its default weights and formulas, as given in the algorithm wiki
// (awesome-fsrs/wiki/The-Algorithm) and the fsrs4anki v4.5.0 scheduler. The trainer never rates Easy.

export const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755]
const DECAY = -0.5, FACTOR = 19 / 81
export const DAY = 86_400_000, RELEARN = 10 * 60_000
export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy

/** One position's memory: stability (days), difficulty (1–10), due and last review (ms). */
export interface Card { s: number; d: number; due: number; last: number; reps: number; lapses: number }

/** Probability of recall after `days`; 0.9 when days = s, so at 90 % retention the interval is s days. */
export const recall = (days: number, s: number) => (1 + FACTOR * days / s) ** DECAY
const clampD = (d: number) => Math.min(10, Math.max(1, d))
const d0 = (g: Rating) => clampD(W[4] - (g - 3) * W[5])

export function review(c: Card | undefined, g: Rating, now: number): Card {
  let s: number, d: number
  if (!c) { s = W[g - 1]; d = d0(g) } else {
    const r = recall(Math.max(0, now - c.last) / DAY, c.s)
    d = clampD(W[7] * W[4] + (1 - W[7]) * (c.d - W[6] * (g - 3))) // mean reversion towards D0(Good)
    s = g === 1 ? Math.min(c.s, W[11] * d ** -W[12] * ((c.s + 1) ** W[13] - 1) * Math.exp(W[14] * (1 - r)))
      : c.s * (Math.exp(W[8]) * (11 - d) * c.s ** -W[9] * (Math.exp(W[10] * (1 - r)) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1) + 1)
  }
  const due = now + (g === 1 ? RELEARN : Math.max(1, Math.round(s)) * DAY)
  return { s, d, due, last: now, reps: (c?.reps ?? 0) + 1, lapses: (c?.lapses ?? 0) + (g === 1 ? 1 : 0) }
}
