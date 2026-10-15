// Tsumego from your games: positions of reviewed games where a group lives if its owner plays first and dies if the
// opponent does. Pure: sampling, detection on two ownership maps, the card, the status check, the daily cap and the
// small store of mined games (`masame.tsumego`). The background runner is useMining.ts.
import { stringifyVertex } from '@sabaki/sgf'
import { Game, type Move, type Sign, type Vertex } from '../game'
import { today } from '../joseki/store'
import { hash64 } from '../joseki/sym'
import { isItem, type Exercise } from '../exercises/deck'

export const MIN_STONES = 3, STATUS = 0.5, SEKI = 0.2, MARGIN = 2, LOCAL = 11, PER_DAY = 5, EVERY = 15, FROM = 30, TAIL = 20
/** The detection query: both sides to play, ownership, bounded in time on any hardware. */
export const MINE_QUERY = { maxVisits: 150, includeOwnership: true, analysisPVLen: 7, overrideSettings: { maxTime: 2 } }
/** After a try, KataGo's best line is played this far before the status is checked. */
export const PLIES = 6

type SignMap = Sign[][] | number[][]
export type Box = [number, number, number, number] // x0, y0, x1, y1 (inclusive)

/** Positions to read (indices into game.moves): each key moment, then one every EVERY moves from move FROM to TAIL from the end. */
export function samples(moments: number[], end: number): number[] {
  const s = new Set(moments.filter(i => i >= 1 && i < end))
  for (let i = FROM; i <= end - TAIL; i += EVERY) s.add(i)
  return [...s].sort((a, b) => a - b)
}

/** Every chain of stones (4-connected, same colour). */
export function chains(signMap: SignMap): { sign: Sign; stones: Vertex[] }[] {
  const n = signMap.length, seen = signMap.map(r => r.map(() => false)), out: { sign: Sign; stones: Vertex[] }[] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = signMap[y][x]
    if (!s || seen[y][x]) continue
    const stones: Vertex[] = [], todo: Vertex[] = [[x, y]]
    seen[y][x] = true
    while (todo.length) {
      const [a, b] = todo.pop()!
      stones.push([a, b])
      for (const [c, d] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]])
        if (c >= 0 && d >= 0 && c < n && d < n && !seen[d][c] && signMap[d][c] === s) { seen[d][c] = true; todo.push([c, d]) }
    }
    out.push({ sign: s as Sign, stones })
  }
  return out
}

/** The chain's bounding box widened by MARGIN lines (inside the board). */
export function boxOf(stones: Vertex[], n: number): Box {
  const xs = stones.map(v => v[0]), ys = stones.map(v => v[1])
  return [Math.max(0, Math.min(...xs) - MARGIN), Math.max(0, Math.min(...ys) - MARGIN), Math.min(n - 1, Math.max(...xs) + MARGIN), Math.min(n - 1, Math.max(...ys) + MARGIN)]
}
const fits = (b: Box) => b[2] - b[0] + 1 <= LOCAL && b[3] - b[1] + 1 <= LOCAL
const overlap = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
export const inBox = (v: Vertex, b: Box) => v[0] >= b[0] && v[0] <= b[2] && v[1] >= b[1] && v[1] <= b[3]

/** Mean ownership of the stones' points from `sign`'s side (ownership: row-major, +1 = Black). */
export const mean = (own: number[], stones: Vertex[], sign: Sign, n: number) => stones.reduce((s, [x, y]) => s + own[y * n + x], 0) * sign / stones.length

export interface Found { owner: Sign; stones: Vertex[]; box: Box }
/**
 * Status problems: chains of MIN_STONES or more that live (≥ +STATUS from their side) when their owner plays first and die
 * (≤ −STATUS) when the opponent does, and fit in LOCAL×LOCAL with their margin (else a whole-board fight). One per area:
 * a bigger chain wins over an overlapping one (the two sides of a capturing race are one problem).
 */
export function detect(signMap: SignMap, ownB: number[], ownW: number[]): Found[] {
  const n = signMap.length, kept: Found[] = []
  const cands = chains(signMap).filter(c => c.stones.length >= MIN_STONES).filter(c => {
    const first = c.sign === 1 ? ownB : ownW, second = c.sign === 1 ? ownW : ownB
    return mean(first, c.stones, c.sign, n) >= STATUS && mean(second, c.stones, c.sign, n) <= -STATUS
  }).map(c => ({ owner: c.sign, stones: c.stones, box: boxOf(c.stones, n) })).filter(c => fits(c.box))
  for (const c of cands.sort((a, b) => b.stones.length - a.stones.length)) if (kept.every(k => !overlap(k.box, c.box))) kept.push(c)
  return kept
}

/** The chain after a line: alive, dead, seki (no one's), or still unclear, from its owner's mean ownership. */
export const statusOf = (m: number): 'alive' | 'dead' | 'seki' | 'unclear' =>
  m >= STATUS ? 'alive' : m <= -STATUS ? 'dead' : Math.abs(m) <= SEKI ? 'seki' : 'unclear'
/** The goal is reached: to save, alive or seki; to kill, dead. */
export const reached = (live: boolean, m: number) => (live ? ['alive', 'seki'].includes(statusOf(m)) : statusOf(m) === 'dead')
/** Found: the status and within a point of the best; almost: the status, further; missed: no status. */
export const ldVerdict = (ok: boolean, gap: number): 'found' | 'short' | 'missed' => (!ok ? 'missed' : gap < 1 ? 'found' : 'short')

