// "La lettre du mois" (Apprendre › Progrès): what a calendar month held, as facts read from the library, the decks, the
// rank readings, the counting store and the journal. Pure: the sheet passes what it loaded, the dictionary words it.
import { whereLost, type Played } from './exercises/deck'
import type { Dict } from './i18n'
import { today } from './joseki/store'
import type { Event } from './journal'
import type { Entry } from './library'
import { localRank, rankName, type Read } from './rank'
import { yesterday } from './today/ritual'

/** A counting answer (masame.counting, the counting stream's store): when, and the error in points. */
export interface CountErr { t: number; err: number }
export interface Sources { entries: Entry[]; journal: Event[]; played: Played[]; ranks: Read[]; counts: CountErr[] }
export interface Facts {
  played: { ai: number; ogs: number; two: number; position: number } // games played, by source
  files: number // games from files gone back over (a file enters the library when reviewed, replayed or guessed)
  wins: { won: number; of: number } | null // finished games against the AI
  rank: { from: number; to: number } | null // the rank read (an index) at the month's start and end
  phase: { p: 0 | 1 | 2; lost: number } | null // where the games played in the month (else reviewed in it, date unknown) lost the most, per game
  joseki: number; fuseki: number // sequences answered right for the first time this month
  tsumego: number // distinct problems solved
  counting: { n: number; err: number } | null // positions counted, the median error
  ritual: { days: number; run: number } | null // days the ritual was done, the longest run of days in a row
}

const range = (y: number, m: number) => [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()] as const
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2 }

/** Ids of `kind` whose first right answer ever falls in [from, to). */
function firstRight(journal: Event[], kind: Event['k'], from: number, to: number): number {
  const first = new Map<string, number>()
  for (const e of journal) {
    if (e.k !== kind || !e.ok || e.id === undefined) continue
    const f = first.get(e.id)
    if (f === undefined || e.t < f) first.set(e.id, e.t)
  }
  return [...first.values()].filter(t => t >= from && t < to).length
}

/** The longest run of consecutive days among `days` (local "Y-M-D" strings, as today()). */
function longestRun(days: Set<string>, ts: number[]): number {
  let best = 0
  for (const t of ts) { // a run starts on a day whose day before isn't in the set
    if (days.has(yesterday(t))) continue
    let n = 0, d = new Date(t)
    while (days.has(today(d.getTime()))) { n++; d.setDate(d.getDate() + 1) }
    best = Math.max(best, n)
  }
  return best
}

/** When an entry counts in the letter: a game when it began, a file when it entered the library (an old file has no month). */
const when = (e: Entry) => (e.source === 'file' ? e.added : e.date)

/** The facts of month m (0–11) of year y, local time. */
export function monthFacts(y: number, m: number, s: Sources): Facts {
  const [from, to] = range(y, m), inM = (t: number) => t >= from && t < to
  const games = s.entries.filter(e => inM(when(e) ?? NaN)), n = (src: Entry['source']) => games.filter(e => e.source === src).length
  const ai = games.filter(e => e.source === 'ai' && e.result && e.me !== 0)
  const won = ai.filter(e => e.result![0] === (e.me === 1 ? 'B' : 'W')).length
  const before = s.ranks.filter(r => r.t < from), upto = s.ranks.filter(r => r.t < to), month = upto.filter(r => r.t >= from)
  const played = s.played.filter(g => inM(g.d ?? g.t)), where = whereLost(played), top = Math.max(...where)
  const counts = s.counts.filter(c => inM(c.t))
  const events = s.journal.filter(e => inM(e.t))
  const solved = new Set(events.filter(e => e.k === 'tsumego' && e.ok).map(e => e.id ?? e.t))
  const rituals = events.filter(e => e.k === 'ritual' && e.ok).map(e => e.t), days = new Set(rituals.map(t => today(t)))
  return {
    played: { ai: n('ai'), ogs: n('ogs'), two: n('two'), position: n('position') }, files: n('file'),
    wins: ai.length ? { won, of: ai.length } : null,
    rank: month.length ? { from: localRank(before.length ? before : month.slice(0, 1))!, to: localRank(upto)! } : null,
    phase: played.length && Math.round(top) > 0 ? { p: where.indexOf(top) as 0 | 1 | 2, lost: top } : null,
    joseki: firstRight(s.journal, 'joseki', from, to), fuseki: firstRight(s.journal, 'fuseki', from, to),
    tsumego: solved.size,
    counting: counts.length ? { n: counts.length, err: median(counts.map(c => c.err)) } : null,
    ritual: days.size ? { days: days.size, run: longestRun(days, rituals) } : null,
  }
}

/** The months to show, newest first: this month, then back to the oldest with anything in it (at most `cap`). */
export function months(s: Sources, now: number, cap = 12): { y: number; m: number }[] {
  const ts = [...s.entries.flatMap(e => when(e) ?? []), ...s.journal.map(e => e.t), ...s.played.map(g => g.d ?? g.t), ...s.ranks.map(r => r.t), ...s.counts.map(c => c.t)]
  const d = new Date(now), oldest = ts.length ? Math.min(now, ...ts) : now, o = new Date(oldest)
  const span = (d.getFullYear() - o.getFullYear()) * 12 + d.getMonth() - o.getMonth()
  // shortcut: older months than `cap` are left out; a "see older letters" link if players ever ask for them
  return Array.from({ length: Math.min(cap, span + 1) }, (_, i) => { const x = new Date(d.getFullYear(), d.getMonth() - i, 1); return { y: x.getFullYear(), m: x.getMonth() } })
}

/** The counting store's answers (masame.counting = { v: 1, errs }), [] when absent or unreadable. */
export function loadCounts(st: Pick<Storage, 'getItem'> = localStorage): CountErr[] {
  try {
    const j = JSON.parse(st.getItem('masame.counting') ?? 'null')
    return Array.isArray(j?.errs) ? j.errs.filter((e: CountErr) => Number.isFinite(e?.t) && Number.isFinite(e?.err)) : []
  } catch { return [] }
}

/** One sentence per fact, in Masame's voice; a month without a game says only so (the spec: « Rien ce mois-ci. »). */
export function letterLines(f: Facts, d: Dict): string[] {
  const l = d.letter, p = f.played
  if (!(p.ai + p.ogs + p.two + p.position + f.files)) return [l.nothing]
  const lines = [
    p.ai + p.ogs + p.two + p.position && l.played(p),
    f.files && l.files(f.files),
    f.wins && l.wins(f.wins.won, f.wins.of),
    f.rank && l.rank(rankName(f.rank.from), rankName(f.rank.to)),
    f.phase && l.phase(f.phase.p, f.phase.lost),
    f.joseki && l.joseki(f.joseki),
    f.fuseki && l.fuseki(f.fuseki),
    f.tsumego && l.tsumego(f.tsumego),
    f.counting && l.counting(f.counting.n, f.counting.err),
    f.ritual && l.ritual(f.ritual.days, f.ritual.run),
  ].filter((x): x is string => !!x)
  return lines
}
