// The goban's shape and wood. No three.js here: the app and the 2D board import it. One entry per line, so streams
// adding shapes or woods merge without conflicts. The table board and kaya are v0.5's; the others land as files.
export const GOBAN_SHAPES = [
  'table',
  'ashi',
  'pliant',
] as const
export type GobanShape = typeof GOBAN_SHAPES[number]

export const WOODS = [
  'kaya',
  'shinkaya',
  'katsura',
  'icho',
  'hiba',
  'bambou',
] as const
export type Wood = typeof WOODS[number]

/**
 * A goban's shape (mm). The playing surface is always the board top, at y = 0, its size from dims(); what changes is what
 * lies under it. The ground (the table, or the floor for a legged goban) is at groundY() = -(thickness + legs' height):
 * the bowls, their lids and every décor's props rest there.
 */
export interface ShapeData {
  /** The board's thickness. */
  thickness: number
  /** Edge rounding of the block (the table board's 2.2). */
  round?: number
  /**
   * Legs under the block, standing on the ground. `profile`: the leg's turned outline as [radius, height] pairs from the
   * floor (height 0) up to where it meets the block (height = `height`); `inset`: the leg's axis from the block's sides
   * (across, along); `ridges`: lobes round a carved leg (a gardenia fruit has six to eight), `depth` their relief as a
   * share of the radius (0 = a plain turned leg).
   */
  legs?: { height: number; profile: [number, number][]; inset: [number, number]; ridges?: number; depth?: number }
  /** A folding board: two halves meeting across the middle (z = 0), `gap` the seam's width. */
  fold?: { gap: number }
}

/** The ground's height under a shape (the board top is y = 0). */
export const groundY = (s: ShapeData) => -(s.thickness + (s.legs?.height ?? 0))

/**
 * A wood: how the board's kaya scan is graded to read as another species (no three.js; the 2D board reads it too).
 * Every field is optional; kaya is all defaults and renders exactly as v0.5.
 */
export interface WoodData {
  /** Linear multipliers on the scan (kaya's pale gold: [0.47, 0.442, 0.395]). */
  tint?: [number, number, number]
  /** The grain's contrast around the wood's mean (1 = the scan's), and its colour saturation (1 = the scan's). */
  contrast?: number; saturation?: number
  /** The grain's scale (2 = figure twice as wide) and its turn on the top (rad; 0 = fibres from player to player). */
  grain?: { scale?: number; rotate?: number }
  /** Multiplier on the scan's roughness (1 = kaya's), and the finish: clear coat strength and roughness (kaya: 0.18, 0.4). */
  roughness?: number; clearcoat?: number; clearcoatRoughness?: number
  /** The stone-on-board knock: multipliers on the set's rate, low-pass and gain (a harder, lighter wood rings higher). */
  snd?: { rate?: number; lowpass?: number; gain?: number }
  /** The 2D board's wood: its light and dark grain colours (sRGB 0–255; kaya: [224, 180, 110] and [176, 120, 58]). */
  skin2d?: { light: [number, number, number]; dark: [number, number, number] }
}

// gobans/<id>.ts and woods/<id>.ts (data, no three.js) are found at build time, like the stone sets; an id without its
// file is pending: hidden from the gallery, and a setting naming it falls back to the table board in kaya.
// A wood may add woods/<id>.gl.ts (a GLSL pattern, read by Board3D only): see docs/adding-stones-and-scenes.md.
const shapeFiles = import.meta.glob<{ default: ShapeData }>(['./gobans/*.ts', '!./gobans/*.test.ts'], { eager: true })
const woodFiles = import.meta.glob<{ default: WoodData }>(['./woods/*.ts', '!./woods/*.gl.ts', '!./woods/*.test.ts'], { eager: true })
export const isReadyShape = (s: GobanShape) => s === 'table' || `./gobans/${s}.ts` in shapeFiles
export const isReadyWood = (w: Wood) => w === 'kaya' || `./woods/${w}.ts` in woodFiles
export const readyShapes = () => GOBAN_SHAPES.filter(isReadyShape)
export const readyWoods = () => WOODS.filter(isReadyWood)

/** v0.5's board: 6 cm, on the table. */
export const TABLE: ShapeData = { thickness: 60, round: 2.2 }
export const KAYA: WoodData = {}
/** Every shape's and wood's data; a pending (or unknown) id gets the table board in kaya. */
export const SHAPES = Object.fromEntries(GOBAN_SHAPES.map(s => [s, shapeFiles[`./gobans/${s}.ts`]?.default ?? TABLE])) as Record<GobanShape, ShapeData>
export const WOOD_DATA = Object.fromEntries(WOODS.map(w => [w, woodFiles[`./woods/${w}.ts`]?.default ?? KAYA])) as Record<Wood, WoodData>
export const shapeOf = (s: GobanShape | undefined) => SHAPES[s as GobanShape] ?? TABLE
export const woodOf = (w: Wood | undefined) => WOOD_DATA[w as Wood] ?? KAYA
