// Jade set: white "mutton-fat" nephrite and dark spinach jade, symmetric biconvex. Materials: jade.gl.ts.
// No maker gives jade stone dimensions: the shape is ours, a touch fuller than the Japanese lens.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.05, rW: 11.0,
  shTop: 4.8, shBot: 4.8, expTop: 0.78, expBot: 0.78,
  snd: { rate: 1.06, lowpass: 1.25, gain: 1 }, // jade on wood rings a little brighter than slate
  skin2d: {
    black: [[62, 84, 70], [32, 46, 38], [16, 24, 19], [9, 13, 11]],
    white: [[254, 252, 242], [244, 239, 222], [228, 220, 196], [210, 200, 172]],
    marks: { black: 'veins', white: 'veins' },
  },
} satisfies StoneData
