// Blown glass: an imagined set, no go tradition behind it (docs/stones-and-scenes.md). Smoked glass (black), dark
// grey-brown and translucent at the rim, with a few tiny trapped bubbles; opal glass (white) with soft milky swirls inside.
// A little fuller than the Japanese lens, like glass stones. Materials: verre.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.0, rW: 10.9, shTop: 4.7, shBot: 4.7, expTop: 0.72, expBot: 0.72, // 22 mm across, 9.4 mm thick
  snd: { rate: 1.04, lowpass: 1, gain: 1, place: 'verre/place.mp3' }, // glass on wood: marbles set down on a desk
  skin2d: {
    // smoked glass: a dark grey-brown, lighter where it thins at the rim; a few bubbles catch the light
    black: [[64, 54, 46], [32, 27, 23], [17, 14, 12], [12, 10, 8]],
    // opal glass: milky white, a touch cooler in the swirls
    white: [[251, 250, 246], [242, 241, 236], [228, 227, 221], [216, 215, 209]],
    marks: { black: 'bubbles', white: 'veins' },
    finish: {
      black: {
        rim: { color: [122, 92, 64], strength: 0.32, width: 0.26 },
        mark: { color: [206, 192, 172], amount: 0.9, scale: 1.3, count: 0.6 },
        highlight: { strength: 0.75, size: 0.2 },
      },
      white: {
        rim: { color: [236, 232, 220], strength: 0.25, width: 0.3 },
        mark: { color: [196, 204, 216], amount: 0.45, scale: 6, count: 1.6 },
        highlight: { strength: 0.95, size: 0.22 },
      },
    },
  },
} satisfies StoneData
