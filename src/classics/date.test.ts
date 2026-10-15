import { afterEach, describe, expect, it } from 'vitest'
import { setLang } from '../i18n'
import { dateText } from './useClassics'

describe('a classic game\'s date', () => {
  afterEach(() => setLang('en'))
  it('says the first of the month as French does, and the rest as they are', () => {
    setLang('fr')
    expect(dateText('1851-12-01')).toBe('1er décembre 1851')
    expect(dateText('1846-09-11')).toBe('11 septembre 1846')
    expect(dateText('1835-12')).toBe('décembre 1835')
    setLang('en')
    expect(dateText('1851-12-01')).toBe('1 December 1851')
  })
})
