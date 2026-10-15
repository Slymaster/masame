// The mentor in a game against the AI (src/mentor.ts): one Mentor per game, the stop it is in, Try again / Keep it, and
// the library entry's era and stops (once the game has an id).
import { useEffect, useRef, useState } from 'react'
import type { Game, GameNode } from './game'
import { analyze } from './katago'
import * as library from './library'
import { Mentor, MENTOR_QUERY } from './mentor'

export function useMentor({ game, bot, thinkingTime, changed }: {
  game: Game; bot: { era?: number; mentor?: true } | null
  thinkingTime: boolean // the player's turn at the end of the line: the position is read meanwhile
  changed: () => void
}) {
  const mentors = useRef(new WeakMap<Game, Mentor>())
  let mentor = bot?.mentor ? mentors.current.get(game) : undefined
  if (bot?.mentor && !mentor) mentors.current.set(game, mentor = new Mentor(g => analyze(g, MENTOR_QUERY).then(a => a.scoreLead)))
  const [stop, setStop] = useState<{ node: GameNode; loss: number } | null>(null)
  // the stop holds while its move is the end of the shown line (an undo or another game ends it)
  const stopped = mentor && stop && stop.node === game.nodes[game.cursor] && game.cursor === game.moves.length ? stop : null
  useEffect(() => { if (mentor && thinkingTime) mentor.prefetch(game) })

  const patched = useRef('')
  useEffect(() => {
    const id = library.idOf(game), p = { ...bot?.era && { era: bot.era }, ...mentor && { mentor: { stops: mentor.stops } } }
    const k = id && Object.keys(p).length ? id + JSON.stringify(p) : ''
    if (!k || k === patched.current) return
    patched.current = k
    library.patch(id!, p).catch(() => {}) // outside the app there is no library
  })

  return {
    mentor, stopped, stops: mentor?.stops ?? 0,
    /** The cost of the player's last move when the mentor stops it, else null (no mentor, under the threshold, kept, late). */
    check: (g: Game) => (mentor ? mentor.check(g) : Promise.resolve(null)),
    stop: (g: Game, loss: number) => setStop({ node: g.nodes[g.cursor], loss }),
    /** Try again: the move goes, not counted as an undo. */
    retry: () => { if (stopped && game.undo()) { setStop(null); changed() } },
    /** Keep it: the AI replies, and the move is never examined again. */
    keep: () => { if (stopped) { mentor!.keep(stopped.node); setStop(null); changed() } },
  }
}
