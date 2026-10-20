import type { WoodData } from '../gobans'
// Katsura: tea-brown and fine, a satin finish; its flat-sawn arches come from katsura.gl.ts over a quiet grading of the scan.
export default {
  tint: [0.34, 0.32, 0.44],
  contrast: 0.75, saturation: 0.8,
  grain: { scale: 0.8 },
  roughness: 1, clearcoat: 0.22, clearcoatRoughness: 0.55,
  snd: { rate: 0.94, lowpass: 0.82, gain: 0.92 },
  skin2d: { light: [194, 154, 116], dark: [160, 120, 86] },
} satisfies WoodData
