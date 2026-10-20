// Amber and ebony: a pairing of materials, no go tradition behind it (docs/stones-and-scenes.md). Polished ebony (black),
// pale honey amber (white), symmetric biconvex like the Japanese set. Materials: ambre.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78, // the Japanese shape
  snd: { rate: 0.92, lowpass: 0.62, gain: 0.9 }, // wood and resin on wood: a lower, softer, warmer tock
  skin2d: {
    // ebony: a dark brown-black, its warm highlight; the grain long, fine and faint
    black: [[84, 72, 64], [46, 38, 33], [22, 17, 14], [12, 9, 8]],
    // honey amber, pale enough to read as the white: lighter at the core, a deeper gold towards the rim
    white: [[255, 248, 222], [250, 232, 182], [238, 206, 140], [228, 186, 112]],
    marks: { black: 'veins', white: 'bubbles' },
    finish: {
      black: { mark: { color: [70, 56, 46], amount: 0.45, scale: 0.5, count: 3 }, highlight: { strength: 0.2, color: [255, 228, 196] } },
      white: {
        stops: [0, 0.45, 0.85, 1],
        rim: { color: [255, 214, 120], strength: 0.4, width: 0.3 }, // light coming back out through the thin rim
        mark: { color: [176, 128, 52], amount: 0.8, scale: 0.8, count: 0.6 },
        highlight: { strength: 0.6, size: 0.36, color: [255, 252, 240] },
      },
    },
  },
} satisfies StoneData
