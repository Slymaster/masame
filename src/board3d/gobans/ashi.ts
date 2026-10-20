import type { ShapeData } from '../gobans'

// The Japanese floor goban (ashitsuki goban), research in .claude/research/gobans.md: the whole board 42.4 × 45.5 cm
// (dims() gives the same), a solid block of 50 gō (14.5 cm, sold as 5 sun; 5–6 sun are the most popular), on four
// detachable legs about 12 cm high (4 sun), set in from the corners: the total height is 26.5 cm, as Tengudo's 50 gō
// board. The legs are carved after the gardenia fruit (kuchinashi): an oblong body with sharp ridges (the fruit has five
// to seven) over a small foot, a narrow neck into the block. The leg's width is not sourced: ours is 8.6 cm at its widest.
export default {
  thickness: 145,
  round: 1.6,
  legs: {
    height: 120,
    profile: [[0, 0], [22, 0], [24.5, 1.8], [24, 7], [19.5, 13], [24.5, 22], [34, 37], [41.5, 54], [43, 67], [40.5, 81], [33.5, 94], [26, 104], [22.5, 109], [26, 111.5], [26.5, 117], [24, 120]],
    inset: [64, 68],
    ridges: 6, depth: 0.12, sharp: true,
  },
} satisfies ShapeData
