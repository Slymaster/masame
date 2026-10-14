// Human-like bot: pure decision logic (no engine, no DOM) so it can be tested with a seeded RNG.

export const RANKS = [...Array.from({ length: 20 }, (_, i) => `${20 - i}k`), ...Array.from({ length: 9 }, (_, i) => `${i + 1}d`)]
export const DEFAULT_RANK = '10k'

export const clampRank = (r: string) => (RANKS.includes(r) ? r : DEFAULT_RANK)
export const stepRank = (r: string, d: number) => RANKS[Math.max(0, Math.min(RANKS.length - 1, RANKS.indexOf(clampRank(r)) + d))]
export const humanProfile = (r: string) => `rank_${clampRank(r)}`

/** After a finished game: one rank toward a 50 % win rate (the player won → the bot gets stronger). */
export const adjustRank = (r: string, botWon: boolean) => stepRank(r, botWon ? -1 : 1)

/** [point index, probability]: human policy over legal board points (pass excluded), tempered, renormalised, tiny moves dropped. */
export function humanDistribution(policy: number[], legal: (i: number) => boolean, temperature = 1, floor = 0.01): [number, number][] {
  const w: [number, number][] = []
  for (let i = 0; i < policy.length - 1; i++) { // last entry is pass
    const p = policy[i]
    if (Number.isFinite(p) && p > 0 && legal(i)) w.push([i, p ** (1 / temperature)])
  }
  const norm = (d: [number, number][]) => { const s = d.reduce((a, [, p]) => a + p, 0); return d.map(([i, p]) => [i, p / s] as [number, number]) }
  const all = norm(w), kept = all.filter(([, p]) => p >= floor)
  return kept.length ? norm(kept) : all
}

export function sample(dist: [number, number][], rand: () => number): number | null {
  let r = rand()
  for (const [i, p] of dist) if ((r -= p) < 0) return i
  return dist.length ? dist[dist.length - 1][0] : null
}

/** Shannon entropy normalised to 0..1 (0 = one obvious move, 1 = all moves equally likely). */
export function entropy(dist: [number, number][]): number {
  if (dist.length < 2) return 0
  return -dist.reduce((a, [, p]) => a + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(dist.length)
}

/** Human-like pause: 0.5 s for an obvious move up to 2.5 s for a wide-open position. */
export const thinkDelay = (h: number, rand: () => number) => Math.round(Math.min(2500, Math.max(500, 500 + 2000 * h * (0.8 + 0.4 * rand()))))

/** No resignation before this move number: 80 on 19×19, scaled by board area. */
export const resignFrom = (size: number) => Math.round((80 * size * size) / 361)

/** Every empty point is clearly someone's or clearly neutral: nothing left to fight over. */
export function settled(ownership: number[] | null, signMap: number[][]): boolean {
  if (!ownership) return false
  const n = signMap.length
  return signMap.every((row, y) => row.every((s, x) => {
    const o = Math.abs(ownership[y * n + x])
    return s !== 0 || o >= 0.75 || o <= 0.15
  }))
}

export interface BotInput {
  humanPolicy: number[]
  topMove: string // KataGo's best move ("pass" or a coordinate)
  botWinrate: number // from the bot's point of view
  history: number[] // the bot's previous winrates in this game, oldest first
  ownership: number[] | null
  signMap: number[][]
  opponentPassed: boolean
  moveNumber: number
  mayResign: boolean
  legal: (i: number) => boolean
}

export type BotMove = { kind: 'play'; index: number; delay: number } | { kind: 'pass'; delay: number } | { kind: 'resign' }

export function decide(b: BotInput, rand: () => number): BotMove {
  const size = b.signMap.length
  const wr = [...b.history, b.botWinrate].slice(-3)
  if (b.mayResign && b.moveNumber >= resignFrom(size) && wr.length === 3 && wr.every(w => w < 0.03)) return { kind: 'resign' }
  const dist = humanDistribution(b.humanPolicy, b.legal)
  const delay = thinkDelay(entropy(dist), rand)
  if (b.topMove === 'pass' && (b.opponentPassed || settled(b.ownership, b.signMap))) return { kind: 'pass', delay: 600 }
  const index = sample(dist, rand)
  return index === null ? { kind: 'pass', delay } : { kind: 'play', index, delay }
}
