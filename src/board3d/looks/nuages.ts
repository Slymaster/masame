import type { Look } from '../logic'

// The wooden terrace of a mountain temple at dawn, high above a sea of clouds: the first sun, low and warm, rakes across the
// board from ahead and to the left, the cool blue of the open sky fills the shadows and the stones' reflections. The hour
// has no effect (a fixed tod, like the Lanterne). The scene draws the sky, the cloud sea far below and the dark planks.
// skyAz: the sun's own azimuth in kloppenheim_06_puresky (its brightest texel, 4.7° up), measured on the 1K file.
export default {
  sky: 'nuages/kloppenheim_06_puresky', skyAz: 0.709, tod: { az: 222, el: 9, K: 3100, I: 10, env: 0.6, exp: 1, room: 0.7 },
  ground: 'walnut', tint: 0.7, rough: 0.8, fade: false, linen: true,
  key: 1, ibl: 0.85, exp: 1.2, soft: 1.5, shade: 0.62, lamp: 0, shoji: 0,
  woodWarm: 0.85, skin: 'washi', tiltMax: (80 * Math.PI) / 180, ambient: 'neige/wind.mp3',
} satisfies Look
