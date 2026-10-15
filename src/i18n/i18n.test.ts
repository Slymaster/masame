import { afterEach, describe, expect, it } from 'vitest'
import { loadSgf } from '../sgf'
import { dicts, failureText, setLang, storedLang, t, type Msg } from '.'

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

describe('result letters', () => {
  afterEach(() => setLang('fr'))
  const all = ['B+R', 'W+T', 'B+F', 'W+3.5', 'B+0.5', 'b+r', '0', 'Void', '?', 'B+']
  it('read N(oir), B(lanc) and a decimal comma in French', () => {
    setLang('fr')
    expect(all.map(t.resultShort)).toEqual(['N+R', 'B+T', 'N+F', 'B+3,5', 'N+0,5', 'N+r', '0', 'Annulée', '?', 'N+'])
  })
  it('stay standard SGF in English', () => {
    setLang('en')
    expect(all.map(t.resultShort)).toEqual(all)
  })
})

describe('language setting', () => {
  it('is English unless the user chose one in the UI', () => {
    expect(storedLang({})).toBe('en')
    expect(storedLang({ lang: 'fr' })).toBe('en') // older settings: the auto-detected language, reset once
    expect(storedLang({ lang: 'fr', langChosen: false })).toBe('en')
    expect(storedLang({ lang: 'fr', langChosen: true })).toBe('fr')
    expect(storedLang({ lang: 'en', langChosen: true })).toBe('en')
    expect(storedLang({ lang: 'de', langChosen: true })).toBe('en')
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
    expect(t.board(19, 6.5)).toBe('19×19 · komi 6,5 · règles japonaises')
    expect(t.points(81.5)).toBe('81,5 points')
    expect(t.tally(70, 5, 6.5)).toBe('70 de territoire · 5 prisonniers · komi 6,5')
    expect(t.clScore(1, 3)).toBe('1 retrouvé sur 3 coups')
    expect(t.clEnd(1, 12, null)).toBe('Tu as retrouvé 1 coup sur 12.')
    expect(t.tally(70, 1)).toBe('70 de territoire · 1 prisonnier')
    expect(t.mb(99_066_230)).toBe('99 Mo')
    expect(nb(t.games(12345))).toBe('12 345 parties')
    expect(nb(t.progress(42, '12 Mo', '99 Mo'))).toBe('42 % · 12 Mo / 99 Mo')
    expect(t.month('2026-10-11T00:00:00Z')).toBe('oct. 2026')
    expect(t.botName('8k')).toBe('KataGo humain 8k')
  })
  it('engine tuning progress and the bot passing', () => {
    setLang('en')
    expect(t.engineTuning(3, 40, 120)).toBe('Tuning KataGo for this graphics card (first launch only, a few minutes) · step 3 · 40/120')
    expect(t.engineTuning(0, 0, 0)).toBe('Tuning KataGo for this graphics card (first launch only, a few minutes)')
    expect(t.botPasses(-1)).toBe('White passes. Your move.')
    expect(t.tuningProgress(3, 40, 120)).toBe('step 3 · 40/120')
    expect(t.tuningProgress(0, 0, 63)).toBe('0/63')
    setLang('fr')
    expect(t.engineTuning(3, 40, 120)).toBe('Réglage de KataGo pour cette carte graphique (premier lancement seulement, quelques minutes) · étape 3 · 40/120')
    expect(t.botPasses(-1)).toBe('Blanc passe. À toi de jouer.')
    expect(t.tuningProgress(3, 40, 120)).toBe('étape 3 · 40/120')
    for (const s of [t.engineTuning(3, 40, 120), t.tuningCaption, t.botPasses(1), t.yourMove, t.thinking, t.passed, t.resigned, t.territory,
      t.settings, t.tally(70, 5, 6.5)]) expect(s).not.toMatch(/ [:;!?]/) // French: nbsp before double punctuation
    expect([t.yourMove, t.thinking, t.waiting, t.wins, t.territory]).toEqual(['À toi de jouer', 'réfléchit…', 'attend', 'gagne', 'Ombre et lumière'])
  })
  it('English: decimal point, plurals with 0 plural, MB', () => {
    setLang('en')
    expect(t.score(-4.5)).toBe('White wins by 4.5.')
    expect(t.score(0)).toBe('Draw.')
    expect(t.estimate(3.4)).toBe('Estimate: Black +3.5')
    expect([0, 1, 2].map(t.captures)).toEqual(['0 captures', '1 capture', '2 captures'])
    expect(t.board(19, 6.5)).toBe('19×19 · komi 6.5 · Japanese rules')
    expect(t.points(81.5)).toBe('81.5 points')
    expect(t.clEnd(1, 12, null)).toBe('You found 1 move out of 12.')
    expect(t.tally(70, 5, 6.5)).toBe('70 territory · 5 prisoners · komi 6.5')
    expect(t.tally(70, 1)).toBe('70 territory · 1 prisoner')
    expect([t.yourMove, t.thinking, t.passed, t.resigned, t.wins, t.territory]).toEqual(['Your move', 'thinking…', 'passed', 'resigned', 'wins', 'Light and shadow'])
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

describe('game review', () => {
  afterEach(() => setLang('fr'))
  it('formats points, moves and colours in both languages', () => {
    setLang('en')
    expect(t.moment(1, 3, 47, 6.54)).toBe('Moment 1/3 · move 47 · −6.5 points')
    expect([t.shortOf(1.23), t.shortOf(1)]).toEqual(['1.2 points from the best punishment.', '1 point from the best punishment.'])
    expect(t.tryAsk(-1, 47)).toBe('Play White: how do you punish move 47?')
    expect(t.noMoments(1)).toBe('No move by Black lost 2 points or more.')
    setLang('fr')
    expect(t.moment(1, 3, 47, 6.54)).toBe('Moment 1/3 · coup 47 · −6,5 points')
    expect([t.shortOf(1.23), t.shortOf(1)]).toEqual(['À 1,2 point de la meilleure punition.', 'À 1 point de la meilleure punition.'])
    expect(nb(t.tryAsk(-1, 47))).toBe('Joue Blanc : comment punir le coup 47 ?')
    expect(t.noMoments(0)).toBe('Aucun coup n’a perdu 2 points ou plus.')
    for (const s of [t.tryAsk(-1, 47), t.found, t.missed(1, 6.1), t.punishLine(-1, 'R14', 1, 6.5), t.betterLine(1, 'R13', 6.5),
      t.tryHelp(-1, 1, 6.5), t.punishHelp, t.betterHelp]) expect(s).not.toMatch(/ [:;!?]/)
  })
})

describe('exercises', () => {
  afterEach(() => setLang('fr'))
  it('words progress, phases and help in both languages', () => {
    setLang('en')
    expect([t.exProgress(1, 0, 0), t.exProgress(2, 3, 4), t.exProgress(0, 0, 1)]).toEqual(['1 exercise due', '2 exercises due · 3 new today · 4 from tomorrow', '1 from tomorrow'])
    expect([t.exLost(3.6), t.exLost(0.4)]).toEqual(['−4', '0'])
    expect(t.exAsk(1, 'G4', 5)).toBe('Black to play. G4 (×) lost 5 points in the game: find better.')
    expect(t.exWhereHelp(1)).toMatch(/over your last reviewed game\./)
    expect([t.exPerGame(3.6, 47.4), t.exPerGame(1.2, 100)]).toEqual(['−4 points per game · 47% of what you lose', '−1 point per game · 100% of what you lose'])
    expect([t.exKept(1), t.exKept(3)]).toEqual(['This moment is saved to your exercises (E).', 'These moments are saved to your exercises (E).'])
    setLang('fr')
    expect([t.exProgress(1, 1, 0), t.exProgress(2, 3, 4)]).toEqual(['1 exercice à revoir · 1 nouveau aujourd’hui', '2 exercices à revoir · 3 nouveaux aujourd’hui · 4 dès demain'])
    expect(nb(t.exPerGame(3.6, 47.4))).toBe('−4 points par partie · 47 % de ce que tu perds')
    expect(nb(t.exAsk(-1, null, 2))).toBe('Blanc joue. Passer a perdu 2 points dans la partie : trouve mieux.')
    expect([t.exWhereHelp(1), t.exWhereHelp(5)].map(nb).map(s => s.split('.')[0]))
      .toEqual(['Points perdus par partie par tes coups, sur ta dernière partie revue', 'Points perdus par partie par tes coups, sur tes 5 dernières parties revues'])
    for (const s of [t.exNeedsNet, t.exEmpty, t.exAsk(1, 'G4', 5), t.exFound, t.exMissed(2), t.exWhereHelp(3), t.exResetAsk, t.exReadOnly])
      expect(s).not.toMatch(/ [:;!?]/)
  })
})

describe('OGS', () => {
  afterEach(() => setLang('fr'))
  it('words results, searches and clocks in both languages', () => {
    setLang('en')
    expect([t.ogsResult(-1, 'resign'), t.ogsResult(1, 'time'), t.ogsResult(-1, 'score', 4.5), t.ogsResult(1, 'forfeit'), t.ogsResult(0, 'cancel')])
      .toEqual(['White wins by resignation.', 'Black wins on time.', 'White wins by 4.5 points.', 'Black wins by forfeit.', 'Game cancelled.'])
    expect([t.ogsResult(0, 'score', 0), t.ogsResult(0, 'score', 4.5), t.ogsResult(0, 'resign')]).toEqual(['Draw.', 'Game over.', 'Game over.']) // no invented winner
    expect([nb(t.periods(3, 30)), nb(t.days(2, 4))]).toEqual(['3×30 s', '2 d 4 h'])
    expect(t.periods(3, 30) + t.days(2, 4)).not.toMatch(/ /) // nbsp: never wraps
    expect(t.ogsSearching(9, t.paces.blitz)).toBe('Looking for a 9×9 blitz opponent…')
    expect(t.ogsBoard(19, 6.5, t.rules.chinese)).toBe('19×19 · komi 6.5 · Chinese rules · OGS')
    setLang('fr')
    expect([t.ogsResult(-1, 'resign'), t.ogsResult(1, 'time'), t.ogsResult(-1, 'score', 4.5), t.ogsResult(1, 'forfeit'), t.ogsResult(0, 'cancel')])
      .toEqual(['Blanc gagne par abandon.', 'Noir gagne au temps.', 'Blanc gagne de 4,5 points.', 'Noir gagne par forfait.', 'Partie annulée.'])
    expect([t.ogsResult(0, 'score', 0), t.ogsResult(0, 'resign')]).toEqual(['Égalité.', 'Partie terminée.'])
    expect(t.ogsSearching(9, t.paces.blitz)).toBe('Recherche d’un adversaire 9×9 blitz…')
    expect(nb(t.days(2, 4))).toBe('2 j 4 h')
    for (const s of [t.ogsSignInHelp, t.ogsSignedIn('x'), t.ogsLeaveAsk, t.ogsResignAsk, t.failures.ogs_port_busy, t.periods(3, 30)])
      expect(s).not.toMatch(/ [:;!?]| s$/) // nbsp, also inside "3×30 s"
    for (const s of [t.ogsSignInHelp, t.ogsSignIn, t.ogsFind, t.ogsSearching(9, 'Live'), t.ogsReconnecting, t.ogsLeaveAsk]) expect(s).not.toMatch(/\bIA\b/)
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
