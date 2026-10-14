import { describe, expect, it } from 'vitest'
import { centreShift } from './frame'

describe('centreShift', () => {
  // 1920 px window, a 1400 px wide frame from 56 px (the card on the right): a 600 px board is centred at 756 today
  it('centres the board on the window when the frame leaves room', () => {
    expect(centreShift(456, 1056, 1456, 960)).toBe(204)
  })
  it('stops at the frame edge, keeping the gap to the card', () => {
    expect(centreShift(156, 1356, 1456, 960)).toBe(100)
  })
  it('never moves left, and leaves a board that fills its frame alone', () => {
    expect(centreShift(1000, 1200, 1456, 960)).toBe(0)
    expect(centreShift(56, 1456, 1456, 960)).toBe(0)
  })
  it('changes nothing when the frame is already centred (card hidden)', () => {
    expect(centreShift(560, 1360, 1864, 960)).toBe(0)
    expect(centreShift(559.5, 1359.5, 1864, 960)).toBe(0) // a rounded frame half a pixel left of the window centre
  })
  it('rounds down, so it never passes the edge', () => {
    expect(centreShift(456, 1056, 1066.6, 960)).toBe(10)
  })
})
