import type { Look } from '../logic'

// A veranda in steady summer rain: no sun to speak of, a soft grey light that still follows the hour (a low key with very
// soft shadows), the garden's light (bambous' ninomaru_teien) for the stones' reflections, the wet garden beyond.
export default {
  sky: 'bambous/ninomaru_teien', skyAz: 0.62, tod: null, ground: 'walnut', tint: 0.8, rough: 0.8, fade: false, linen: true,
  key: 0.3, ibl: 0.95, exp: 0.92, soft: 2, shade: 0.5, lamp: 0, shoji: 0,
  woodWarm: 0.6, skin: 'washi', tiltMax: (80 * Math.PI) / 180, ambient: 'pluie/rain.mp3',
} satisfies Look
