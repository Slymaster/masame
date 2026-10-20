// The stone sets the board can be played with. No three.js here: the app and the 2D board import this.
// One entry per line: each set is added on its own line, so streams adding sets merge without conflicts.
import type { StoneShape } from './logic'

export const STONE_SETS = [
  'japonaise',
  'yunzi',
  'coreennes',
  'jade',
  'galets',
  'agate',
  'ambre',
  'lune',
  'verre',
  'bronze',
  'braise',
  'nebuleuse',
  'famille',
] as const
export type StoneSet = typeof STONE_SETS[number]

/**
 * What BoardView draws over a 2D stone's gradient, clipped to the stone: 'growth' the Hyuga shell's striations, 'veins'
 * a few fine wandering lines (jade, marble), 'bands' agate's concentric layers, 'bubbles' small trapped air (glass, amber),
 * 'speckles' fine grain (pebbles, granite), 'stars' tiny glowing points (nebula), 'cracks' jagged glowing lines (ember),
 * 'sheen' a soft brushed band across the stone (metal).
 */
export type Mark2D = 'none' | 'growth' | 'veins' | 'bands' | 'bubbles' | 'speckles' | 'stars' | 'cracks' | 'sheen'
/** A mark's tuning; every field is optional and 1 / the mark's own colour by default. */
export interface Mark2DParams {
  /** sRGB colour of the lines, dots or band. */
  color?: number[]
  /** Multiplier on the mark's opacity. */
  amount?: number
  /** Multiplier on the mark's size (line width, dot radius, band spacing). */
  scale?: number
  /** Multiplier on how many lines, dots or bands are drawn. */
  count?: number
}
/** Optional finishing of one colour's 2D stone (absent = the Japanese set's look). */
export interface Skin2DFinish {
  /** Positions (0..1) of the gradient stops, one per colour; absent = the Japanese spacing for 4 stops, else even. */
  stops?: number[]
  /** A glow just inside the rim, for translucent stones (yunzi's green, jade, amber): sRGB colour, opacity 0..1, width as a share of the radius (default 0.35). */
  rim?: { color: number[]; strength: number; width?: number }
  /** The specular spot: opacity (Japanese 0.17 black, 0.55 white), size as a share of the radius (0.5 black, 0.42 white), sRGB colour. */
  highlight?: { strength?: number; size?: number; color?: number[] }
  /** Tuning of this colour's mark. */
  mark?: Mark2DParams
}
/** The 2D board's version of a set (drawn by BoardView.stone()): radial gradient stops (sRGB, centre → rim) and its marks. */
export interface Skin2D {
  black: number[][]; white: number[][]
  marks: { black: Mark2D; white: Mark2D }
  finish?: { black?: Skin2DFinish; white?: Skin2DFinish }
}
/** A milestone that unlocks a rare set (wave 3 defines the ids and unlocked()). */
export type Unlock = string
/** A set's three-free data: sets/<id>.ts default-exports it (its materials live in sets/<id>.gl.ts). */
export interface StoneData extends StoneShape {
  /** Multipliers on the stone sounds' playback rate, low-pass cutoff and gain (1, 1, 1 = the recorded slate and shell). */
  snd: { rate: number; lowpass: number; gain: number }
  skin2d: Skin2D
  rare?: Unlock
}

const FILES = import.meta.glob<{ default: StoneData }>(['./sets/*.ts', '!./sets/*.gl.ts', '!./sets/*.test.ts'], { eager: true })
const found = Object.fromEntries(Object.entries(FILES).map(([f, m]) => [f.slice(7, -3), m.default])) as Partial<Record<string, StoneData>>
/** A set is ready once sets/<id>.ts exists; a listed id without it is pending. */
export const isReadySet = (s: StoneSet) => s in found
export const readySets = () => STONE_SETS.filter(isReadySet)
/** Every set's data; a pending set plays as the Japanese one (never a crash). */
export const STONE_DATA = Object.fromEntries(STONE_SETS.map(s => [s, found[s] ?? found.japonaise!])) as Record<StoneSet, StoneData>
