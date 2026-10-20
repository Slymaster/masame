// Japanese set: Nachiguro slate (black) and Hyuga clamshell (white), symmetric biconvex. Materials: japonaise.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, // slate 22.2 mm, shell 21.9 mm across
  shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78,
  snd: { rate: 1, lowpass: 1, gain: 1 },
  skin2d: {
    black: [[92, 92, 98], [54, 54, 59], [24, 24, 27], [13, 13, 15]],
    white: [[255, 254, 249], [246, 241, 230], [229, 221, 205], [212, 202, 184]],
    marks: { black: 'none', white: 'growth' },
  },
} satisfies StoneData
