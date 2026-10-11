// The 3D view's selectable surroundings. No three.js here: the app imports this for its décor selector.
export const DECORS = ['atelier', 'washitsu', 'lanterne', 'clair'] as const
export type Decor = typeof DECORS[number]
