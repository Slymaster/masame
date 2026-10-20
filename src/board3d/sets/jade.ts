// Jade set: white "mutton-fat" nephrite and dark spinach jade, symmetric biconvex. Materials: jade.gl.ts.
// No maker gives jade stone dimensions: the shape is ours, a touch fuller than the Japanese lens.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.05, rW: 11.0,
  shTop: 4.8, shBot: 4.8, expTop: 0.78, expBot: 0.78,
  snd: { rate: 1.06, lowpass: 1.25, gain: 1 }, // jade on wood rings a little brighter than slate
  skin2d: {
    // spinach jade: very dark green, fine pale veins, green at the thin rim; mutton fat: warm cream with soft veils
    black: [[40, 56, 46], [20, 30, 24], [11, 17, 13], [8, 14, 10]],
    white: [[252, 248, 234], [244, 237, 216], [230, 220, 192], [212, 200, 168]],
    marks: { black: 'veins', white: 'veins' },
    finish: {
      black: { rim: { color: [38, 124, 72], strength: 0.28, width: 0.4 }, highlight: { strength: 0.22, size: 0.42 },
               mark: { color: [96, 148, 112], amount: 0.6, scale: 0.6, count: 1.3 } },
      white: { highlight: { strength: 0.42, size: 0.48, color: [255, 252, 240] },
               mark: { color: [196, 182, 144], amount: 0.9, scale: 3.2, count: 0.8 } },
    },
  },
} satisfies StoneData
