import type { WoodData } from '../gobans'
// Laminated bamboo: pale natural strips (bambou.gl.ts draws them; tint is the strips' own linear colour, the scan unused).
export default {
  tint: [0.5, 0.34, 0.15],
  grain: { scale: 0.5 },
  normal: 0.15, // the kaya scan's ring relief would show in the strips' reflections
  roughness: 1, clearcoat: 0.2, clearcoatRoughness: 0.38,
  snd: { rate: 1.06, lowpass: 1.15, gain: 1.04 },
  skin2d: { light: [222, 192, 140], dark: [196, 160, 104] },
} satisfies WoodData
