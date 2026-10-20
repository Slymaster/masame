import type { Look } from '../logic'

// A wooden veranda facing a bamboo garden on a calm day: the sun falls on the board through the leaves (the scene's cookie
// on the shoji spot), the garden's HDRI lights the stones and shows, blurred, when the eyes rise. The light follows the hour.
// skyAz: the sun's own azimuth in ninomaru_teien (its brightest texel, 19.5° up), measured on the 1K file.
export default {
  sky: 'bambous/ninomaru_teien', skyAz: 0.62, tod: null, ground: 'walnut', tint: 0.9, rough: 0.8, fade: true, linen: true,
  key: 1.6, ibl: 0.6, exp: 0.95, soft: 1.2, shade: 0.9, lamp: 0, shoji: 0.8,
  backdrop: { blur: 0.12, intensity: 1 }, skin: 'washi', tiltMax: (80 * Math.PI) / 180, ambient: 'bambous/forest.mp3',
} satisfies Look
