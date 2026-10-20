// Ember and ice: an imagined set, no go tradition behind it (docs/stones-and-scenes.md). Cooled lava with a few thin glowing
// cracks (black), blue-white ice with bright fracture planes (white), symmetric biconvex like the Japanese set.
// Earned by solving a tsumego from your games. Materials: braise.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78, // the Japanese shape
  snd: { rate: 0.86, lowpass: 0.55, gain: 0.88 }, // porous rock and ice on wood: a deeper, softer tock
  skin2d: {
    // basalt: a dull warm black, barely any highlight; three thin orange cracks
    black: [[62, 58, 56], [32, 30, 29], [17, 16, 16], [10, 10, 10]],
    // ice: a bright cool white, a little bluer towards the frosty rim
    white: [[252, 254, 255], [240, 246, 252], [222, 234, 246], [230, 240, 250]],
    marks: { black: 'cracks', white: 'veins' },
    finish: {
      black: { mark: { color: [255, 126, 48], amount: 1, scale: 1.4, count: 1.3 }, highlight: { strength: 0.1, size: 0.55 } },
      white: {
        rim: { color: [214, 232, 252], strength: 0.45, width: 0.28 }, // the frost catching the light
        mark: { color: [150, 186, 222], amount: 0.45, scale: 0.7, count: 1.3 }, // the fracture planes, seen edge-on
        highlight: { strength: 0.6, size: 0.36, color: [250, 253, 255] },
      },
    },
  },
  rare: 'tsumego',
} satisfies StoneData
