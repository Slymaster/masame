import type { ShapeData } from '../gobans'

// A folding board (oritatami goban), research in .claude/research/gobans.md: 42 × 45 cm, sold as 5, 6 and 7 gō (13, 16
// and 19–20 mm); ours is the 7 gō, 20 mm, lying open on the table, its two halves meeting on a fine seam across the
// middle (the hinges are underneath, out of sight; their make is not sourced).
export default {
  thickness: 20,
  round: 1.2,
  fold: { gap: 0.35 },
} satisfies ShapeData
