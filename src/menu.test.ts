import { describe, expect, it } from 'vitest'
import { MENU_IDS, menuEnabled, type MenuState } from './menu'

const all: MenuState = { hasGame: true, canUndo: true, canPass: true, canResign: true, canReview: true, engineHelp: true, canAnalyze: true, is3d: true }
const cmds = Object.fromEntries(['new', 'open', 'save', 'postcard', 'undo', 'pass', 'resign', 'territory', 'review', 'today', 'exercises', 'joseki', 'games', 'camera', 'panel'].map(k => [k, () => {}]))

describe('the menu bar greying', () => {
  it('enables only ids that have a command', () => {
    const e = menuEnabled(cmds, all)
    expect(Object.keys(e)).toEqual([...MENU_IDS])
    for (const id of ['position', 'kifu', 'memory', 'tsumego', 'count', 'fuseki', 'classics'] as const) expect(e[id]).toBe(false)
    for (const id of Object.keys(cmds)) expect(e[id as keyof typeof e]).toBe(true)
    expect(menuEnabled({}, all).new).toBe(false)
  })
  it('greys what makes no sense now', () => {
    const empty = menuEnabled(cmds, { ...all, hasGame: false, canUndo: false, canPass: false, canResign: false, canReview: false })
    expect([empty.save, empty.postcard, empty.undo, empty.pass, empty.resign, empty.review]).toEqual([false, false, false, false, false, false])
    expect([empty.new, empty.open, empty.today, empty.games, empty.panel]).toEqual([true, true, true, true, true])
    const ogs = menuEnabled(cmds, { ...all, engineHelp: false })
    expect([ogs.territory, ogs.exercises, ogs.joseki, ogs.today]).toEqual([false, false, false, true])
    const noNet = menuEnabled(cmds, { ...all, canAnalyze: false })
    expect([noNet.territory, noNet.exercises, noNet.joseki]).toEqual([false, false, true])
    expect(menuEnabled(cmds, { ...all, is3d: false }).camera).toBe(false)
  })
})
