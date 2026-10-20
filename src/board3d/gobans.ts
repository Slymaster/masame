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

// gobans/<id>.ts and woods/<id>.ts (data, no three.js) are found at build time, like the stone sets; an id without its
// file is pending: hidden from the gallery, and a setting naming it falls back to the table board in kaya.
const shapeFiles = import.meta.glob(['./gobans/*.ts', '!./gobans/*.test.ts'], { eager: true })
const woodFiles = import.meta.glob(['./woods/*.ts', '!./woods/*.gl.ts', '!./woods/*.test.ts'], { eager: true })
export const isReadyShape = (s: GobanShape) => s === 'table' || `./gobans/${s}.ts` in shapeFiles
export const isReadyWood = (w: Wood) => w === 'kaya' || `./woods/${w}.ts` in woodFiles
export const readyShapes = () => GOBAN_SHAPES.filter(isReadyShape)
export const readyWoods = () => WOODS.filter(isReadyWood)
