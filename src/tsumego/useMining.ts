// The tsumego miner: whenever the engine is free (the automatic review's condition), the newest reviewed library game
// not mined yet is read for status problems, behind App's other readings; at most PER_DAY new problems a day reach the deck.
import { useEffect, useReducer, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { Exercise } from '../exercises/deck'
import type { Game } from '../game'
import { inTauri, type Analysis } from '../katago'
import * as library from '../library'
import { reviewEnd } from '../review'
import { loadSgf } from '../sgf'
import { admit, canMine, ldKey, loadMined, markDone, mineGame, MINE_QUERY, saveMined } from './mine'

const RETRY_MS = 60_000, MAX_FAILS = 3

export function useMining({ free, ask, scanRun, known, add }: {
  free: boolean // nothing else needs the engine, nor the player's attention (never during an ongoing OGS game)
  ask: (g: Game, q: object) => Promise<Analysis> // a background query (priority -1)
  scanRun: RefObject<Promise<unknown>> // App's chain of readings: 2 queries in flight at most
  known: (k: string) => boolean // already in the deck
  add: (xs: Record<string, Exercise>) => void
}) {
  const entries = useSyncExternalStore(library.subscribe, library.get)
  useEffect(() => { if (inTauri()) library.load().catch(() => {}) }, [])
  const m = useRef(loadMined()), busy = useRef(false), fails = useRef(new Map<string, number>())
  const freeRef = useRef(free), latest = useRef({ ask, known, add })
  freeRef.current = free; latest.current = { ask, known, add }
  const [ver, bump] = useReducer((x: number) => x + 1, 0)
  const keep = (xs: Exercise[], now: number) => {
    const r = admit(m.current, xs.filter(x => !latest.current.known(ldKey(x))), now)
    m.current = r.m; saveMined(r.m)
    if (r.add.length) latest.current.add(Object.fromEntries(r.add.map(x => [ldKey(x), x])))
  }

  useEffect(() => {
    if (!free || busy.current || !entries) return
    if (m.current.wait.length) keep([], Date.now()) // a new day: the problems waiting come first
    if (!canMine(m.current, Date.now())) return
    const e = entries.find(e => e.review && e.size <= 19 && !m.current.done.includes(e.id) && (fails.current.get(e.id) ?? 0) < MAX_FAILS)
    if (!e) return
    busy.current = true
    const run = scanRun.current.catch(() => {}).then(async () => {
      const [sgf, rv] = await Promise.all([library.read(e.id), library.sidecar<library.ReviewSidecar>(e.id, 'review')])
      const game = loadSgf(sgf), vs = e.me === 1 ? e.white.name : e.me === -1 ? e.black.name : ''
      return mineGame(game, (rv?.moments ?? []).map(x => x.at), reviewEnd(game), vs, g => latest.current.ask(g, MINE_QUERY), () => freeRef.current, Date.now())
    })
    scanRun.current = run
    run.then(xs => {
      busy.current = false
      if (!xs) return // interrupted: read again from the start when the engine is free
      m.current = markDone(m.current, e.id)
      keep(xs, Date.now())
      bump()
    }, err => {
      console.error('tsumego mining', err)
      busy.current = false
      fails.current.set(e.id, (fails.current.get(e.id) ?? 0) + 1)
      setTimeout(bump, RETRY_MS)
    })
  }, [free, entries, ver, scanRun]) // eslint-disable-line react-hooks/exhaustive-deps
}
