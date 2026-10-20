// Yunzi (Yunnan): single convex, flat underneath and domed on top, matte; the black slightly larger. Materials: yunzi.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 11.0, rW: 10.9, // about 22 mm across (Sensei's Yunzi: 21–22, the black a little larger)
  shTop: 6.8, shBot: 0.8, expTop: 0.7, expBot: 0.25, // 7.6 mm thick: a dome on a nearly flat, round-edged base
  // heavier than slate and shell, a louder, brighter snap: a touch higher and more open, a little louder
  snd: { rate: 1.05, lowpass: 1.3, gain: 1.15 },
  skin2d: {
    // centre → rim: a soft dull highlight, green-black body, a dark emerald edge
    black: [[74, 82, 79], [40, 47, 45], [18, 23, 22], [16, 34, 30]],
    // eggshell: warm, soft, no growth lines
    white: [[251, 249, 240], [242, 238, 224], [228, 222, 203], [214, 207, 186]],
    marks: { black: 'none', white: 'none' },
  },
} satisfies StoneData
