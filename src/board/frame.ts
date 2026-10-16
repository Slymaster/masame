// Where the board sits beside the floating card, for both renderers; how a tap on the board plays.

/**
 * Horizontal shift (whole px) that centres a board drawn over [left, right] on the window centre cx, with the card open:
 * never past the frame's right edge maxRight (the gap to the card stays), never leftwards (a narrow window keeps today's place).
 */
export const centreShift = (left: number, right: number, maxRight: number, cx: number) =>
  Math.floor(Math.max(0, Math.min(cx - (left + right) / 2, maxRight - right))) // floor: no shift for a sub-pixel offset, never past the edge

type V = readonly [number, number]
/**
 * A tap on point v, with the ghost stone shown at `ghost`. A mouse plays at once (its ghost follows the hover); a finger
 * or a pen places in two steps, since it has no hover and covers the point: the first tap shows the ghost, a tap on
 * the ghost plays it, a tap elsewhere moves it.
 */
export function tap(ghost: V | null, v: V, pointer: string): { play: boolean; ghost: V | null } {
  if (pointer === 'mouse') return { play: true, ghost }
  return ghost?.[0] === v[0] && ghost[1] === v[1] ? { play: true, ghost: null } : { play: false, ghost: v }
}
