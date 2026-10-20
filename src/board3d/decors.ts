// The 3D view's selectable surroundings. No three.js here: the app imports this for its décor selector.
// One entry per line: each décor is added on its own line, so streams adding décors merge without conflicts.
export const DECORS = [
  'atelier',
  'washitsu',
  'lanterne',
  'clair',
  'bambous',
  'neige',
  'hanok',
  'hanami',
  'pluie',
  'pavillon',
  'honinbo',
  'nuages',
  'cosmos',
] as const
export type Decor = typeof DECORS[number]
