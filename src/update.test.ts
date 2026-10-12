import { describe, expect, it } from 'vitest'
import { checkDue, DAY, updateSettings } from './update'

describe('update settings', () => {
  it('check automatically unless turned off, with a finite last check time', () => {
    expect(updateSettings({})).toEqual({ autoUpdate: true, updateChecked: 0 })
    expect(updateSettings({ autoUpdate: false, updateChecked: 1234 })).toEqual({ autoUpdate: false, updateChecked: 1234 })
    expect(updateSettings({ autoUpdate: 'no', updateChecked: '1234' })).toEqual({ autoUpdate: true, updateChecked: 0 })
    expect(updateSettings({ autoUpdate: null, updateChecked: NaN }).updateChecked).toBe(0)
    expect(updateSettings({ updateChecked: Infinity }).updateChecked).toBe(0)
  })
})

describe('launch check', () => {
  const now = 1_800_000_000_000
  it('runs at most once a day', () => {
    expect(checkDue(now, 0)).toBe(true)
    expect(checkDue(now, now)).toBe(false)
    expect(checkDue(now, now - DAY + 1)).toBe(false)
    expect(checkDue(now, now - DAY)).toBe(true)
  })
  it('runs again if the clock went back a day', () => {
    expect(checkDue(now, now + DAY)).toBe(true)
    expect(checkDue(now, now + 1000)).toBe(false)
  })
})
