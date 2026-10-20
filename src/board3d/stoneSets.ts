// The stone sets the board can be played with. No three.js here: the app and the 2D board import this.
// One entry per line: each set is added on its own line, so streams adding sets merge without conflicts.
import type { StoneShape } from './logic'

export const STONE_SETS = [
  'japonaise',
] as const
export type StoneSet = typeof STONE_SETS[number]

/** The 2D board's version of a set (drawn by BoardView.stone()): radial gradient stops (sRGB, centre → rim) and its marks. */
export interface Skin2D { black: number[][]; white: number[][]; marks: { black: 'none' | 'veins' | 'bands' | 'bubbles'; white: 'none' | 'growth' | 'veins' | 'bands' | 'bubbles' } }
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
