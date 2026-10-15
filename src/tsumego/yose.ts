// Yose: "the biggest move?" on endgame positions of your library's games, found again for each session (never stored).
// A position is kept when KataGo's best move beats its second by YOSE_GAP points or more.
import { stringifyVertex } from '@sabaki/sgf'
import type { Exercise } from '../exercises/deck'
import type { Game, Sign, Vertex } from '../game'
import type { Analysis } from '../katago'
import * as library from '../library'
import { phaseOf, reviewEnd } from '../review'
import { loadSgf } from '../sgf'
import { positionAt, stonesOf } from './mine'

export const YOSE_N = 8, YOSE_EVERY = 7, YOSE_GAP = 2, YOSE_MS = 60_000, YOSE_GAMES = 12
export const YOSE_QUERY = { maxVisits: 100, analysisPVLen: 5, overrideSettings: { maxTime: 1 } }

/** Endgame positions of a game (indices into its moves): phase 2, one every YOSE_EVERY moves (odd: Black and White take turns asking), each with a move played from it. */
export function yoseSamples(game: Game): number[] {
  const end = Math.min(reviewEnd(game), game.moves.length), out: number[] = []
  let last = -Infinity
  for (let i = 0; i < end; i++) {
    const m = game.moves[i]
    if (m.setup || !m.vertex || phaseOf(game.moveNumber(i) + 1, game.info.size) !== 2 || i - last < YOSE_EVERY) continue
    out.push(i); last = i
  }
  return out
}

const code = (v: Vertex | null) => (v ? stringifyVertex(v) : 'tt')
/** The position as a question, or null when its two best moves are too close (or one is a pass). */
export function yoseOf(game: Game, i: number, a: Analysis, vs: string, now: number): Exercise | null {
  const [m1, m2] = a.moves, sign = game.moves[i].sign as Sign
  if (!m1?.v || !m2?.v || !a.pv[0]) return null
  const gap = sign * (m1.scoreLead - m2.scoreLead)
  if (gap < YOSE_GAP) return null
  const { size, komi } = game.info, s = stonesOf(game.boards[i].signMap)
  return {
    kind: 'yose', t: now, vs, size, komi, b: s.black.map(code).join(''), w: s.white.map(code).join(''), moves: '', sign,
    played: code(m2.v), loss: gap, best: m1.scoreLead, better: a.pv.map(code).join(''), punish: '', n: game.moveNumber(i) + 1,
  }
}

/** Up to YOSE_N questions from the games' endgames, in random order, until the candidates run out or YOSE_MS have passed. */
export async function findYose(games: { game: Game; vs: string }[], ask: (g: Game) => Promise<Analysis>, live: () => boolean,
  progress: (kept: number) => void, now: number, random = Math.random): Promise<Exercise[]> {
  const cands = games.flatMap(g => yoseSamples(g.game).map(i => ({ ...g, i })))
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]] }
  const out: Exercise[] = [], until = Date.now() + YOSE_MS
  for (const c of cands) {
    if (!live() || out.length >= YOSE_N || Date.now() > until) break
    const x = yoseOf(c.game, c.i, await ask(positionAt(c.game.boards[c.i].signMap, c.game.info.size, c.game.info.komi, c.game.moves[c.i].sign as Sign)), c.vs, now)
    if (x) { out.push(x); progress(out.length) }
  }
  return out
}

/** The library's newest games (a game that doesn't load is skipped). */
export async function libraryGames(max = YOSE_GAMES): Promise<{ game: Game; vs: string }[]> {
  const out: { game: Game; vs: string }[] = []
  for (const e of (await library.load()).filter(e => e.size <= 19)) {
    if (out.length >= max) break
    try { out.push({ game: loadSgf(await library.read(e.id)), vs: e.me === 1 ? e.white.name : e.me === -1 ? e.black.name : '' }) } catch { /* unreadable: skipped */ }
  }
  return out
}
