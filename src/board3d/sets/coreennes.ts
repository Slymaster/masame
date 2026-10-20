// Korean glass: modern hardened-glass stones, 22 mm across, 9.5 mm (black) / 9.3 mm (white) thick, symmetric biconvex,
// high lustre (docs/stones-and-scenes.md). Thicker and fuller than the Japanese set. Materials: coreennes.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.0, rW: 11.0, // 22 mm across
  shTop: 4.7, shBot: 4.7, expTop: 0.7, expBot: 0.7, // 9.4 mm: the shape is shared, between the 9.5 black and 9.3 white
  snd: { rate: 1.12, lowpass: 1.6, gain: 0.92 }, // glass on wood: higher, brighter, a touch lighter
  skin2d: {
    black: [[86, 90, 96], [34, 36, 40], [10, 11, 13], [4, 6, 8]],
    white: [[255, 255, 253], [246, 245, 240], [232, 230, 224], [244, 242, 236]],
    marks: { black: 'none', white: 'none' },
  },
} satisfies StoneData
