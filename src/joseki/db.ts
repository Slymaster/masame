// Joseki data generated offline by scripts/joseki/generate.ts (KataGo judge + Human SL network).
// { v:1, build, profiles, roots:[{name, m, node, f:%perProfile}],
//   nodes:[{k, e:[[move, child, loss×10, %perProfile, tagBits, symmetry?]], s?:1, pv?}] }
// Nodes are sorted by ply, so edges point forward. A node is stored in its own frame: an edge's symmetry k (1..7,
// src/joseki/sym.ts; absent = 0) takes the position reached to the stored child. The joseki only uses MIRROR (7); the
// fuseki (fuseki.v1.json, from the empty board) uses all 8, and its roots are the first moves. A node with no edges was not expanded; its pv is KataGo's best line from it.
// s = settled (tenuki costs ≤ 0.5 point). Root and edge frequencies are floored percentages of each profile playing it.

import { LocalizedError } from '../i18n'

export const TAG = { classic: 1, pro: 2, ai: 4, verified: 8, contested: 16 }
export type Edge = [string, number, number, number[], number, number?]
export interface JNode { k: string; e: Edge[]; s?: 1; pv?: string }
export interface Root { name: string; m: string; node: number; f: number[] }
/** family: set by the loader for fuseki.v1.json (not in the file). */
export interface JosekiDb { v: 1; build: Record<string, unknown>; profiles: string[]; roots: Root[]; nodes: JNode[]; family?: 'fuseki' }

const isInt = (v: unknown, min: number, max = Infinity): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const isMove = (v: unknown) => typeof v === 'string' && /^[a-s]{2}$/.test(v)
const isPcts = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(x => isInt(x, 0, 100))

/** The file is bundled data, but checked once at load so the trainer can trust indices and lengths. */
export function validate(raw: unknown): JosekiDb {
  const d = raw as JosekiDb
  const fail = (what: string) => { throw new Error(`joseki data: ${what}`) }
  if (d?.v !== 1) fail('unsupported version')
  if (!Array.isArray(d.profiles) || !d.profiles.every(p => typeof p === 'string')) fail('profiles')
  if (!Array.isArray(d.nodes) || !Array.isArray(d.roots)) fail('nodes or roots missing')
  const n = d.profiles.length, len = d.nodes.length
  if (new Set(d.nodes.map(x => x?.k)).size !== len) fail('duplicate node keys')
  d.roots.forEach((r, i) => { if (typeof r?.name !== 'string' || !isMove(r.m) || !isInt(r.node, 0, len - 1) || !isPcts(r.f, n)) fail(`root ${i}`) })
  d.nodes.forEach((x, i) => {
    if (typeof x?.k !== 'string' || !Array.isArray(x.e) || (x.s !== undefined && x.s !== 1)
      || (x.pv !== undefined && !(typeof x.pv === 'string' && /^([a-s]{2})*$/.test(x.pv)))) fail(`node ${i}`)
    for (const e of x.e) {
      if (!Array.isArray(e) || !isMove(e[0]) || !isInt(e[2], 0) || !isPcts(e[3], n) || !isInt(e[4], 0, 31) || e.length > 6 || (e.length > 5 && !isInt(e[5], 1, 7))) fail(`edge at node ${i}`)
      if (!isInt(e[1], i + 1, len - 1)) fail(`edge at node ${i} does not point forward`)
    }
  })
  return d
}

export type Book = 'joseki' | 'fuseki'
const loading: Partial<Record<Book, Promise<JosekiDb>>> = {}
/** Fetched on first use (it is not small), then shared. */
export const loadJoseki = (book: Book = 'joseki') => loading[book] ??= fetch(`${import.meta.env.BASE_URL}assets/joseki/${book}.v1.json`)
  // a missing file comes back as the page itself (HTML), not as a 404: both read as one plain sentence
  .then(r => r.ok && !r.headers.get('content-type')?.includes('html') ? r.json() : Promise.reject(new LocalizedError(d => d.bookMissing)))
  .then(j => book === 'fuseki' ? { ...validate(j), family: book } : validate(j), e => { loading[book] = undefined; throw e instanceof LocalizedError ? e : new LocalizedError(d => d.bookUnreadable) }) // a network or data error reads in your language too

export interface Child { move: string; child: number; loss: number; freq: number[]; tags: number; sym: number }
/** Moves stored at a node: loss in points, freq per profile in 0..1. */
export const children = (db: JosekiDb, node: number): Child[] => db.nodes[node].e.map(([move, child, loss, freq, tags, k = 0]) =>
  ({ move, child, loss: loss / 10, freq: freq.map(f => f / 100), tags, sym: k }))

/** Chance, per profile, that two players of that profile reach each node (summed over move orders). */
export function reach(db: JosekiDb): number[][] {
  const r = db.nodes.map(() => db.profiles.map(() => 0))
  for (const root of db.roots) r[root.node] = r[root.node].map((v, p) => v + root.f[p] / 100)
  db.nodes.forEach((x, i) => { for (const [, c, , f] of x.e) r[c] = r[c].map((v, p) => v + r[i][p] * f[p] / 100) })
  return r
}

// 1k = -1, 1d = 0 (one rank apart); "pro" sits past 9d
const level = (r: string) => r === 'pro' ? 9 : /^\d+k$/.test(r) ? -parseInt(r) : /^\d+d$/.test(r) ? parseInt(r) - 1 : NaN
/** Index of the stored profile closest to an app rank ('8k', '2d'), the weaker one on a tie. */
export function nearestProfile(profiles: string[], rank: string): number {
  const v = level(rank), d = profiles.map(p => Math.abs(level(p) - v))
  return Number.isNaN(v) ? profiles.indexOf('10k') : d.indexOf(Math.min(...d))
}
