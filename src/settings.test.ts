import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from './App'

const saved = (s: object | null) => vi.stubGlobal('localStorage', { getItem: () => s && JSON.stringify(s), setItem() {} })

describe('the opponent’s hand setting', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('is on in a fresh profile', () => { saved(null); expect(loadSettings().opponentHand).toBe(true) })
  it('is on for settings saved before the option existed', () => { saved({ camera: 'contemplation' }); expect(loadSettings().opponentHand).toBe(true) })
  it('stays off once switched off, on once switched on', () => {
    saved({ opponentHand: false }); expect(loadSettings().opponentHand).toBe(false)
    saved({ opponentHand: true }); expect(loadSettings().opponentHand).toBe(true)
  })
})
