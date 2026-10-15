import { afterEach, describe, expect, it } from 'vitest'
import { setLang, t } from './i18n'
import { activeOrder, filtered, outcome, paged, timeLeft } from './GamesSheet'
import { storedTab } from './OgsSection'
import type { Entry } from './library'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RankChart, rankTicks } from './RankChart'
import type { ActiveRow } from './ogs'

const nb = (s: string) => s.replace(/ /g, ' ')

describe('OGS sheet helpers', () => {
  afterEach(() => setLang('fr'))
  it('falls back to Play for a stored tab that no longer exists', () => {
    const st = (v: string | null) => ({ getItem: () => v })
    expect([storedTab(st('watch')), storedTab(st('games')), storedTab(st(null)), storedTab(st('junk'))]).toEqual(['watch', 'play', 'play', 'play'])
    expect(storedTab({ getItem: () => { throw new Error('denied') } })).toBe('play')
  })
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
  it('draws the rank chart as a line, with a summary for screen readers', () => {
    setLang('en')
    const points = [{ t: 0, rank: 22.5 }, { t: 400 * 86400e3, rank: 27.2 }]
    const svg = () => renderToStaticMarkup(createElement(RankChart, { points }))
    expect(svg()).toContain('aria-label="OGS rank: from 8k to 3k over 13 months"')
    expect(svg()).toContain('<polyline')
    expect(renderToStaticMarkup(createElement(RankChart, { points: [points[0]] }))).not.toContain('NaN')
  })
})

describe('Mes parties', () => {
  const side = (name: string, rank = '') => ({ name, rank })
  const e = (id: string, source: Entry['source'], me: Entry['me'], b: string, w: string, result?: string): Entry =>
    ({ id, date: 0, source, size: 19, komi: 6.5, handicap: 0, black: side(b), white: side(w), me, result })
  const xs = [e('1', 'ai', 1, 'Moi', 'KataGo human 5k', 'B+R'), e('2', 'ogs', -1, 'Shusaku', 'moi', 'B+4.5'), e('3', 'two', 0, 'Ann', 'Bob', '0'),
    e('4', 'file', 0, 'Honinbo Dosaku', 'Yasui Sanchi'), e('5', 'position', 1, '', 'Lee')]
  it('filters by source, files and positions together', () => {
    const ids = (f: Parameters<typeof filtered>[1], q = '') => filtered(xs, f, q).map(x => x.id)
    expect(ids('all')).toEqual(['1', '2', '3', '4', '5'])
    expect([ids('ai'), ids('ogs'), ids('two'), ids('file')]).toEqual([['1'], ['2'], ['3'], ['4', '5']])
  })
  it('searches the opponent only, both sides when the colour is unknown', () => {
    const ids = (q: string) => filtered(xs, 'all', q).map(x => x.id)
    expect(ids('shu')).toEqual(['2'])
    expect(ids('MOI')).toEqual([]) // the player's own name is not an opponent
    expect(ids('bob')).toEqual(['3'])
    expect(ids('  dosaku ')).toEqual(['4'])
    expect(filtered(xs, 'ai', 'shu')).toEqual([])
  })
  it('pages 50 rows at a time', () => {
    const many = Array.from({ length: 120 }, (_, i) => i)
    expect([paged(many, 1).rows.length, paged(many, 1).more, paged(many, 2).rows.length, paged(many, 3).rows.length, paged(many, 3).more]).toEqual([50, true, 100, 120, false])
    expect(paged([], 1)).toEqual({ rows: [], more: false })
  })
  it('reads the result from the player’s side', () => {
    setLang('en')
    expect(xs.map(outcome)).toEqual(['Won · B+R', 'Lost · B+4.5', 'Draw', 'Unfinished', 'Unfinished'])
    expect(outcome({ ...xs[2], result: 'W+R' })).toBe('W+R')
  })
})
