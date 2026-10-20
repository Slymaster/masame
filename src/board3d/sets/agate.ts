// Agate and onyx: polished semi-precious stones, symmetric biconvex and a little thicker than the Japanese (one maker lists
// about 21.5–22 × 10 mm); a deep black banded onyx and a milky chalcedony with faint blue-grey bands. Materials: agate.gl.ts.
import type { StoneData } from '../stoneSets'

export default {
  rB: 10.9, rW: 10.9, // 21.8 mm across
  shTop: 4.9, shBot: 4.9, expTop: 0.74, expBot: 0.74, // 9.8 mm thick, a fuller dome than slate and shell
  snd: { rate: 1.06, lowpass: 1.35, gain: 0.95 }, // hard polished stone on wood: a little higher and brighter than slate
  skin2d: {
    // centre → rim: a deep black under a crisp polish
    black: [[66, 68, 72], [26, 27, 30], [9, 9, 11], [5, 5, 7]],
    // milky chalcedony: a soft cool white, the thin rim a touch greyer where it turns translucent
    white: [[252, 252, 251], [242, 243, 244], [226, 229, 233], [232, 235, 239]],
    marks: { black: 'bands', white: 'bands' },
    finish: {
      black: { mark: { color: [74, 76, 82], amount: 0.68, scale: 1.4, count: 0.7 }, highlight: { strength: 0.3, size: 0.34, color: [255, 252, 246] } },
      white: {
        mark: { color: [118, 136, 160], amount: 0.45, scale: 1.4, count: 0.7 },
        rim: { color: [214, 224, 236], strength: 0.3, width: 0.3 },
        highlight: { strength: 0.62, size: 0.34 },
      },
    },
  },
} satisfies StoneData
