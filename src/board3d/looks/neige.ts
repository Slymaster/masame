import type { Look } from '../logic'

// A winter night on a veranda: no window key, the andon's warm paper glow (the lamp, low and to the left, so it reads as
// standing beside the board), and the cold blue of the snow-lit garden in the environment (birchwood graded to night).
// The hour has no effect (a fixed tod, like the Lanterne).
export default {
  sky: 'neige/birchwood_night', skyAz: 5.06, tod: { az: 200, el: 40, K: 2400, I: 0, env: 0.5, exp: 1, room: 0 },
  ground: 'walnut', tint: 0.5, rough: 0.8, fade: false, linen: false,
  key: 0, ibl: 0.45, exp: 1.6, soft: 1.6, shade: 0.9, lamp: 5, shoji: 0,
  woodWarm: 1, skin: 'laque', tiltMax: (80 * Math.PI) / 180, ambient: 'neige/wind.mp3',
} satisfies Look
