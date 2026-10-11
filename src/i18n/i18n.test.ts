import { afterEach, describe, expect, it } from 'vitest'
import { loadSgf } from '../sgf'
import { dicts, failureText, setLang, t, type Msg } from '.'

const nb = (s: string) => s.replace(/[  ]/g, ' ') // Intl and French typography use non-breaking spaces

/** Every leaf as [path, value]; functions are leaves too. */
function leaves(o: object, path = ''): [string, unknown][] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${path}${k}.`) : [[`${path}${k}`, v] as [string, unknown]])
}

describe('dictionaries', () => {
  afterEach(() => setLang('fr'))
  it('have identical keys, kinds and arities', () => {
    const shape = (o: object) => leaves(o).map(([k, v]) => `${k}:${typeof v}${typeof v === 'function' ? v.length : ''}`).sort()
    expect(shape(dicts.fr)).toEqual(shape(dicts.en))
  })
  it('have no empty strings', () => {
    for (const d of Object.values(dicts)) for (const [k, v] of leaves(d)) if (typeof v === 'string') expect(v.trim(), k).not.toBe('')
  })
  it('switch live', () => {
    setLang('en'); expect(t.pass).toBe('Pass')
    setLang('fr'); expect(t.pass).toBe('Passer')
  })
})

describe('formatting', () => {
  it('French: decimal comma, plurals with 0 and 1 singular, Mo, nbsp before colons', () => {
    setLang('fr')
    expect(t.score(-4.5)).toBe('Blanc gagne de 4,5.')
    expect(t.score(12)).toBe('Noir gagne de 12.')
    expect(t.score(0)).toBe('Égalité.')
    expect(t.estimate(3.4)).toBe('Estimation : Noir +3,5')
    expect(t.estimate(-0.6)).toBe('Estimation : Blanc +0,5')
    expect([0, 1, 2].map(t.captures)).toEqual(['0 prise', '1 prise', '2 prises'])
    expect(t.board(19, 6.5)).toBe('Goban 19 × 19 · komi 6,5')
    expect(nb(t.side(-1, 81.5, 70, 5, 6.5))).toBe('Blanc 81,5 : 70 de territoire, 5 prisonniers, komi 6,5')
    expect(t.mb(99_066_230)).toBe('99 Mo')
    expect(nb(t.games(12345))).toBe('12 345 parties')
    expect(nb(t.progress(42, '12 Mo', '99 Mo'))).toBe('42 % · 12 Mo / 99 Mo')
    expect(t.month('2026-10-11T00:00:00Z')).toBe('oct. 2026')
    expect(t.botName('8k')).toBe('KataGo humain 8k')
  })
  it('English: decimal point, plurals with 0 plural, MB', () => {
    setLang('en')
    expect(t.score(-4.5)).toBe('White wins by 4.5.')
    expect(t.score(0)).toBe('Draw.')
    expect(t.estimate(3.4)).toBe('Estimate: Black +3.5')
    expect([0, 1, 2].map(t.captures)).toEqual(['0 captures', '1 capture', '2 captures'])
    expect(t.board(19, 6.5)).toBe('19 × 19 board · komi 6.5')
    expect(t.side(1, 75, 70, 1)).toBe('Black 75: 70 territory, 1 prisoner')
    expect(t.mb(99_066_230)).toBe('99 MB')
    expect(t.games(12345)).toBe('12,345 games')
    expect(t.progress(42, '12 MB', '99 MB')).toBe('42% · 12 MB / 99 MB')
    expect(t.month('2026-10-11T00:00:00Z')).toBe('Oct 2026')
    expect(t.botName('8k')).toBe('KataGo human 8k')
    expect(() => loadSgf('(;SZ[30])')).toThrow('Unsupported board size: 30')
  })
  it('maps Rust error codes to text in both languages', () => {
    setLang('fr')
    expect(failureText({ code: 'hash_mismatch' })).toContain('SHA-256')
    expect(failureText({ code: 'engine_crashed', detail: 'Metal error' })).toBe('KataGo s’est arrêté de façon inattendue. (Metal error)')
    setLang('en')
    expect(failureText({ code: 'engine_crashed', detail: 'Metal error' })).toBe('KataGo stopped unexpectedly. (Metal error)')
    expect(failureText({ code: 'new_code' })).toBe('new_code')
    expect(failureText({ code: 'constructor' })).toBe('constructor')
    expect(failureText(new Error('x'))).toBe('x')
  })
})

describe('stored messages', () => {
  afterEach(() => setLang('fr'))
  const caught = (f: () => unknown) => { try { f() } catch (e) { return e } }
  it('render in the language current at display time, not at creation', () => {
    setLang('en')
    const sgfError = caught(() => loadSgf('(;SZ[30])'))
    const msgs: Msg[] = [
      d => d.score(-6.5),
      d => d.botFailed(failureText({ code: 'engine_stopped' }, d)),
      d => d.openFailed(failureText(sgfError, d)),
      d => d.fellBack,
    ]
    const en = msgs.map(m => m(t))
    expect(en[0]).toBe('White wins by 6.5.')
    expect(en[1]).toBe('The AI can’t play right now. The engine is stopped.')
    expect(en[2]).toBe('Couldn’t open this file: Unsupported board size: 30')
    setLang('fr')
    const fr = msgs.map(m => m(t))
    expect(fr[0]).toBe('Blanc gagne de 6,5.')
    expect(fr[1]).toBe(dicts.fr.botFailed(dicts.fr.failures.engine_stopped))
    expect(fr[2]).toBe(dicts.fr.openFailed(dicts.fr.sgfBadSize('30')))
    expect(fr[3]).toBe(dicts.fr.fellBack)
    expect(fr.some((s, i) => s === en[i])).toBe(false)
  })
})
