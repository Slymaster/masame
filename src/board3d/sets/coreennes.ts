// Korean glass: modern hardened-glass stones, 22 mm across, 9.5 mm (black) / 9.3 mm (white) thick, symmetric biconvex,
// high lustre (docs/stones-and-scenes.md). Thicker and fuller than the Japanese set. Materials: coreennes.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.0, rW: 11.0, // 22 mm across
  shTop: 4.7, shBot: 4.7, expTop: 0.7, expBot: 0.7, // 9.4 mm: the shape is shared, between the 9.5 black and 9.3 white
  snd: { rate: 1.12, lowpass: 1.6, gain: 0.92 }, // glass on wood: higher, brighter, a touch lighter
  skin2d: {
    // deep black glass and milky white glass; the gloss is a small, sharp highlight
    black: [[30, 32, 36], [13, 14, 16], [6, 7, 8], [3, 4, 5]],
    white: [[249, 249, 246], [238, 238, 234], [220, 220, 215], [208, 208, 202]],
    marks: { black: 'none', white: 'none' },
    finish: {
      black: { rim: { color: [130, 140, 152], strength: 0.16, width: 0.14 }, highlight: { strength: 0.75, size: 0.2 } },
      white: { highlight: { strength: 1, size: 0.22 } },
    },
  },
} satisfies StoneData
