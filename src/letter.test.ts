import { describe, expect, it } from 'vitest'
import { en } from './i18n/en'
import { fr } from './i18n/fr'
import type { Event } from './journal'
import { letterLines, loadCounts, monthFacts, months, type Sources } from './letter'
import type { Entry } from './library'
import type { Read } from './rank'

const nb = (s: string) => s.replace(/ /g, ' ')
const at = (d: number, m = 9, h = 12) => new Date(2026, m, d, h).getTime() // October 2026 by default
const side = { name: '', rank: '' }
const entry = (id: string, date: number, source: Entry['source'], me: Entry['me'], result?: string): Entry =>
  ({ id, date, source, me, size: 19, komi: 6.5, handicap: 0, black: side, white: side, ...result && { result } })
const read = (t: number, all: number): Read => ({ k: String(t), t, all, n: 100, phases: [null, null, null] })
const ev = (t: number, k: Event['k'], ok: boolean, id?: string): Event => ({ t, k, ok, ...id && { id } })

const fixture: Sources = {
  entries: [
    entry('ai-1', at(2), 'ai', 1, 'B+R'), entry('ai-2', at(5), 'ai', -1, 'B+4.5'), entry('ai-3', at(9), 'ai', -1, 'W+R'),
    entry('ai-4', at(12), 'ai', 1), // unfinished: played, not counted in the wins
    entry('ogs-7', at(3), 'ogs', 1, 'W+T'), entry('two-1', at(4), 'two', 0, 'B+R'), entry('file-x', at(6), 'file', 1, 'B+R'),
    entry('ai-0', at(28, 8), 'ai', 1, 'B+R'), // September
  ],
  ranks: [read(at(20, 8), 14), read(at(3), 14), read(at(10), 16)], // 6k before October, then 5k-ish readings
  played: [{ k: 'a', t: at(5), loss: [3, 12, 4] }, { k: 'b', t: at(9), loss: [1, 8, 2] }, { k: 'c', t: at(20, 8), loss: [30, 0, 0] }],
  counts: [{ t: at(2), err: 2 }, { t: at(3), err: 5 }, { t: at(4), err: 3 }, { t: at(30, 8), err: 20 }],
  journal: [
    ev(at(25, 8), 'joseki', true, 'j1'), // learned in September
    ev(at(2), 'joseki', true, 'j1'), ev(at(2), 'joseki', false, 'j2'), ev(at(3), 'joseki', true, 'j2'), ev(at(4), 'joseki', true, 'j3'),
    ev(at(5), 'fuseki', true, 'f1'),
    ev(at(6), 'tsumego', true, 't1'), ev(at(7), 'tsumego', true, 't1'), ev(at(7), 'tsumego', false, 't2'), ev(at(8), 'tsumego', true, 't3'),
    ...[1, 2, 3, 6, 7].map(d => ev(at(d, 9, 21), 'ritual', true)), ev(at(30, 8, 21), 'ritual', true),
  ],
}

describe('the facts of a month', () => {
  it('reads October 2026 from the library, the decks, the rank readings, the counting store and the journal', () => {
    expect(monthFacts(2026, 9, fixture)).toEqual({
      played: { ai: 4, ogs: 1, two: 1, position: 0 }, files: 1,
      wins: { won: 2, of: 3 }, // B+R as Black, W+R as White; B+4.5 as White is a loss
      rank: { from: 14, to: (14 + 14 + 16) / 3 }, // the rank before the month (6k), then the local rank at its end (5k)
      phase: { p: 1, lost: 10 },
      joseki: 2, fuseki: 1, // j1 was learned in September; j2 failed first, then came right
      tsumego: 2, // t1 twice is one problem
      counting: { n: 3, err: 3 },
      ritual: { days: 5, run: 3 },
    })
  })
  it('a month without anything says only so, in both languages', () => {
    const f = monthFacts(2026, 7, fixture)
    expect(letterLines(f, fr)).toEqual(['Rien ce mois-ci.'])
    expect(letterLines(f, en)).toEqual(['Nothing this month.'])
  })
  it('a first month takes its rank from its own first reading', () => {
    expect(monthFacts(2026, 8, fixture).rank).toEqual({ from: 14, to: 14 })
  })
  it('lists this month first, then back to the oldest with anything in it', () => {
    expect(months(fixture, at(14))).toEqual([{ y: 2026, m: 9 }, { y: 2026, m: 8 }])
    expect(months({ ...fixture, entries: [entry('old', new Date(2025, 0, 5).getTime(), 'ai', 1)] }, at(14), 12)).toHaveLength(12)
    expect(months({ entries: [], journal: [], played: [], ranks: [], counts: [] }, at(14))).toEqual([{ y: 2026, m: 9 }])
  })
})

