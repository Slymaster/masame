import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSettings } from './App'

const saved = (s: object | null) => vi.stubGlobal('localStorage', { getItem: () => s && JSON.stringify(s), setItem() {} })

describe('the board coordinates setting', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('defaults to visible in a new or existing profile without the preference', () => {
    for (const s of [null, { camera: 'contemplation', lang: 'fr' }]) {
      saved(s); expect(loadSettings().coords).toBe(true)
    }
  })
  it('restores either saved choice without changing the other preferences', () => {
    for (const coords of [false, true]) {
      saved({ coords, renderer: '2d', lang: 'fr', langChosen: true, camera: 'contemplation' })
      expect(loadSettings()).toMatchObject({ coords, renderer: '2d', lang: 'fr', camera: 'contemplation' })
    }
  })
  it('ignores malformed coordinate values', () => {
    for (const coords of [null, 0, 1, 'false', [], {}]) {
      saved({ coords }); expect(loadSettings().coords).toBe(true)
    }
  })
  it('keeps the default when storage is corrupt or unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{' })
    expect(loadSettings().coords).toBe(true)
    vi.stubGlobal('localStorage', { getItem() { throw new Error('unavailable') } })
    expect(loadSettings().coords).toBe(true)
  })
})

describe('the opponent’s hand setting', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('is on in a fresh profile', () => { saved(null); expect(loadSettings().opponentHand).toBe(true) })
  it('is on for settings saved before the option existed', () => { saved({ camera: 'contemplation' }); expect(loadSettings().opponentHand).toBe(true) })
  it('stays off once switched off, on once switched on', () => {
    saved({ opponentHand: false }); expect(loadSettings().opponentHand).toBe(false)
    saved({ opponentHand: true }); expect(loadSettings().opponentHand).toBe(true)
  })
})
