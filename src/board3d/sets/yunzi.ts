// Yunzi (Yunnan): single convex, flat underneath and domed on top, matte; the black slightly larger. Materials: yunzi.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.0, rW: 10.9, // about 22 mm across (Sensei's Yunzi: 21–22, the black a little larger)
  shTop: 6.8, shBot: 0.8, expTop: 0.7, expBot: 0.25, // 7.6 mm thick: a dome on a nearly flat, round-edged base
  // heavier than slate and shell, a louder, brighter snap: a touch higher and more open, a little louder
  snd: { rate: 1.05, lowpass: 1.3, gain: 1.15 },
  skin2d: {
    // centre → rim: a near-black body that only turns green at the edge, as yunzi does against the light
    black: [[48, 52, 50], [28, 31, 30], [16, 18, 18], [12, 20, 17]],
    // eggshell: warm, soft, no growth lines
    white: [[250, 248, 239], [243, 239, 226], [229, 223, 205], [212, 205, 184]],
    marks: { black: 'none', white: 'none' },
    finish: { // matte: a wide, faint highlight on both
      black: { rim: { color: [20, 88, 62], strength: 0.24, width: 0.55 }, highlight: { strength: 0.07, size: 0.62 } },
      white: { highlight: { strength: 0.28, size: 0.6, color: [255, 252, 244] } },
    },
  },
} satisfies StoneData