describe('the letter, sentence by sentence', () => {
  it('says October 2026 in French, one sentence per fact', () => {
    expect(letterLines(monthFacts(2026, 9, fixture), fr).map(nb)).toEqual([
      'Tu as joué 6 parties : 4 contre l’IA, 1 sur OGS et 1 à deux.',
      'Tu as revu une partie venue d’un fichier.',
      'Contre l’IA, tu as gagné 2 parties sur 3.',
      'Ton rang lu dans tes coups est passé de 6k à 5k.',
      'Tes points sont partis surtout en milieu de partie : 10 points par partie.',
      'Tu as appris 2 nouvelles séquences de joseki.',
      'Tu as appris un nouveau fuseki.',
      'Tu as résolu 2 tsumego.',
      'Tu as compté 3 positions, en général à 3 points près.',
      'Tu as fait le rituel 5 jours, jusqu’à 3 de suite.',
    ])
  })
  it('says it in English', () => {
    expect(letterLines(monthFacts(2026, 9, fixture), en)).toEqual([
      'You played 6 games: 4 against the AI, 1 on OGS and 1 between two players.',
      'You went back over a game from a file.',
      'Against the AI, you won 2 of 3 games.',
      'Your rank read in your moves went from 6k to 5k.',
      'Your points went mostly in the middle game: 10 points per game.',
      'You learned 2 new joseki sequences.',
      'You learned a new fuseki.',
      'You solved 2 tsumego.',
      'You counted 3 positions, usually within 3 points.',
      'You did the ritual on 5 days, up to 3 in a row.',
    ])
  })
  it('singular and plural', () => {
    const one = { ai: 1, ogs: 0, two: 0, position: 0 }
    expect(fr.letter.played(one)).toBe('Tu as joué 1 partie contre l’IA.')
    expect(en.letter.played({ ...one, ai: 3 })).toBe('You played 3 games against the AI.')
    expect(nb(fr.letter.played({ ai: 1, ogs: 1, two: 0, position: 0 }))).toBe('Tu as joué 2 parties : 1 contre l’IA et 1 sur OGS.')
    expect(fr.letter.files(2)).toBe('Tu as revu 2 parties venues de fichiers.')
    expect(fr.letter.wins(1, 1)).toBe('Tu as gagné ta partie contre l’IA.')
    expect(en.letter.wins(0, 1)).toBe('You lost your game against the AI.')
    expect(fr.letter.wins(1, 4)).toBe('Contre l’IA, tu as gagné 1 partie sur 4.')
    expect(fr.letter.wins(0, 2)).toBe('Contre l’IA, aucune victoire en 2 parties.')
    expect(en.letter.wins(0, 2)).toBe('Against the AI, no win in 2 games.')
    expect(fr.letter.rank('5k', '5k')).toBe('Ton rang lu dans tes coups est resté à 5k.')
    expect(nb(fr.letter.phase(0, 1.2))).toBe('Tes points sont partis surtout dans l’ouverture : 1 point par partie.')
    expect(fr.letter.joseki(1)).toBe('Tu as appris une nouvelle séquence de joseki.')
    expect(en.letter.joseki(1)).toBe('You learned a new joseki sequence.')
    expect(fr.letter.fuseki(3)).toBe('Tu as appris 3 nouveaux fuseki.')
    expect(fr.letter.tsumego(1)).toBe('Tu as résolu un tsumego.')
    expect(en.letter.tsumego(1)).toBe('You solved a tsumego.')
    expect(fr.letter.counting(1, 1)).toBe('Tu as compté une position, à 1 point près.')
    expect(en.letter.counting(4, 0.2)).toBe('You counted 4 positions, usually to the point.')
    expect(fr.letter.ritual(1, 1)).toBe('Tu as fait le rituel un jour.')
    expect(fr.letter.ritual(4, 4)).toBe('Tu as fait le rituel 4 jours de suite.')
    expect(en.letter.ritual(3, 1)).toBe('You did the ritual on 3 days.')
  })
  it('titles the month', () => {
    expect(fr.letter.title(2026, 9)).toBe('Octobre 2026')
    expect(en.letter.title(2026, 9)).toBe('October 2026')
    expect(fr.letter.fileName(2026, 9)).toBe('masame-lettre-2026-10.png')
  })
})

describe('the counting store', () => {
  it('reads its answers, and nothing from garbage', () => {
    const st = (v: string | null) => ({ getItem: () => v })
    expect(loadCounts(st(JSON.stringify({ v: 1, errs: [{ t: 1, err: 2 }, { t: 'x', err: 1 }] })))).toEqual([{ t: 1, err: 2 }])
    expect(loadCounts(st('{'))).toEqual([])
    expect(loadCounts(st(null))).toEqual([])
  })
})
