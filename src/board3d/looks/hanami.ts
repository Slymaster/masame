import type { Look } from '../logic'

// A veranda in spring, under cherry blossom: the morning-to-evening light follows the hour, part of it falls through
// blossoming branches (the scene's cookie), bryanston_park_sunrise's soft pink-and-green light lights the stones.
// skyAz: the sky's own sun azimuth (its brightest texel, 5° up), measured on the 1K file (0.80 energy-weighted too).
export default {
  sky: 'hanami/bryanston_park_sunrise', skyAz: 0.8, tod: null, ground: 'walnut', tint: 0.9, rough: 0.8, fade: true, linen: true,
  key: 1.45, ibl: 0.85, exp: 1, soft: 1.4, shade: 0.85, lamp: 0, shoji: 0.6, ownCookie: true,
  skin: 'washi', tiltMax: (80 * Math.PI) / 180, ambient: 'bambous/forest.mp3',
} satisfies Look
