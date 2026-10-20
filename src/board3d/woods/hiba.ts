import type { WoodData } from '../gobans'
// Hiba: a bright pale yellow, fine and straight; a clean light satin.
export default {
  tint: [0.64, 0.85, 0.73],
  contrast: 0.85, saturation: 1,
  grain: { scale: 0.8 },
  roughness: 0.95, clearcoat: 0.22, clearcoatRoughness: 0.35,
  snd: { rate: 0.99, lowpass: 0.97, gain: 0.98 },
  skin2d: { light: [234, 206, 128], dark: [200, 160, 78] },
} satisfies WoodData
