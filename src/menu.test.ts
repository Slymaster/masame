import { describe, expect, it } from 'vitest'
import { MENU_IDS, menuEnabled, type MenuState } from './menu'

const all: MenuState = { hasGame: true, canUndo: true, canPass: true, canResign: true, canReview: true, engineHelp: true, canAnalyze: true, is3d: true, canMemory: true }
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
    const c2 = { ...cmds, count: () => {}, memory: () => {} }
    expect([menuEnabled(c2, all).count, menuEnabled(c2, all).memory]).toEqual([true, true])
    expect(menuEnabled(c2, { ...all, engineHelp: false }).count).toBe(false) // never during an OGS game or a review
    expect(menuEnabled(c2, { ...all, canAnalyze: false }).count).toBe(true)
    expect(menuEnabled(c2, { ...all, canMemory: false }).memory).toBe(false)
  })
  it('with every activity registered, each one is enabled when it makes sense and greyed during an OGS game', () => {
    const every = Object.fromEntries(MENU_IDS.map(k => [k, () => {}]))
    expect(Object.values(menuEnabled(every, all)).every(Boolean)).toBe(true)
    const ogs = menuEnabled(every, { ...all, engineHelp: false, canMemory: false, canReview: false })
    for (const id of ['position', 'memory', 'tsumego', 'count', 'fuseki', 'classics', 'exercises', 'joseki', 'territory', 'review'] as const) expect(ogs[id]).toBe(false)
    expect([ogs.kifu, ogs.save, ogs.games, ogs.today]).toEqual([true, true, true, true])
    const noNet = menuEnabled(every, { ...all, canAnalyze: false })
    expect([noNet.tsumego, noNet.classics, noNet.count, noNet.fuseki, noNet.position]).toEqual([false, false, true, true, true])
  })
})
