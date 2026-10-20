// Moonstone and obsidian: an imagined pairing, no go tradition behind it (docs/stones-and-scenes.md). Obsidian (black), a
// volcanic glass with a mirror lustre; moonstone (white), milky, with a soft blue sheen that moves with the light
// (adularescence). Symmetric biconvex like the Japanese set. Earned with a 7-day streak. Materials: lune.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78, // the Japanese shape
  snd: { rate: 0.97, lowpass: 0.9, gain: 0.95, place: 'verre/place.mp3' }, // glass on wood, a shade rounder than blown glass
  skin2d: {
    // obsidian: deep black with a small, sharp mirror highlight and a faint smoky-brown rim
    black: [[34, 32, 31], [14, 13, 13], [6, 6, 6], [3, 3, 3]],
    // moonstone: a cool milky white, a little deeper at the rim, the blue sheen drifting across it
    white: [[250, 251, 252], [240, 242, 245], [226, 230, 236], [212, 217, 226]],
    marks: { black: 'none', white: 'sheen' },
    finish: {
      black: { rim: { color: [112, 82, 60], strength: 0.18, width: 0.16 }, highlight: { strength: 0.8, size: 0.2 } },
      white: {
        stops: [0, 0.45, 0.85, 1],
        rim: { color: [214, 224, 242], strength: 0.3, width: 0.3 },
        mark: { color: [140, 182, 255], amount: 1.4, scale: 0.75 },
        highlight: { strength: 0.85, size: 0.24 },
      },
    },
  },
  rare: 'streak7',
} satisfies StoneData
