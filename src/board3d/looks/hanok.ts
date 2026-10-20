import type { Look } from '../logic'

// A hanok room in daylight: pine_attic's warm wood lights the stones; part of the window's light comes through a
// hanji-papered lattice door (the scene's cookie), the floor is oiled jangpan paper (the scene's ground; 'paper' is the
// fallback when no scene is built, fx 0). skyAz: energy-weighted azimuth of the upper hemisphere of the 1K file (skylights).
export default {
  sky: 'hanok/pine_attic', skyAz: 0.18, tod: null, ground: 'paper', tint: 0.86, rough: 0.5, fade: false, linen: false,
  key: 0.92, ibl: 1.05, exp: 1, soft: 1.3, shade: 0.95, lamp: 0, shoji: 0.45, skin: 'washi', ambient: 'hanok/room.mp3',
} satisfies Look
