declare const process: { env: Record<string, string> } // node's, without its types
process.env.TZ = 'Europe/Paris' // local clock times, DST included: solar hour = UTC hour here
import { describe, expect, it, vi } from 'vitest'
import { ambiances, autoDecor } from './auto'
import { DECORS } from './decors'
import { STONE_SETS } from './stoneSets'

// [local clock time, classic?, décor once every décor exists]
const FIXTURES: [string, boolean, string][] = [
  ['2026-01-15T20:00', false, 'neige'], // winter, after sunset (17:30)
  ['2026-01-15T05:00', false, 'neige'], // winter, before 6 h solar
  ['2026-12-20T18:00', false, 'neige'],
  ['2026-01-15T07:00', false, 'atelier'], // after 6 h, 1.5 h before sunrise
  ['2026-01-15T08:30', false, 'nuages'], // sunrise
  ['2026-01-15T14:00', false, 'atelier'],
  ['2026-03-10T14:00', false, 'atelier'], // before late March
  ['2026-03-25T14:00', false, 'hanami'],
  ['2026-04-10T15:00', false, 'hanami'],
  ['2026-04-10T23:00', false, 'atelier'], // hanami by day only
  ['2026-05-10T15:00', false, 'atelier'],
  ['2026-07-10T16:00', false, 'bambous'], // summer afternoon
  ['2026-07-10T06:30', false, 'nuages'], // summer dawn (sunrise ≈ 6:25)
  ['2026-07-10T10:00', false, 'atelier'], // summer morning
  ['2026-07-10T23:00', false, 'atelier'],
  ['2026-10-20T14:00', true, 'honinbo'], // a classic, any time
  ['2026-01-15T20:00', true, 'honinbo'],
]

describe('autoDecor', () => {
  it('returns only décors that exist: the Atelier while the new ones are missing', () => {
    for (const [at, classic, want] of FIXTURES) {
      const d = autoDecor(new Date(at), undefined, { classic })
      expect(DECORS).toContain(d)
      expect(d).toBe((DECORS as readonly string[]).includes(want) ? want : 'atelier')
    }
  })
  it('follows the season and the hour once every décor exists', async () => {
    vi.resetModules()
    vi.doMock('./decors', () => ({ DECORS: ['atelier', 'washitsu', 'lanterne', 'clair', 'bambous', 'neige', 'hanami', 'nuages', 'honinbo'] }))
    const { autoDecor: auto } = await import('./auto')
    for (const [at, classic, want] of FIXTURES) expect([at, classic, auto(new Date(at), undefined, { classic })]).toEqual([at, classic, want])
    vi.doUnmock('./decors')
  })
  it('a rule whose décor is missing gives way to the next one', async () => {
    vi.resetModules()
    vi.doMock('./decors', () => ({ DECORS: ['atelier', 'nuages'] }))
    const { autoDecor: auto } = await import('./auto')
    expect(auto(new Date('2026-01-15T20:00'), undefined, { classic: true })).toBe('atelier') // no Honinbo, no snow night
    expect(auto(new Date('2026-04-10T07:20'))).toBe('nuages') // hanami missing: April's dawn
    vi.doUnmock('./decors')
  })
})

describe('ambiances', () => {
  it('shows a couple only when both its parts exist, with the first stone set that does', async () => {
    expect(ambiances().every(a => (DECORS as readonly string[]).includes(a.decor) && (STONE_SETS as readonly string[]).includes(a.stones))).toBe(true)
    vi.resetModules()
    vi.doMock('./decors', () => ({ DECORS: ['atelier', 'neige', 'bambous', 'honinbo'] }))
    vi.doMock('./stoneSets', () => ({ STONE_SETS: ['japonaise', 'jade'] }))
    const { ambiances: list } = await import('./auto')
    expect(list()).toEqual([
      { id: 'jardin', decor: 'bambous', stones: 'jade' },
      { id: 'nuitBlanche', decor: 'neige', stones: 'japonaise' }, // no moon stones yet
      { id: 'edo', decor: 'honinbo', stones: 'japonaise' },
    ])
    vi.doUnmock('./decors'); vi.doUnmock('./stoneSets')
  })
})
