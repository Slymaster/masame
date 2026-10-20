import type { Look } from '../logic'

// A scholar's open pavilion by a garden pond, in daylight (the light follows the hour). chinese_garden lights the stones
// (the scene shows the garden, pre-blurred, when the eyes rise); its sun disc is capped in the shipped file (it held 71 % of the energy) so the
// key alone carries the sun and the shadows stay soft. The board stands on a waxed huanghuali table (the scene's ground;
// walnut is the fallback when no scene is built, fx 0). skyAz: the sun's azimuth in the 1K file (its brightest texel, 30° up).
export default {
  sky: 'pavillon/chinese_garden', skyAz: 0.635, tod: null, ground: 'walnut', tint: 1, rough: 0.6, fade: false, linen: true,
  key: 1.15, ibl: 0.8, exp: 0.95, soft: 1.7, shade: 0.85, lamp: 0, shoji: 0,
  skin: 'washi', tiltMax: (80 * Math.PI) / 180, ambient: 'bambous/forest.mp3',
} satisfies Look