const code = (v: Vertex) => stringifyVertex(v)
/** Black's and White's stones of a position. */
export function stonesOf(signMap: SignMap): { black: Vertex[]; white: Vertex[] } {
  const black: Vertex[] = [], white: Vertex[] = []
  signMap.forEach((r, y) => r.forEach((s, x) => { if (s === 1) black.push([x, y]); else if (s === -1) white.push([x, y]) }))
  return { black, white }
}
/** A position as a fresh record (stones set up, `toPlay` first): what the engine reads, the trainer shows. */
export const positionAt = (signMap: SignMap, size: number, komi: number, toPlay: Sign) =>
  Game.fromRecord({ size, komi, setup: stonesOf(signMap), firstSign: toPlay }, [] as Move[])

/** The card: the whole position, `sign` to play (the owner to save, the opponent to kill), KataGo's answer and both leads. */
export function cardOf(p: { signMap: SignMap; size: number; komi: number; n: number; vs: string }, f: Found, sign: Sign,
  first: { scoreLead: number; pv: (Vertex | null)[] }, other: { scoreLead: number }, now: number): Exercise {
  const s = stonesOf(p.signMap)
  return {
    kind: 'ld', t: now, vs: p.vs, size: p.size, komi: p.komi, b: s.black.map(code).join(''), w: s.white.map(code).join(''), moves: '', sign,
    played: 'tt', loss: Math.max(0, sign * (first.scoreLead - other.scoreLead)), best: first.scoreLead,
    better: first.pv.map(v => (v ? code(v) : 'tt')).join(''), punish: '', chain: f.stones.map(code).join(''), n: p.n,
  }
}
/** Position and chain: the same problem met again (another sampling, the other side asked) adds nothing. */
export const ldKey = (x: Exercise) => hash64(`ld|${x.size}|${x.komi}|${x.b}|${x.w}|${x.chain}`)

/** The problems of one sampled position from its two reads; the side asked is drawn by `random` (save or kill). */
export function problemsAt(p: { signMap: SignMap; size: number; komi: number; n: number; vs: string },
  b: { scoreLead: number; pv: (Vertex | null)[]; ownership: number[] | null }, w: { scoreLead: number; pv: (Vertex | null)[]; ownership: number[] | null },
  now: number, random: () => number): Exercise[] {
  if (!b.ownership || !w.ownership) return []
  return detect(p.signMap, b.ownership, w.ownership).flatMap(f => {
    const sign = (random() < 0.5 ? f.owner : -f.owner) as Sign, first = sign === 1 ? b : w, other = sign === 1 ? w : b
    // the answer must be local: a best move elsewhere (tenuki, miai) makes it no tsumego
    return first.pv[0] && inBox(first.pv[0], f.box) ? [cardOf(p, f, sign, first, other, now)] : []
  })
}

// ---------- the store: games mined, today's count, problems waiting for a later day ----------
export interface Mined { v: 1; done: string[]; day: string; made: number; wait: Exercise[] }
export const KEY = 'masame.tsumego', DONE_CAP = 2000
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export const emptyMined = (): Mined => ({ v: 1, done: [], day: today(), made: 0, wait: [] })

/** Up to PER_DAY new problems a day: the ones beyond wait (oldest first) for the next days. `fresh`: new, not already known. */
export function admit(m: Mined, fresh: Exercise[], now: number): { m: Mined; add: Exercise[] } {
  const made = m.day === today(now) ? m.made : 0, all = [...m.wait, ...fresh], n = Math.max(0, Math.min(all.length, PER_DAY - made))
  return { m: { ...m, day: today(now), made: made + n, wait: all.slice(n) }, add: all.slice(0, n) }
}
/** Mining may start another game: nothing waits and today's quota isn't used up. */
export const canMine = (m: Mined, now: number) => !m.wait.length && (m.day !== today(now) || m.made < PER_DAY)
export const markDone = (m: Mined, id: string): Mined => ({ ...m, done: [...m.done.filter(x => x !== id), id].slice(-DONE_CAP) })

export function loadMined(st: Storage = localStorage): Mined {
  try {
    const j = JSON.parse(st.getItem(KEY) ?? 'null')
    if (j?.v === 1 && Array.isArray(j.done) && typeof j.day === 'string' && Number.isInteger(j.made) && Array.isArray(j.wait))
      return { v: 1, done: j.done.filter((x: unknown) => typeof x === 'string'), day: j.day, made: j.made, wait: j.wait.filter((x: Exercise) => isItem(x) && x.kind === 'ld') }
  } catch { /* storage disabled or garbage: start again (the deck dedupes what comes back) */ }
  return emptyMined()
}
export function saveMined(m: Mined, st: Storage = localStorage) {
  try { st.setItem(KEY, JSON.stringify(m)) } catch { /* private mode: this session only */ }
}

type Read = { scoreLead: number; pv: (Vertex | null)[]; ownership: number[] | null }
/**
 * Reads one reviewed game: each sampled position twice (Black first, then White first, both in flight), its problems
 * deduped by position and chain. null when `live` turned false (nothing kept: the game is read again later).
 */
export async function mineGame(game: Game, moments: number[], end: number, vs: string, ask: (g: Game) => Promise<Read>,
  live: () => boolean, now: number, random = Math.random): Promise<Exercise[] | null> {
  const { size, komi } = game.info, out = new Map<string, Exercise>()
  for (const i of samples(moments, end)) {
    if (!live()) return null
    const signMap = game.boards[i].signMap
    const [b, w] = await Promise.all([ask(positionAt(signMap, size, komi, 1)), ask(positionAt(signMap, size, komi, -1))])
    for (const x of problemsAt({ signMap, size, komi, n: game.moveNumber(i) + 1, vs }, b, w, now, random)) if (!out.has(ldKey(x))) out.set(ldKey(x), x)
  }
  return live() ? [...out.values()] : null
}
