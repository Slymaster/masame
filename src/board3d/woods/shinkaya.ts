import type { WoodData } from '../gobans'
// Shin-kaya ("new kaya", a spruce): whitish to cream, straight and even, its early and late wood crisp; a little less sheen.
export default {
  tint: [0.66, 0.8, 1.05],
  contrast: 1.2, saturation: 0.8,
  grain: { scale: 0.85 },
  roughness: 1.08, clearcoat: 0.13, clearcoatRoughness: 0.45,
  snd: { rate: 0.98, lowpass: 0.9, gain: 0.95 },
  skin2d: { light: [236, 214, 170], dark: [196, 160, 104] },
} satisfies WoodData
