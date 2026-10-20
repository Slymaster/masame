import type { WoodData } from '../gobans'
// Ichō (ginkgo): pale yellow, graded with a faint green cast, very fine and even, the rings barely there; soft and matte.
export default {
  tint: [0.58, 0.76, 0.95],
  contrast: 0.55, saturation: 0.8,
  grain: { scale: 0.7 },
  roughness: 1.25, clearcoat: 0.06, clearcoatRoughness: 0.6,
  snd: { rate: 0.95, lowpass: 0.8, gain: 0.9 },
  skin2d: { light: [228, 210, 150], dark: [204, 180, 116] },
} satisfies WoodData
