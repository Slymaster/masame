// Where the board sits beside the floating card, for both renderers.

/**
 * Horizontal shift (whole px) that centres a board drawn over [left, right] on the window centre cx, with the card open:
 * never past the frame's right edge maxRight (the gap to the card stays), never leftwards (a narrow window keeps today's place).
 */
export const centreShift = (left: number, right: number, maxRight: number, cx: number) =>
  Math.round(Math.max(0, Math.min(cx - (left + right) / 2, maxRight - right)))
