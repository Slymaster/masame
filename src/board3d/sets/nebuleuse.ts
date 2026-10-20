// Nebula: an imagined set, no go tradition behind it (docs/stones-and-scenes.md). Deep space under a clear glossy dome
// (black), a pale lavender nebula (white), symmetric biconvex like the Japanese set. Earned by reviewing a whole game.
// Materials: nebuleuse.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78, // the Japanese shape
  snd: { rate: 1.07, lowpass: 1.3, gain: 0.95 }, // a hard polished dome: a clear, slightly brighter click
  skin2d: {
    // deep space: a blue-violet black under a crisp glossy highlight, a few small stars
    black: [[44, 40, 62], [20, 18, 32], [9, 8, 15], [5, 5, 9]],
    // pale nebula: lavender white, a little deeper towards the rim
    white: [[253, 251, 255], [244, 239, 252], [229, 221, 245], [232, 226, 247]],
    marks: { black: 'stars', white: 'stars' },
    finish: {
      black: { mark: { color: [236, 238, 255], amount: 0.9, scale: 0.8, count: 0.8 }, highlight: { strength: 0.32, size: 0.3, color: [240, 240, 255] } },
      white: {
        rim: { color: [214, 200, 246], strength: 0.35, width: 0.3 },
        mark: { color: [150, 128, 214], amount: 0.55, scale: 0.7, count: 0.45 },
        highlight: { strength: 0.62, size: 0.34, color: [255, 252, 255] },
      },
    },
  },
  rare: 'review',
} satisfies StoneData
