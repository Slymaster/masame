// Bronze and silver: an imagined, earned set (10 finished games), no go tradition behind it (docs/stones-and-scenes.md).
// Dark patinated bronze (black), satin hand-polished silver (white), the Japanese shape. Materials: bronze.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.1, rW: 10.95, shTop: 4.5, shBot: 4.5, expTop: 0.78, expBot: 0.78, // the Japanese shape
  snd: { rate: 1.16, lowpass: 1, gain: 0.92 }, // metal on wood: a shorter, brighter tock
  skin2d: {
    // bronze: a deep olive brown, lighter where it catches the light
    black: [[104, 86, 60], [62, 50, 34], [34, 28, 19], [20, 17, 12]],
    // silver: a cool bright grey, never darker than a light shell
    white: [[252, 253, 255], [236, 238, 242], [214, 217, 223], [192, 196, 204]],
    marks: { black: 'sheen', white: 'sheen' },
    finish: {
      black: { mark: { color: [196, 150, 92], amount: 0.9, scale: 0.8 }, highlight: { strength: 0.32, size: 0.34, color: [255, 214, 160] } },
      white: { mark: { color: [168, 180, 202], amount: 1.3, scale: 0.9 }, highlight: { strength: 0.75, size: 0.3, color: [250, 252, 255] } },
    },
  },
  rare: 'games10',
} satisfies StoneData
