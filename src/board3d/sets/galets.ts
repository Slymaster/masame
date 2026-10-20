// River pebbles: flat, unworked natural stones (the oldest go stones in China, Korea and Japan were 14–24 mm, 2–6 mm thick,
// docs/stones-and-scenes.md), drawn larger so they read on a modern board. A low, full lens; each stone's outline and top
// are made uneven in its vertex shader (galets.gl.ts), within 0.8 mm, so this lens still places and picks it.
import type { StoneData } from '../stoneSets'

export default {
  rB: 10.7, rW: 10.6, // about 21 mm across
  shTop: 3.4, shBot: 2.9, expTop: 0.55, expBot: 0.5, // 6.3 mm thick: flat faces, rounded edges, the top a little higher
  // pebbles on wood, cut from a recording: a little lower and duller than slate on kaya
  snd: { rate: 0.94, lowpass: 0.85, gain: 0.85, place: 'galets/place.mp3' },
  skin2d: {
    // centre → rim: dark shale with a soft water-polished sheen; pale cream-grey sandstone with a greyer edge
    black: [[70, 70, 68], [44, 44, 43], [27, 27, 27], [20, 20, 20]],
    white: [[236, 232, 220], [226, 221, 207], [212, 206, 191], [196, 190, 176]],
    marks: { black: 'speckles', white: 'speckles' },
    finish: {
      black: { highlight: { strength: 0.1, size: 0.62 }, mark: { color: [120, 118, 112], amount: 0.8, count: 1.4 }, stops: [0, 0.38, 0.8, 1] },
      white: { highlight: { strength: 0.22, size: 0.55 }, mark: { color: [110, 98, 82], amount: 0.9, count: 1.6 }, stops: [0, 0.4, 0.82, 1] },
    },
  },
} satisfies StoneData
