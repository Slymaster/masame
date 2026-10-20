import type { Look } from '../logic'

// An Edo-period room at night (the room's layout is ours: how a Honinbo go room was laid out is not documented). No window
// key: an andon standing on the tatami at the far left of the board is the light (the scene stands the lamp inside it),
// its paper diffusing it into soft shadows; empty_play_room graded down to a dim, warm night room (honinbo/) fills the
// reflections. The hour has no effect (a fixed tod, like the Lanterne): az/el are the andon's bearing and height from the
// board's centre, so the contact shadows lean away from it. Seen when the eyes rise: the tokonoma and its hanging scroll.
export default {
  sky: 'honinbo/empty_play_room_night', skyAz: 0.24, tod: { az: 210, el: 22, K: 2400, I: 0, env: 0.5, exp: 1, room: 0 },
  ground: 'tatami', tint: 0.45, rough: 0.82, fade: false, linen: false,
  key: 0, ibl: 0.2, exp: 1.6, soft: 2, shade: 0.85, lamp: 4.5, shoji: 0,
  skin: 'laque', tiltMax: (80 * Math.PI) / 180, ambient: 'hanok/room.mp3',
} satisfies Look
