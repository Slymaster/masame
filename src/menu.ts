// The macOS menu bar's items (src-tauri/src/menu.rs, ACTIONS: the same ids) and which of them make sense now. An item
// is enabled only when App's commands registry has its id AND its rule below holds; ids without a command stay greyed.
// A new activity adds its command in App (`commands`) and, when it can't always run, a rule here.
export const MENU_IDS = [
  'new', 'position', 'open', 'save', 'postcard', 'kifu', 'undo', 'pass', 'resign', 'territory', 'review', 'memory',
  'today', 'exercises', 'tsumego', 'count', 'joseki', 'fuseki', 'classics', 'games', 'camera', 'panel',
] as const
export type MenuId = typeof MENU_IDS[number]

/** What the rules look at, computed by App from its state. */
export interface MenuState {
  hasGame: boolean // a game with moves is shown (something to save or picture)
  canUndo: boolean; canPass: boolean; canResign: boolean; canReview: boolean
  engineHelp: boolean // engine help is allowed now: no ongoing OGS game, no review (the trainers' `blocked`)
  canAnalyze: boolean // an analysis network is active
  is3d: boolean
}

const RULES: Partial<Record<MenuId, (s: MenuState) => boolean>> = {
  save: s => s.hasGame, postcard: s => s.hasGame,
  undo: s => s.canUndo, pass: s => s.canPass, resign: s => s.canResign, review: s => s.canReview,
  territory: s => s.engineHelp && s.canAnalyze,
  exercises: s => s.engineHelp && s.canAnalyze, joseki: s => s.engineHelp,
  classics: s => s.engineHelp && s.canAnalyze,
  camera: s => s.is3d,
}

/** Every menu id → enabled. */
export const menuEnabled = (commands: object, s: MenuState): Record<MenuId, boolean> =>
  Object.fromEntries(MENU_IDS.map(id => [id, Object.hasOwn(commands, id) && (RULES[id]?.(s) ?? true)])) as Record<MenuId, boolean>
