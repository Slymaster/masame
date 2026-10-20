// The stone sets the board can be played with. No three.js here: the app imports this for its stone selector.
// One entry per line: each set is added on its own line, so streams adding sets merge without conflicts.
export const STONE_SETS = [
  'japonaise',
] as const
export type StoneSet = typeof STONE_SETS[number]
