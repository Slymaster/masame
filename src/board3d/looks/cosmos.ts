import type { Look } from '../logic'

// The board and its bowls adrift in deep space: one small white-blue star is the key (soft shadows), the starfield and a
// faint nebula are the only fill (the scene's own environment, so stones and lacquer reflect stars, never a room). The
// table is gone (the scene's ground is empty). The hour has no effect (a fixed tod, like the Lanterne).
// skyAz = the key's azimuth (200°): the scene's sky is drawn in world directions, so it is not turned at all.
// At fx 0 (no scene) the Lanterne's dark studio lights the stones and the walnut fades into the dark.
export default {
  sky: 'studio_country_hall', skyAz: (200 * Math.PI) / 180, tod: { az: 200, el: 38, K: 9000, I: 3.4, env: 0.5, exp: 1, room: 0 },
  ground: 'walnut', tint: 0.4, rough: 0.72, fade: true, linen: false,
  key: 1, ibl: 0.8, exp: 1.05, soft: 1.5, shade: 0.85, lamp: 0, shoji: 0,
  skin: 'laque', tiltMax: (80 * Math.PI) / 180,
  studyK: 5500, // Study has no stars around it: the star's 9000 K would leave the kaya grey-olive there, so warm daylight instead
} satisfies Look
