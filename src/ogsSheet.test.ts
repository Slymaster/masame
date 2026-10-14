import { afterEach, describe, expect, it } from 'vitest'
import { setLang, t } from './i18n'
import { activeOrder, timeLeft } from './OgsGames'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RankChart, rankTicks } from './RankChart'
import type { ActiveRow } from './ogs'

const nb = (s: string) => s.replace(/ /g, ' ')

describe('OGS sheet helpers', () => {
  afterEach(() => setLang('fr'))
  it('puts my turn first, the most urgent first, then the newest', () => {
    const row = (id: number, myTurn: boolean, expires?: number) => ({ id, myTurn, expires }) as ActiveRow
    const rows = [row(1, false), row(2, true, 900), row(3, true), row(4, false), row(5, true, 100)]
    expect(rows.sort(activeOrder).map(r => r.id)).toEqual([5, 2, 3, 4, 1])
  })
  it('tells the time left in days, hours or minutes, without breaking lines', () => {
    setLang('fr')
    const H = 3600_000
    expect([timeLeft(52 * H + 60_000), timeLeft(5 * H + 1), timeLeft(40 * 60_000 + 5), timeLeft(-1)].map(nb)).toEqual(['2 j 4 h', '5 h', '40 min', '0 min'])
    expect(timeLeft(5 * H)).not.toMatch(/ /)
  })
  it('puts 2 to 4 rank lines inside the domain', () => {
    expect(rankTicks(21.6, 22.4)).toEqual({ lo: 21, hi: 23, ticks: [21, 22, 23] })
    expect(rankTicks(21.2, 23.7).ticks).toEqual([22, 23])
    const wide = rankTicks(5.3, 29.8)
    expect(wide.ticks.length).toBeGreaterThanOrEqual(2)
    expect(wide.ticks.length).toBeLessThanOrEqual(4)
  })
  it('French OGS sheet strings: nbsp before colons, no « IA »', () => {
    setLang('fr')
    for (const s of [t.ogsChallengeHint, t.ogsChartLabel('8k', '3k', 14)]) expect(s).not.toMatch(/ [:;!?]/)
    expect(nb(t.ogsChartLabel('8k', '3k', 14))).toBe('Classement OGS : de 8k à 3k en 14 mois')
    for (const s of [...Object.values(t.ogsTabs), t.ogsChallengeTitle, t.ogsAutoHandicap, t.ogsNoRanked, t.ogsLiveNow]) expect(s).not.toMatch(/\bIA\b/)
    setLang('en')
    expect(t.ogsChartLabel('8k', '3k', 14)).toBe('OGS rank: from 8k to 3k over 14 months')
  })
  it('draws the rank chart in each variant, with a summary for screen readers', () => {
    setLang('en')
    const points = [{ t: 0, rank: 22.5, lo: 21.9, hi: 23.1 }, { t: 400 * 86400e3, rank: 27.2, lo: 26.8, hi: 27.6 }]
    const svg = (variant: 'line' | 'band' | 'dots') => renderToStaticMarkup(createElement(RankChart, { points, variant }))
    expect(svg('line')).toContain('aria-label="OGS rank: from 8k to 3k over 13 months"')
    expect(svg('line')).toContain('<polyline')
    expect(svg('band')).toContain('<polygon')
    expect(svg('dots').match(/rc-dot/g)).toHaveLength(2)
    expect(renderToStaticMarkup(createElement(RankChart, { points: [points[0]] }))).not.toContain('NaN')
  })
})
