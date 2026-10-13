import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { BoardView } from './board/BoardView'
import type { Board3D, Board3DOptions, Board3DState, FallbackReason, TimeMode } from './board3d/Board3D'
import { rng } from './board/noise'
import { adjustRank, clampRank, decide, DEFAULT_RANK, humanProfile, stepRank } from './bot'
import { askFirst, confirmDiscard, openSgfFile, saveSgfFile } from './files'
import { Game, type Sign, type Vertex } from './game'
import { analyze, call, gtp, inTauri, on, type Analysis, type EngineStatus, type NetState, type Progress } from './katago'
import { Networks } from './Networks'
import { OgsSection } from './OgsSection'
import { Clock } from './Clock'
import { Seg } from './Seg'
import * as ogs from './ogs'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { cardSkin } from './board3d/logic'
import { noDead, score, suggestDead, toggleDead, type Dead } from './scoring'
import { loadSgf, resignResult, saveSgf, scoreResult } from './sgf'
import { failureText, LocalizedError, pick, setLang, storedLang, t, type Lang, type Msg } from './i18n'
import { DECORS, type Decor } from './board3d/decors'
import { isMac, shortcut } from './platform'
import { getVersion } from '@tauri-apps/api/app'
import { checkDue, updateSettings, type UpdateInfo } from './update'
import { fromOf, gradeTry, lessonBoard, readGame, REPLY, verdict, type Moment, type Step } from './review'

const SIZES = [9, 13, 19]
const HUMAN_BYTES = 99_066_230
const BOT_VISITS = 60, TERRITORY_VISITS = 150, FINAL_VISITS = 300
const BOT_ATTEMPTS = 3 // a failed query (engine restarting on another net, crash) is retried after 1 s, then 2 s
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const random = rng(Date.now())

type Renderer = '3d' | '2d'
const LIGHTS: TimeMode[] = ['auto', 'morning', 'afternoon', 'evening']
interface Settings {
  lang: Lang; opponent: 'human' | 'ai' | 'ogs'; ogsSpeed: ogs.Speed; color: 'b' | 'w' | 'r'; myRank: string; aiRank: string; autoAdjust: boolean; delay: boolean; territory: boolean
  renderer: Renderer; camera: Board3DOptions['camera']; light: TimeMode; highContrast: boolean; decor: Decor
  langChosen: boolean; panelHidden: boolean; autoUpdate: boolean; updateChecked: number
}
const SETTINGS_KEY = 'baduk.settings'
function loadSettings(): Settings {
  const d: Settings = {
    lang: 'en', opponent: 'ai', ogsSpeed: 'rapid', color: 'b', myRank: DEFAULT_RANK, aiRank: DEFAULT_RANK, autoAdjust: true, delay: true, territory: false,
    renderer: '3d', camera: 'study', light: 'auto', highContrast: false, decor: 'atelier', langChosen: false, panelHidden: false,
    autoUpdate: true, updateChecked: 0,
  }
  let j: Partial<Settings> = {}
  try { j = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {} } catch { /* private mode or garbage: defaults */ }
  const s = { ...d, ...j }
  return {
    ...s, lang: storedLang(j), langChosen: j.langChosen === true,
    opponent: (['human', 'ai', 'ogs'] as const).includes(s.opponent) ? s.opponent : 'ai',
    ogsSpeed: (['blitz', 'rapid', 'live'] as const).includes(s.ogsSpeed) ? s.ogsSpeed : 'rapid', myRank: clampRank(s.myRank), aiRank: clampRank(s.aiRank),
    renderer: j.renderer === '2d' || j.renderer === '3d' ? j.renderer : webgl2() ? '3d' : '2d',
    camera: s.camera === 'contemplation' ? 'contemplation' : 'study', light: LIGHTS.includes(s.light) ? s.light : 'auto', highContrast: s.highContrast === true,
    decor: DECORS.includes(s.decor) ? s.decor : 'atelier', panelHidden: s.panelHidden === true, ...updateSettings(j),
  }
}

/** Board3D.supported() without loading three.js, which stays out of the first bundle (same check). */
function webgl2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch { return false }
}

/** What App drives, whichever renderer is mounted: the Canvas2D BoardView ("light") or the lazily loaded Board3D. */
type View = { update(s: Board3DState): void; drop(v: Vertex, c: Sign): void; pass?(c: Sign): void; destroy(): void }

function Goban({ state, onPlay, view, mode, options, thinking, onFallback, children }: {
  state: Board3DState; onPlay: (v: Vertex) => boolean; view: React.RefObject<View | null>
  mode: Renderer; options: Board3DOptions; thinking: boolean; onFallback: (r: FallbackReason) => void; children?: React.ReactNode
}) {
  const wrap = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), three = useRef<Board3D | null>(null)
  const latest = useRef({ onPlay, onFallback, state, options, thinking })
  latest.current = { onPlay, onFallback, state, options, thinking }
  useEffect(() => {
    let live = true, v: View | undefined, ro: ResizeObserver | undefined
    const play = (p: Vertex) => latest.current.onPlay(p)
    const mount = (nv: View, fit: (r: DOMRectReadOnly) => void) => {
      v = view.current = nv
      if (import.meta.env.DEV) Object.assign(window, { __badukView: nv }) // UI tests: Board3D.debug.project
      nv.update(latest.current.state)
      ro = new ResizeObserver(([e]) => fit(e.contentRect))
      ro.observe(wrap.current!)
    }
    if (mode === '2d') {
      const b = new BoardView(canvas.current!, play)
      mount(b, r => b.resize(Math.min(r.width, r.height)))
    } else {
      // three.js is a lazy chunk; until it boots the canvas stays empty and Board3D fades in on its first frame
      import('./board3d/Board3D').then(({ Board3D }) => {
        if (!live) return
        const b = three.current = new Board3D(canvas.current!, play, { options: latest.current.options, onFallback: r => latest.current.onFallback(r) })
        b.setThinking(latest.current.thinking)
        // full-bleed canvas (fixed, the whole window); the board stays framed in .board-wrap's rectangle
        mount(b, () => b.resize(innerWidth, innerHeight, wrap.current!.getBoundingClientRect()))
      }, () => live && latest.current.onFallback('webgl2'))
    }
    return () => { live = false; ro?.disconnect(); v?.destroy(); view.current = three.current = null }
  }, [mode, view])
  useEffect(() => { view.current?.update(state); if (import.meta.env.DEV) Object.assign(window, { __badukState: state }) })
  useEffect(() => three.current?.setOptions(options), [options.camera, options.time, options.highContrast, options.decor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => three.current?.setThinking(thinking), [thinking])
  // a fresh canvas per renderer: one canvas can't hold both a 2D and a WebGL context
  return <div className="board-wrap" ref={wrap}><canvas key={mode} ref={canvas} data-r={mode} aria-label={t.boardLabel(state.signMap.length)} />{children}</div>
}

/** State holding a Msg, rendered at display time (a bare function given to useState's setter would run as an updater). */
function useMsg() {
  const [m, set] = useState<Msg | null>(null)
  return [m, useCallback((v: Msg | null) => set(() => v), [])] as const
}

function Switch({ label, k, on, toggle, disabled, title }: { label: string; k?: string; on: boolean; toggle: () => void; disabled?: boolean; title?: string }) {
  return (
    <div className="row" onClick={disabled ? undefined : toggle} title={title}>
      <span>{label} {k && <kbd>{k}</kbd>}</span>
      <button className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={e => { e.stopPropagation(); toggle() }} />
    </div>
  )
}

function Stepper({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <div className="row stepper">
      <span>{label}</span>
      <span className="step">
        <button onClick={() => set(stepRank(value, 1))} aria-label={t.stronger(label)}>‹</button>
        <output aria-live="polite">{value}</output>
        <button onClick={() => set(stepRank(value, -1))} aria-label={t.weaker(label)}>›</button>
      </span>
    </div>
  )
}

export function App() {
  const [game, setGame] = useState(() => new Game({ size: 19 }))
  const [ver, rerender] = useReducer((x: number) => x + 1, 0) // Game is mutable; bump after each change
  const verRef = useRef(ver)
  verRef.current = ver
  const view = useRef<View>(null)
  const [nextSize, setNextSize] = useState(19)
  const [coords, setCoords] = useState(true)
  const [sound, setSound] = useState(true)
  const [note, setNote] = useMsg()
  const [dirty, setDirty] = useState(false) // moves played/undone since the last new game, open or save
  // the language lives in the settings; t is switched before the render that uses it
  const [settings, setSettings] = useState(() => { const s = loadSettings(); setLang(s.lang); return s })
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings(s => ({ ...s, [k]: v }))
  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* private mode */ } }, [settings])

  // the current match against the bot (null = two players), its result, and the bot's past winrates for resigning
  const [bot, setBot] = useState<{ sign: Sign; rank: string } | null>(null)
  const [result, setResult] = useMsg()
  const [thinking, setThinking] = useState(false)
  const winrates = useRef<number[]>([])
  const scored = useRef<Game | null>(null)
  const [botError, setBotError] = useMsg()
  const [botRetry, retryBot] = useReducer((x: number) => x + 1, 0)
  // the followed OGS game (its leave() in a ref), an automatch search, the socket's state
  const [online, setOnline] = useState<ogs.Followed | null>(null)
  const leaveOnline = useRef<(() => void) | null>(null)
  const [search, setSearch] = useState<{ size: number; speed: ogs.Speed } | null>(null)
  const [joining, setJoining] = useState(false) // followed, its first gamedata not here yet
  const searching = useRef<(() => void) | null>(null) // cancels the pending automatch
  const ogsStatus = useSyncExternalStore(ogs.onStatus, ogs.getStatus)
  const [session2d, setSession2d] = useState(false) // 2D after a WebGL context loss, for this session only
  const renderer: Renderer = session2d ? '2d' : settings.renderer
  // the card's skin follows the scene's backdrop; set before paint, and crossfaded only once the first frame is shown
  const skin = cardSkin(renderer, settings.camera, settings.decor)
  useLayoutEffect(() => { document.documentElement.dataset.skin = skin }, [skin])
  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '' })) }, [])
  // counting phase after two passes: which stones are dead (suggested by KataGo, toggled by the player)
  const [counting, setCounting] = useState<{ game: Game; dead: Dead; own: number[] | null } | null>(null)

  const [engine, setEngine] = useState<EngineStatus>({ state: 'stopped' })
  const [nets, setNets] = useState<NetState | null>(null)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [sheet, setSheet] = useState<'game' | 'settings' | 'view' | 'nets' | null>(null) // 'view': Settings, at Display
  // the control a sheet returns focus to (WebKit doesn't focus clicked buttons), kept when one sheet opens another
  const opener = useRef<HTMLElement | null>(null), netsFromSettings = useRef(false)
  const openSheet = (s: NonNullable<typeof sheet>) => (e: React.MouseEvent<HTMLElement>) => {
    if (!e.currentTarget.closest('.sheet')) { opener.current = e.currentTarget; netsFromSettings.current = false }
    setSheet(s)
  }
  const [own, setOwn] = useState<{ game: Game; data: number[] | null; score: number } | null>(null)
  // game review: null = off; moments null while reading; branch = the lesson's variation (null while reading or clean)
  const [review, setReview] = useState<{ side: Sign | 0; pct: number; error: unknown; moments: Moment[] | null; k: number; step: Step
    branch: Game | null; ask: boolean; gap: number | null; explored: boolean } | null>(null)
  const [reviewTry, retryReview] = useReducer((x: number) => x + 1, 0)
  const scan = useRef<{ last: Game['board']; leads: (number | undefined)[] } | null>(null) // scan leads of the record ending on `last`
  const scanRun = useRef<Promise<unknown>>(Promise.resolve()) // the last readGame or answer: the next one starts once it settles (2 queries at most)

  const refreshNets = useCallback(() => { if (inTauri()) call<NetState>('networks_state').then(setNets, () => {}) }, [])
  useEffect(() => {
    if (!inTauri()) return
    refreshNets()
    call<EngineStatus>('engine_status').then(setEngine, () => {})
    const subs = [
      on<EngineStatus>('engine-status', setEngine),
      on<Progress>('network-progress', p => {
        setProgress(m => ({ ...m, [p.name]: p }))
        if (p.state !== 'downloading' && p.state !== 'verifying') refreshNets()
      }),
    ]
    return () => { subs.forEach(s => s.then(off => off())) }
  }, [refreshNets])

  const canAnalyze = !!nets?.active
  const canPlayAI = canAnalyze && !!nets?.installed.some(i => i.complete && i.name === nets.human)
  const engineBusy = engine.state === 'starting' || engine.state === 'tuning' || engine.state === 'warming'

  // Start the engine a few seconds after launch when an AI game is likely, so a first-run OpenCL tuning (minutes)
  // happens while the player sets up rather than on the bot's first move.
  const earlyStart = useRef(false)
  useEffect(() => {
    if (earlyStart.current || settings.opponent !== 'ai' || !canPlayAI) return
    const id = setTimeout(() => { earlyStart.current = true; call('engine_start').catch(() => {}) }, 5000) // errors arrive as engine-status
    return () => clearTimeout(id)
  }, [settings.opponent, canPlayAI])

  // Updates: a silent check at launch (at most daily, unless turned off), a manual one, install on click only.
  const [version, setVersion] = useState('')
  const [upd, setUpd] = useState<{ s: 'idle' | 'checking' | 'latest' } | ({ s: 'available' | 'installing' } & UpdateInfo)
    | ({ s: 'downloading'; pct: number | null } & UpdateInfo) | { s: 'error'; error: unknown; retry?: UpdateInfo }>({ s: 'idle' })
  const checkUpdate = (silent: boolean) => {
    if (!silent) setUpd({ s: 'checking' })
    call<UpdateInfo | null>('update_check').then(
      u => { if (u) setUpd({ s: 'available', ...u }); else if (!silent) setUpd({ s: 'latest' }) },
      e => { if (!silent) setUpd({ s: 'error', error: e }) })
  }
  const launchCheck = useRef(false)
  useEffect(() => {
    if (!inTauri() || launchCheck.current) return
    launchCheck.current = true
    getVersion().then(setVersion, () => {})
    const now = Date.now()
    if (settings.autoUpdate && checkDue(now, settings.updateChecked)) { set('updateChecked', now); checkUpdate(true) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const subs = [
      on<{ received: number; total: number | null }>('update-progress', p => setUpd(u => u.s !== 'downloading' ? u
        : { ...u, pct: p.total ? Math.min(100, Math.floor(p.received / p.total * 100)) : null })),
      on('update-installing', () => setUpd(u => u.s === 'downloading' ? { ...u, s: 'installing' } : u)),
    ]
    return () => { subs.forEach(s => s.then(off => off())) }
  }, [])
  const installUpdate = async ({ version, install }: UpdateInfo) => {
    if (!install) return void call('open_link', { which: 'releases' }).catch(() => {})
    if (!(await canLeave())) return
    setUpd({ s: 'downloading', version, install, pct: null })
    // on success the app restarts; on failure Rust keeps the update, so it can be installed again
    call('update_install').catch(e => setUpd({ s: 'error', error: e, retry: { version, install } }))
  }

  const changed = () => { setNote(null); setBotError(null); rerender() }
  const atEnd = game.cursor === game.moves.length
  // OGS forbids engine help in an ongoing game: no KataGo query of any kind until it is finished
  const ongoing = !!online && online.phase !== 'finished'
  const removal = online?.phase === 'stone removal' && atEnd ? online : null
  const humanTurn = joining ? false : online ? online.phase === 'play' && atEnd && game.toPlay === online.me : !bot || game.toPlay !== bot.sign
  const mine: Sign | 0 = bot ? -bot.sign as Sign : online?.me ?? 0 // the side a review looks at
  const shown = review?.branch ?? game
  const m = review?.moments?.[review.k]
  const from = m ? fromOf(m, review!.step) : 0
  const reading = !!review && !review.moments
  // ① takes only the punisher's moves (← may show the engine's turn); ② and ③ explore freely
  const lessonPlayable = !!review?.branch && !thinking && !shown.ended && !review.error && (review.step !== 'try' || shown.toPlay === -m!.sign)
  const countingNow = !review && counting?.game === game && game.ended && atEnd ? counting : null
  const reviewShown = inTauri() && game.info.size <= 19 && game.moves.length > 0 && (!bot || !!result) && !ongoing
  const canReview = reviewShown && canAnalyze
  const locked = !!result && (!!bot || atEnd) // two players may branch off a validated game from an earlier move
  const play = (v: Vertex | null) => {
    if (countingNow) {
      if (v && !result) setCounting({ ...countingNow, dead: toggleDead(game.board.signMap, countingNow.dead, v) })
      return false
    }
    if (review) {
      if (!lessonPlayable || !v) return false // after an error, only Try again goes on
      const r = shown.play(v)
      if (r === 'ok') {
        const graded = shown.cursor === from + 1 // a new try from the lesson's start: graded again
        setReview(x => x && { ...x, ask: true, explored: x.explored || x.step !== 'try', gap: graded ? null : x.gap })
        changed()
      } else if (pick(t.refused, r)) setNote(d => pick(d.refused, r)!)
      return r === 'ok'
    }
    if (removal) {
      const r = v && ogs.removalToggle(game.board.signMap, removal.removed, v)
      if (r) send(() => ogs.setRemoved(removal.id, r.stones, r.removed))
      return false
    }
    if (locked || !humanTurn) return false
    const r = game.play(v)
    if (r === 'ok' && online) { changed(); if (!send(() => ogs.move(online.id, v))) game.undo() } // optimistic: OGS echoes it back
    else if (r === 'ok') { setDirty(true); setCounting(null); if (!bot) setResult(null); changed() }
    else if (pick(t.refused, r)) setNote(d => pick(d.refused, r)!)
    return r === 'ok'
  }
  const undo = () => {
    if (review || bot && result || online) return
    let undone = false
    // against the bot, take back to the player's last move
    while (game.undo()) { undone = true; if (!bot || game.cursor === 0 || game.toPlay !== bot.sign) break }
    if (undone) { winrates.current = winrates.current.slice(0, Math.ceil(game.cursor / 2)); setDirty(true); setCounting(null); changed() }
    if (undone && !bot) setResult(null) // two players: counted again if the game ends again (Game.undo dropped the RE)
  }
  const goTo = (i: number) => {
    i = Math.max(review?.branch ? from : 0, Math.min(shown.moves.length, i))
    if (i === shown.cursor) return
    shown.goTo(i) // in a lesson, an owed answer (ask) waits until the cursor is back at the branch end
    changed()
  }
  // online is cleared only here, and only with the board replaced: an unfinished OGS position never becomes a local
  // game open to KataGo (a finished one may stay, see signOut)
  const stopOnline = () => { leaveOnline.current?.(); leaveOnline.current = null; setOnline(null); setJoining(false) }
  const start = (g: Game, b: typeof bot) => { cancelSearch(); stopOnline(); show(g, b) }
  const show = (g: Game, b: typeof bot) => {
    setGame(g); setBot(b); setResult(null); setNote(null); setBotError(null); setDirty(false); setOwn(null); setCounting(null); setReview(null); winrates.current = []
  }
  /** Leaving the shown game: an unfinished OGS game goes on without us; unsaved moves are lost. */
  const canLeave = async () => ongoing ? askFirst(t.ogsLeaveAsk, t.ogsLeave) : !dirty || confirmDiscard()
  // an action that may replace the game cancels a pending search before any picker, download or dialog: a match
  // starting meanwhile would be abandoned without the leave question; backing out leaves the search cancelled
  const newGame = async (size = nextSize) => {
    cancelSearch()
    if (!(await canLeave())) return
    setNextSize(size)
    if (settings.opponent === 'ai' && canPlayAI) {
      const me: Sign = settings.color === 'b' ? 1 : settings.color === 'w' ? -1 : random() < 0.5 ? 1 : -1
      const rank = settings.aiRank, name = t.botName(rank)
      start(new Game({ size, playerBlack: me === 1 ? '' : name, playerWhite: me === 1 ? name : '' }), { sign: -me as Sign, rank })
    } else start(new Game({ size }), null)
  }
  const open = async (read: () => Promise<string | null> = openSgfFile, asked = false) => {
    cancelSearch()
    try {
      const text = await read()
      if (text === null) return
      const g = loadSgf(text)
      if (!asked && !(await canLeave())) return
      start(g, null); setNextSize(SIZES.includes(g.info.size) ? g.info.size : nextSize)
    } catch (e) {
      setNote(d => d.openFailed(failureText(e, d)))
    }
  }
  const save = async () => {
    try {
      if (bot) game.info[bot.sign === 1 ? 'playerBlack' : 'playerWhite'] = t.botName(bot.rank) // the SGF keeps the language it was saved in
      if (await saveSgfFile(saveSgf(game), t.fileName(game.info.size))) { setDirty(false); setNote(d => d.saved) }
    } catch (e) {
      setNote(d => d.saveFailed(failureText(e, d)))
    }
  }

  // OGS: a socket send fails only when signed out
  const send = (f: () => void) => { try { f(); return true } catch (e) { setNote(d => failureText(e, d)); return false } }
  const follow = (id: number) => {
    start(new Game({ size: game.info.size }), null); setJoining(true) // an empty board, not playable, until the gamedata
    let shownGame: Game | null = null, len = 0, error: Msg | null = null
    try {
      leaveOnline.current = ogs.follow(id, (ev, s) => {
        if (ev[0] === 'error') setNote(error = d => failureText(typeof ev[1] === 'string' ? { code: ev[1] } : ev[1], d))
        if (s) setJoining(false)
        if (!s) return
        if (s.game !== shownGame) { // first gamedata or a reload, which an error asks for: the error stays shown
          shownGame = s.game; show(s.game, null)
          if (error) setNote(error)
          error = null
        } else if (ev[0] === 'move' && s.game.moves.length > len) {
          const m = s.game.lastMove!
          if (m.sign !== s.me) { if (m.vertex) view.current?.drop(m.vertex, m.sign); else view.current?.pass?.(m.sign) }
          changed()
        }
        len = s.game.moves.length
        const r = s.result
        setOnline(s); setResult(r ? d => d.ogsResult(r.winner, r.how, r.points) : null)
      })
    } catch (e) { setNote(d => failureText(e, d)) }
  }
  const resume = async (id: number) => { if (online?.id === id) return; cancelSearch(); if (await canLeave()) follow(id) }
  const importGame = async (id: number) => { cancelSearch(); if (await canLeave()) open(() => ogs.sgf(id), true) }
  const find = async () => {
    if (!(await canLeave())) return // the shown game is left once a match starts
    cancelSearch()
    try {
      const size = nextSize as ogs.BoardSize, speed = settings.ogsSpeed, m = ogs.findMatch(size, speed)
      searching.current = m.cancel
      setSearch({ size, speed })
      m.started.then(id => { searching.current = null; follow(id) })
    } catch (e) { setNote(d => failureText(e, d)) }
  }
  const cancelSearch = () => { searching.current?.(); searching.current = null; setSearch(null) }
  /** Before signing out: an unfinished OGS game is left (asked first) and its board replaced; a finished one stays. */
  const signOut = async () => {
    if (ongoing && !(await askFirst(t.ogsLeaveAsk, t.ogsLeave))) return false
    if (ongoing) start(new Game({ size: game.info.size }), null)
    else { cancelSearch(); stopOnline() }
    return true
  }

  /** End of a game: record the result (and, against the bot, nudge its rank toward a 50 % win rate, once). */
  const finish = (text: Msg, botWon: boolean | null, re: string) => {
    setResult(text)
    game.info.result = re
    if (!bot || scored.current === game || botWon === null) return
    scored.current = game
    if (settings.autoAdjust) {
      const next = adjustRank(bot.rank, botWon)
      if (next !== bot.rank) { set('aiRank', next); setNote(d => d.rankAdjusted(next)) }
    }
  }
  const resign = async () => {
    if (online) { if (!result && await askFirst(t.ogsResignAsk, t.resign)) send(() => ogs.resign(online.id)); return }
    if (!bot || result) return
    finish(d => d.resigns(-bot.sign), true, resignResult(bot.sign))
  }
  const final = countingNow && score(game.board.signMap, countingNow.dead, { black: game.board.getCaptures(1), white: game.board.getCaptures(-1) }, game.info.komi, countingNow.own)
  const validate = () => {
    if (!final || result) return
    finish(d => d.score(final.lead), bot && final.lead !== 0 ? (final.lead > 0) === (bot.sign === 1) : null, scoreResult(final.lead))
  }

  // Game review: reading (scan + deep checks), then lessons on the branch boards
  const startReview = (side: Sign | 0) => {
    const last = game.boards.at(-1)!
    if (scan.current?.last !== last) scan.current = { last, leads: [] }
    setReview({ side, pct: 0, error: null, moments: null, k: 0, step: 'try', branch: null, ask: false, gap: null, explored: false })
    changed()
  }
  const openMoment = (k: number, step: Step, moments = review!.moments!) => {
    const branch = moments[k] ? lessonBoard(game, moments[k], step) : null
    setReview(x => x && { ...x, moments, k, step, branch, ask: false, gap: null, explored: false, error: null })
    changed()
  }
  const leaveReview = () => { setReview(null); changed() }
  const retryLesson = () => { setReview(x => x && { ...x, error: null }); retryReview() }

  // The bot's turn: ask KataGo (human policy at the bot's rank + a small search), then play after a human-like pause.
  // A failed query is retried (the Rust side restarts a crashed engine and waits until it is warm); after the last
  // attempt the note offers "Réessayer" — undo and new game stay available throughout.
  const botTurn = !!bot && !result && !game.ended && atEnd && game.toPlay === bot.sign
  useEffect(() => {
    if (!botTurn || !bot) return
    let live = true
    const t0 = performance.now()
    setThinking(true)
    setBotError(null)
    const ask = async (attempt = 1): Promise<Analysis> => {
      try {
        return await analyze(game, {
          maxVisits: BOT_VISITS, includePolicy: true, includeOwnership: true,
          overrideSettings: { humanSLProfile: humanProfile(bot.rank), ignorePreRootHistory: false },
        })
      } catch (e) {
        if (!live || attempt >= BOT_ATTEMPTS) throw e
        await sleep(1000 * attempt)
        if (!live) throw e // undo / new game during the wait: send nothing more
        return ask(attempt + 1)
      }
    }
    ask().then(async a => {
      if (!live) return
      if (!a.humanPolicy) throw new LocalizedError(d => d.humanSilent)
      const n = game.info.size, botWinrate = bot.sign === 1 ? a.winrate : 1 - a.winrate
      const m = decide({
        humanPolicy: a.humanPolicy, topMove: a.topMove, botWinrate, history: winrates.current, ownership: a.ownership,
        signMap: game.board.signMap, opponentPassed: !!game.lastMove && !game.lastMove.vertex, moveNumber: game.cursor,
        legal: i => game.isLegal([i % n, Math.floor(i / n)]),
      }, random)
      winrates.current = [...winrates.current, botWinrate]
      if (m.kind === 'resign') return finish(d => d.resigns(bot.sign), false, resignResult(-bot.sign as Sign))
      const wait = settings.delay ? m.delay - (performance.now() - t0) : 0
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      if (!live) return
      const v: Vertex | null = m.kind === 'play' ? [m.index % n, Math.floor(m.index / n)] : null
      if (game.play(v) !== 'ok') game.play(null) // shortcut: an illegal sample (superko corner case) becomes a pass
      if (v && game.lastMove?.vertex) view.current?.drop(v, bot.sign)
      else view.current?.pass?.(bot.sign)
      setDirty(true); changed()
    }).catch(e => live && setBotError(d => d.botFailed(failureText(e, d)))).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [botTurn, ver, game, botRetry]) // eslint-disable-line react-hooks/exhaustive-deps

  // Two passes: counting. KataGo's ownership suggests the dead stones (without an engine, none are suggested);
  // the player corrects them, then validates a Japanese count (territory + prisoners + komi).
  useEffect(() => {
    if (!game.ended || !atEnd || result || counting || online) return // OGS counts its own games
    let live = true
    const enter = (own: number[] | null) => {
      if (live) setCounting({ game, own, dead: own ? suggestDead(game.board.signMap, own) : noDead(game.board.signMap) })
    }
    if (!canAnalyze) enter(null)
    else analyze(game, { maxVisits: FINAL_VISITS, includeOwnership: true }).then(a => enter(a.ownership), () => enter(null))
    return () => { live = false }
  }, [game.ended, atEnd, ver, game, canAnalyze, counting, result, online])

  // "Ombre et lumière": ownership of the displayed position, debounced, kept until the next estimate arrives.
  useEffect(() => {
    if (!settings.territory || !canAnalyze || review || ongoing) return
    let live = true
    const t = setTimeout(() => {
      analyze(game, { maxVisits: TERRITORY_VISITS, includeOwnership: true })
        .then(a => live && setOwn({ game, data: a.ownership, score: a.scoreLead }), e => live && setNote(d => failureText(e, d)))
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [settings.territory, ver, game, canAnalyze, !!review, ongoing]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reading: resumes from the scan cache after an error ("Try again") or a colour change.
  useEffect(() => {
    if (!reading || !review || !scan.current) return
    let live = true
    const leads = scan.current.leads
    const run = scanRun.current.catch(() => {}).then(() => readGame(game, review.side, leads,
      (at, q) => analyze(game.branch(at), q as Record<string, unknown>), () => live, pct => live && setReview(x => x && { ...x, pct })))
    scanRun.current = run
    run.then(ms => { if (live) openMoment(0, 'try', ms) }, e => live && setReview(x => x && { ...x, error: e }))
    return () => { live = false }
  }, [reading, review?.side, game, reviewTry]) // eslint-disable-line react-hooks/exhaustive-deps

  // In a lesson, the engine answers each move played on the branch; a try from the lesson's start is graded.
  const lesson = review?.branch
  const answering = !!lesson && !!review?.ask && !review.error && lesson.cursor === lesson.moves.length && !lesson.ended
  useEffect(() => {
    if (!answering || !lesson || !m) return
    let live = true
    const graded = review!.step === 'try' && lesson.cursor === from + 1, tried = lesson.lastMove!.vertex
    setThinking(true)
    const run = scanRun.current.catch(() => {}).then(() => { if (!live) throw null; return analyze(lesson, REPLY) }) // cancelled while queued: send nothing
    scanRun.current = run
    run.then(a => {
      if (!live) return
      const v = a.pv[0], sign = lesson.toPlay
      if (v === undefined) throw new LocalizedError(d => d.badAnswer)
      if (lesson.play(v) !== 'ok') lesson.play(null)
      if (v && lesson.lastMove?.vertex) view.current?.drop(v, sign)
      else view.current?.pass?.(sign)
      setReview(x => x && { ...x, ask: false, error: null, gap: graded ? gradeTry(m, tried, a.scoreLead) : x.gap })
      changed()
    }).catch(e => live && setReview(x => x && { ...x, error: e })).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [answering, ver, lesson, reviewTry]) // eslint-disable-line react-hooks/exhaustive-deps
  // a caption link remounts the caption (keyed by its text): right after one is activated, focus the link with the same
  // action if it came back, else the caption itself, so a second Enter never changes step, moment or leaves the review
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const id = refocus.current
    if (id === null) return
    refocus.current = null
    if (document.activeElement !== document.body) return
    ;(document.querySelector<HTMLElement>(`.note .link[data-act="${id}"]`) ?? document.querySelector<HTMLElement>('.board-wrap > .note'))?.focus()
  })

  // ⌘/Ctrl commands, shared by the keyboard and the macOS menu bar (whose items emit "menu" with these ids)
  const togglePanel = () => set('panelHidden', !settings.panelHidden)
  // ⌘N with OGS as the opponent: the Game sheet, where an OGS game starts
  const newCommand = () => { if (settings.opponent !== 'ogs') return void newGame(); opener.current = document.activeElement as HTMLElement | null; setSheet('game') }
  const commands: Record<string, () => void> = { undo, new: newCommand, open, save, panel: togglePanel }
  // a focused range keeps the shortcuts: its arrows/Home/End go through goTo (preventDefault: no second native step)
  const blocked = (target: EventTarget | null) => target instanceof HTMLInputElement && target.type !== 'range' || sheet !== null
  const onMenu = useRef((_: string) => {})
  onMenu.current = id => { if (!blocked(document.activeElement) && Object.hasOwn(commands, id)) commands[id]() }
  useEffect(() => {
    if (!inTauri()) return
    const off = on<string>('menu', id => onMenu.current(id))
    return () => { off.then(f => f()) }
  }, [])
  // The macOS menu bar speaks the UI language (its labels live in the dictionaries)
  useEffect(() => { if (isMac && inTauri()) call('set_language', { labels: { ...t.menu, panel: settings.panelHidden ? t.menu.showPanel : t.menu.hidePanel } }).catch(console.error) }, [settings.lang, settings.panelHidden])

  useEffect(() => {
    // In the macOS app the menu's key equivalents own ⌘Z/N/O/S/\: WebKit hands the menu every ⌘-key the page does not
    // preventDefault, so handling them here as well would run them twice.
    const menuKeys = isMac && inTauri()
    const onKey = (e: KeyboardEvent) => {
      if (blocked(e.target)) return
      const cmd = isMac ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase()
      const act = cmd
        ? menuKeys ? undefined : commands[({ z: 'undo', n: 'new', o: 'open', s: 'save', '\\': 'panel' } as Record<string, string>)[k]]
        : e.altKey || e.metaKey || e.ctrlKey ? undefined
        : ({
            arrowleft: () => goTo(shown.cursor - 1), arrowright: () => goTo(shown.cursor + 1),
            home: () => goTo(0), end: () => goTo(shown.moves.length),
            ...(review && { escape: leaveReview }),
            p: () => play(null), c: () => setCoords(v => !v), m: () => setSound(v => !v),
            t: ongoing ? undefined : () => set('territory', !settings.territory), h: togglePanel,
            ...(renderer === '3d' && {
              v: () => set('camera', settings.camera === 'study' ? 'contemplation' : 'study'),
            }),
            ...(renderer === '3d' && settings.decor !== 'lanterne' && { // lighting has no effect at night
              l: () => set('light', LIGHTS[(LIGHTS.indexOf(settings.light) + 1) % LIGHTS.length]),
            }),
          } as Record<string, () => void>)[k]
      if (!act || e.repeat && cmd) return
      e.preventDefault()
      act()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const { size, komi, playerBlack, playerWhite } = game.info
  const board = shown.board, total = shown.moves.length, toPlay = shown.toPlay, last = shown.lastMove
  const shownOwn = settings.territory && own?.game === game && !ongoing ? own : null
  const engineWait = engine.state === 'tuning' ? t.tuningCaption
    : (thinking || reading) && engine.state === 'starting' ? t.engineStarting
    : (thinking || reading) && engine.state === 'warming' ? t.engineWarming : null
  // the review's caption and its links (p: the colour that punishes, s: the one that made the mistake)
  const p = m ? -m.sign : 0, s = m?.sign ?? 0
  const graded = m && review?.step === 'try' && review.gap !== null ? verdict(m, review.gap) : null
  const lessonLine = !review ? null
    : reading ? t.reading
    : !m ? t.noMoments(review.side)
    : review.step === 'try' ? graded === 'found' ? t.found : graded === 'short' ? t.shortOf(review.gap!) : graded ? t.missed(s, review.gap!) : t.tryAsk(p, m.at + 1)
    : review.step === 'punish' ? t.punishLine(p, gtp(m.punish[0]!, size), s, m.loss)
    : t.betterLine(s, gtp(m.better[0]!, size), m.loss)
  const lastMoment = !!review?.moments && review.k === review.moments.length - 1
  // [action id, label, action]: the id tells refocus whether the same action is still offered
  const links: [string, string, () => void][] = review?.error ? [['retry', t.retry, retryLesson]]
    : botError && !result ? [['retry', t.retry, retryBot]]
    : !review ? search ? [['cancel', t.cancel, cancelSearch]] : result && canReview ? [['review', t.reviewGame, () => startReview(mine)]] : []
    : !m ? [['back', t.backToGame, leaveReview]]
    : review.step === 'try' ? [...(graded ? [['again', t.retry, () => openMoment(review.k, 'try')] as [string, string, () => void]] : []), ['punish', t.seePunishment, () => openMoment(review.k, 'punish')]]
    : review.step === 'punish' ? [['better', t.seeBetter, () => openMoment(review.k, 'better')]]
    : lastMoment ? [['back', t.backToGame, leaveReview]] : [['next', t.nextMoment, () => openMoment(review.k + 1, 'try')]]
  const message = review ? (review.error ? (review.branch ? t.answerFailed : t.reviewFailed)(failureText(review.error)) : note?.(t)) ?? engineWait ?? lessonLine
    : search ? note?.(t) ?? t.ogsSearching(search.size, t.paces[search.speed])
    : ongoing && ogsStatus !== 'online' ? t.ogsReconnecting
    : result ? [result(t), note?.(t)].filter(Boolean).join(' ')
    : countingNow || removal ? t.countingHelp
    : game.ended ? t.countingWait
    : (botError ?? note)?.(t) ?? engineWait
      ?? (last && !last.vertex ? (atEnd && bot?.sign === last.sign ? t.botPasses : t.passes)(last.sign) : null)
  // tuning progress: outside the key (no re-fade per update) and aria-hidden (announced once)
  const tuned = message === t.tuningCaption && engine.state === 'tuning' ? t.tuningProgress(engine.step, engine.done, engine.total)
    : review && message === t.reading ? t.percent(review.pct) : ''
  const humanNet = nets?.installed.find(i => i.name === nets.human)
  const engineLine = !inTauri() ? t.engineInAppOnly
    : engine.state === 'error' ? failureText(engine.error)
    : engine.state === 'starting' ? t.engineStarting
    : engine.state === 'tuning' ? t.engineTuning(engine.step, engine.done, engine.total)
    : engine.state === 'warming' ? t.engineWarming
    : !canAnalyze ? t.noAnalysisNet
    : `${engine.state === 'ready' ? t.engineReady : t.engineIdle} · ${pick(t.labels, nets?.activeKey ?? '') ?? nets?.active}`
  const app = version ? `Masame ${version}` : 'Masame'
  const releases = () => { call('open_link', { which: 'releases' }).catch(() => {}) }
  const retry = upd.s === 'error' ? upd.retry : undefined // a failed install: Rust kept the update
  const [updLine, updActions]: [string, [string, () => void][]] = upd.s === 'checking' ? [`${app} · ${t.checking}`, []]
    : upd.s === 'latest' ? [t.upToDate(app), []]
    : upd.s === 'available' ? [t.updateAvailable(upd.version), [[upd.install ? t.install : t.download, () => installUpdate(upd)]]]
    : upd.s === 'downloading' ? [t.updateDownloading(upd.pct), []]
    : upd.s === 'installing' ? [t.updateInstalling, []]
    : upd.s === 'error' ? [failureText(upd.error), retry ? [[t.install, () => installUpdate(retry)], [t.download, releases]] : [[t.download, releases]]]
    : [app, [[t.checkUpdates, () => checkUpdate(false)]]]

  const playing = review ? !!review.branch : !game.ended && !result && (!online || online.phase === 'play') // whose turn it is means something
  const floor = review?.branch ? from : 0
  const re = result ? game.info.result ?? '' : '' // "B+R", "W+4.5", "0"
  const resignation = re.endsWith('+R'), countingOpen = !!final && !result
  // the count, shown while counting and, once validated, at every cursor position (scored on the final board)
  const end = game.boards.at(-1)!
  const count = counting?.game === game && (countingOpen || (!!re && !resignation))
    ? score(end.signMap, counting.dead, { black: end.getCaptures(1), white: end.getCaptures(-1) }, komi, counting.own) : null
  const sideOf = (s: Sign) => count ? s === 1 ? count.black : count.white : null
  const tallyOf = (s: Sign) => { const c = sideOf(s)!; return t.tally(c.territory, c.prisoners, s === -1 ? komi : undefined) }
  // counting: points over the tally; counted: "wins" over points and tally; a draw: the points alone
  const subOf = (s: Sign) => !count || re === '0' ? null : countingOpen ? tallyOf(s) : `${t.points(sideOf(s)!.total)} · ${tallyOf(s)}`
  const stateOf = (s: Sign) => count && (countingOpen || re === '0') ? t.points(sideOf(s)!.total)
    : re ? re[0] === (s === 1 ? 'B' : 'W') ? t.wins : resignation ? t.resigned : ''
    : last && !last.vertex && last.sign === s ? t.passed
    : !playing ? ''
    : toPlay === s ? bot?.sign === s ? thinking ? t.thinking : t.waiting : online && online.me !== s ? t.thinking : t.yourMove
    : t.waiting
  const alert = upd.s === 'available' ? t.updateAvailable(upd.version) : engine.state === 'error' ? failureText(engine.error) : null
  const closeSheet = () => setSheet(null)
  // Networks opened from Settings closes back to Settings, on its link
  const closeNets = () => setSheet(netsFromSettings.current ? 'settings' : null)
  useEffect(() => { if (sheet === 'view') document.getElementById('display')?.scrollIntoView({ block: 'start' }) }, [sheet])
  const cta = settings.opponent === 'ai' && !canPlayAI && (
    <div className="cta">
      <p>{!inTauri() ? t.aiOnlyInApp : t.aiNeeds(humanNet?.complete ? null : t.mb(HUMAN_BYTES), !canAnalyze)}</p>
      {inTauri() && <button className="btn" onClick={openSheet('nets')}>{t.openNetworks}</button>}
    </div>
  )

  return (
    <>
      {isMac && <div className="titlebar" data-tauri-drag-region />}
      <main className="stage" inert={sheet !== null}>
        <Goban
          view={view}
          mode={renderer}
          options={{ camera: settings.camera, time: settings.light, highContrast: settings.highContrast, decor: settings.decor }}
          thinking={thinking}
          // while the engine starts (OpenCL tuning loads the GPU) a slow verdict is not the hardware's: this session only
          onFallback={r => { if (r === 'context-lost' || (r === 'slow' && (engineBusy || reading))) setSession2d(true); else set('renderer', '2d'); setNote(d => d.fellBack) }}
          state={{
            signMap: board.signMap, last: last?.vertex ?? null, toPlay, coords, sound,
            interactive: removal ? true : countingNow ? !result : review ? lessonPlayable : !game.ended && !locked && humanTurn,
            // ② and ③: what changed hands, until the player explores
            ownership: countingNow ? null : review ? (m && !review.explored ? review.step === 'punish' ? m.lost : review.step === 'better' ? m.kept : null : null)
              : shownOwn?.data ?? null,
            counting: final ? { dead: countingNow!.dead, territory: final.territory }
              : removal ? { dead: ogs.deadOf(board.signMap, removal.removed), territory: board.signMap.map(r => r.map(() => 0 as Sign)) } : null, // OGS scores
            captures: { black: board.getCaptures(1), white: board.getCaptures(-1) }, // the 3D lids: prisoners taken by each
          }}
          onPlay={play}
        >
          <p className="note" aria-live="polite" tabIndex={-1}>
            {message && <span key={message} title={tuned ? `${message} · ${tuned}` : message}>
              <span className="txt">{message}{tuned && <span aria-hidden="true"> · {tuned}</span>}</span>
              {links.map(([id, label, act]) => <button key={id} data-act={id} className="link" onClick={() => { refocus.current = id; act() }}>{label}</button>)}
            </span>}
          </p>
        </Goban>
        <aside className={`card${settings.panelHidden ? ' off' : ''}`}>
          <header className="brand">
            {!settings.panelHidden && <>
              <span className="seal" aria-hidden="true">柾</span>
              <h1>Masame</h1>
              <button className="icon" onClick={openSheet('game')} aria-label={t.game} title={t.game}><Icon name="plus" /></button>
              <button className="icon" onClick={openSheet('settings')} aria-label={alert ? `${t.settings} · ${alert}` : t.settings}
                title={alert ? `${t.settings} · ${alert}` : t.settings}><Icon name="adjustments" />{alert && <i className="dot" />}</button>
            </>}
            {/* hidden card: only whose turn it is (breathing while the bot thinks), next to the toggle */}
            {settings.panelHidden && playing && (
              <i className={`turn ${toPlay === 1 ? 'b' : 'w'}${thinking ? ' thinking' : ''}`} role="img" aria-label={t.color(toPlay)} />
            )}
            <button className="icon panel-toggle" onClick={togglePanel} aria-expanded={!settings.panelHidden} aria-controls="card"
              aria-label={settings.panelHidden ? t.showPanel : t.hidePanel} title={`${settings.panelHidden ? t.showPanel : t.hidePanel} (H)`}>
              <Icon name={settings.panelHidden ? 'eye' : 'eye-off'} />
            </button>
          </header>
          <div className="card-in" id="card" hidden={settings.panelHidden}>
            <div className="meta">
              <span>{online ? t.ogsBoard(size, komi, pick(t.rules, online.rules) ?? online.rules) : t.board(size, komi)}</span>
              <button className="icon sm" aria-pressed={sound} onClick={() => setSound(v => !v)} aria-label={t.sound} title={`${t.sound} (M)`}>
                <Icon name={sound ? 'volume' : 'volume-off'} />
              </button>
              <button className="icon sm" onClick={openSheet('view')} aria-label={t.display} title={t.display}><Icon name="view" /></button>
              <button className="icon sm" aria-pressed={renderer === '3d'} onClick={() => { setSession2d(false); set('renderer', renderer === '3d' ? '2d' : '3d') }}
                aria-label={t.render3d} title={renderer === '3d' ? t.render3d : t.render2d}><Icon name={renderer === '3d' ? 'cube' : 'square'} /></button>
            </div>
            <div className="body">
              {review ? (
                <section className="rv">
                  <div className="lab"><span>{t.review}</span><span>{reading ? t.percent(review.pct) : ''}</span></div>
                  {!bot && (
                    <div className="field">
                      <span>{t.reviewSide}</span>
                      <Seg label={t.reviewSide} value={review.side} options={[[1, t.black], [-1, t.white], [0, t.both]]} set={v => v !== review.side && startReview(v)} />
                    </div>
                  )}
                  {reading ? <>
                    <p className="estimate">{review.error ? t.reviewFailed(failureText(review.error)) : t.readingHelp}</p>
                    <div className="bar" role="progressbar" aria-label={t.reading} aria-valuenow={review.pct} aria-valuemin={0} aria-valuemax={100}>
                      <i style={{ width: `${review.pct}%` }} />
                    </div>
                  </> : !m ? <p className="estimate">{t.noMoments(review.side)}</p> : <>
                    <p className="state">{t.moment(review.k + 1, review.moments!.length, m.at + 1, m.loss)}</p>
                    {review.moments!.length > 1 && (
                      <Seg label={t.moments} value={review.k} options={review.moments!.map((_, i) => [i, String(i + 1)])} set={k => openMoment(k, 'try')} />
                    )}
                    <Seg label={t.lesson} value={review.step} options={[['try', t.steps.try], ['punish', t.steps.punish], ['better', t.steps.better]]}
                      set={step => openMoment(review.k, step)} />
                    <p className="quiet">{review.step === 'try' ? t.tryHelp(p, s, m.loss) : review.step === 'punish' ? t.punishHelp : t.betterHelp}</p>
                  </>}
                </section>
              ) : ([1, -1] as const).map(c => {
                const n = board.getCaptures(c), sub = subOf(c)
                const rank = online ? online.players[c === 1 ? 'black' : 'white'].rank : bot && (c === bot.sign ? bot.rank : settings.myRank)
                return (
                  <div key={c} role="group" aria-label={t.color(c)}
                    className={`pc ${c === 1 ? 'b' : 'w'}${toPlay === c && playing ? ' on' : ''}${thinking && bot?.sign === c ? ' thinking' : ''}`}>
                    <div className="lbl"><span className="nm">{bot ? c === bot.sign ? t.ai : t.you : (c === 1 ? playerBlack : playerWhite) || t.color(c)}</span>{rank && <span className="rk">{rank}</span>}</div>
                    <div aria-live={countingOpen ? 'polite' : undefined}>
                      <div className="state" aria-live={online ? 'polite' : undefined}>{stateOf(c)}</div>
                      {online?.clock && !result ? <div className="sub"><Clock clock={online.clock} tc={online.tc} color={c} pausedSince={online.pausedSince} /></div> : sub && <div className="sub">{sub}</div>}
                    </div>
                    <span className="cap" role="img" aria-label={t.captures(n)}>{n}</span>
                    <span className="wm" aria-hidden="true">{c === 1 ? '黒' : '白'}</span>
                  </div>
                )
              })}
              {!review && cta}
              <div className="tl">
                <button className="chev" onClick={() => goTo(shown.cursor - 1)} disabled={shown.cursor <= floor} aria-label={t.prev} title={`${t.prev} (←)`}><Icon name="chevron-left" /></button>
                <input type="range" min={floor} max={total} value={shown.cursor} onChange={e => goTo(+e.target.value)} aria-label={t.history}
                  aria-valuetext={t.move(shown.cursor)} style={{ '--n': total - floor } as React.CSSProperties} />
                <button className="chev" onClick={() => goTo(shown.cursor + 1)} disabled={shown.cursor === total} aria-label={t.next} title={`${t.next} (→)`}><Icon name="chevron-right" /></button>
                <span className="mv">{t.moveOf(shown.cursor, total)}</span>
              </div>
              {settings.territory && !review && !ongoing && (
                <p className="estimate" aria-live="polite">
                  {!inTauri() || !canAnalyze ? t.territoryNeedsNet : shownOwn ? t.estimate(shownOwn.score) : t.estimating}
                </p>
              )}
            </div>
            <div className="acts">
              {review ? <button className="act" onClick={leaveReview} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button> : <>
                {(final || removal) && !result
                  ? <button className="act accent" onClick={removal ? () => send(() => ogs.acceptRemoved(removal.id, removal.removed)) : validate}><Icon name="hand-stop" />{t.validate}</button>
                  : <button className="act" onClick={() => play(null)} disabled={game.ended || locked || !humanTurn} title="P"><Icon name="hand-stop" />{t.pass}</button>}
                <button className="act" onClick={undo} disabled={game.cursor === 0 || (!!bot && !!result) || !!online} title={ongoing ? t.ogsUnavailable : shortcut('Z')}><Icon name="arrow-back-up" />{t.undo}</button>
                <button className="act" aria-pressed={settings.territory} onClick={() => set('territory', !settings.territory)} disabled={ongoing}
                  title={ongoing ? t.ogsUnavailable : 'T'}><Icon name="sun-low" />{t.territory}</button>
                {reviewShown ? <button key="review" className={`act${result ? ' accent' : ''}`} onClick={() => startReview(mine)}
                  disabled={!canAnalyze} title={canAnalyze ? undefined : t.reviewNeedsNet}><Icon name="review" />{t.reviewGame}</button>
                  : (bot || online) && <button className="act" onClick={resign} disabled={!!result}><Icon name="flag" />{t.resign}</button>}
              </>}
            </div>
          </div>
        </aside>
      </main>

      {sheet === 'game' && (
        <Sheet title={t.game} onClose={closeSheet} opener={opener.current}>
          <section>
            <div className="lab"><span>{t.newGame}</span><span /></div>
            <div className="opts">
              <Seg label={t.size} value={nextSize} options={SIZES.map(n => [n, `${n}×${n}`])} set={setNextSize} />
              <Seg label={t.opponent} value={settings.opponent} options={[['human', t.twoPlayers], ['ai', t.ai], ['ogs', 'OGS']]} set={v => set('opponent', v)} />
              {settings.opponent === 'ogs' ? (
                <OgsSection speed={settings.ogsSpeed} setSpeed={v => set('ogsSpeed', v)} onFind={() => { closeSheet(); find() }}
                  onResume={id => { closeSheet(); resume(id) }} onImport={id => { closeSheet(); importGame(id) }} onSignOut={signOut} />
              ) : <>
              {settings.opponent === 'ai' && (canPlayAI ? <>
                <Seg label={t.yourColor} value={settings.color} options={[['b', t.black], ['w', t.white], ['r', t.random]]} set={v => set('color', v)} />
                <Stepper label={t.aiLevel} value={settings.aiRank} set={v => set('aiRank', v)} />
                <details className="more">
                  <summary>{t.aiSettings}</summary>
                  <Stepper label={t.myLevel} value={settings.myRank} set={v => setSettings(s => ({ ...s, myRank: v, aiRank: v }))} />
                  <Switch label={t.autoAdjust} on={settings.autoAdjust} toggle={() => set('autoAdjust', !settings.autoAdjust)} />
                  <Switch label={t.thinkTime} on={settings.delay} toggle={() => set('delay', !settings.delay)} />
                </details>
              </> : cta)}
              <button className="btn accent" onClick={() => { closeSheet(); newGame() }} title={shortcut('N')} disabled={settings.opponent === 'ai' && !canPlayAI}>{t.begin}</button>
              </>}
            </div>
          </section>
          <section className="opts">
            <button className="btn" onClick={() => { closeSheet(); open() }} title={shortcut('O')}>{t.open}</button>
            <button className="btn" onClick={() => { closeSheet(); save() }} title={shortcut('S')}>{t.save}</button>
          </section>
        </Sheet>
      )}

      {(sheet === 'settings' || sheet === 'view') && (
        <Sheet title={t.settings} onClose={closeSheet} opener={opener.current} focus={netsFromSettings.current ? '[data-nets]' : undefined}>
          <section>
            <div className="lab"><span>{t.boardSection}</span><span /></div>
            <Switch label={t.coords} k="C" on={coords} toggle={() => setCoords(v => !v)} />
            <Switch label={t.sound} k="M" on={sound} toggle={() => setSound(v => !v)} />
            <Switch label={t.territory} k="T" on={settings.territory} toggle={() => set('territory', !settings.territory)}
              disabled={ongoing} title={ongoing ? t.ogsUnavailable : undefined} />
          </section>

          <section id="display">
            <div className="lab"><span>{t.display}</span><span /></div>
            <div className="opts">
              <Seg label={t.rendering} value={renderer} options={[['3d', t.render3d], ['2d', t.render2d]]} set={v => { setSession2d(false); set('renderer', v) }} />
              {renderer === '3d' && <>
                <div className="row" style={{ cursor: 'default', gap: 16 }}>
                  <span>{t.view} <kbd>V</kbd></span>
                  <Seg label={t.view} value={settings.camera} options={[['study', t.study], ['contemplation', t.contemplation]]} set={v => set('camera', v)} />
                </div>
                <div className="field">
                  <span>{t.decor}</span>
                  <Seg label={t.decor} value={settings.decor} options={DECORS.map(d => [d, t.decors[d], t.decorHints[d]])} set={v => set('decor', v)} />
                </div>
                <div className="field">
                  <span>{t.light} <kbd>L</kbd></span>
                  <Seg label={t.light} value={settings.light} options={LIGHTS.map(l => [l, t.lights[l]])} set={v => set('light', v)}
                    disabled={settings.decor === 'lanterne'} title={settings.decor === 'lanterne' ? t.noEffectAtNight : undefined} />
                </div>
                <Switch label={t.highContrast} on={settings.highContrast} toggle={() => set('highContrast', !settings.highContrast)} />
              </>}
            </div>
          </section>

          <section>
            <div className="lab"><span>{t.appSection}</span><span /></div>
            <div className="row" style={{ cursor: 'default', gap: 16 }}>
              <span>{t.language}</span>
              <Seg label={t.language} value={settings.lang} options={[['fr', 'Français'], ['en', 'English']]} set={v => { setLang(v); setSettings(s => ({ ...s, lang: v, langChosen: true })) }} />
            </div>
            <div className="row" style={{ cursor: 'default' }}>
              <span>{t.engine}</span>
              <button className="link" data-nets onClick={() => { netsFromSettings.current = true; setSheet('nets') }}>{t.networksBtn}</button>
            </div>
            <p className={`engine${engine.state === 'error' ? ' err' : ''}`}>{engineLine}</p>
            {inTauri() && <>
              <div className="row" style={{ cursor: 'default' }}><span>{t.updates}</span></div>
              <p className={`engine${upd.s === 'error' ? ' err' : ''}`} aria-live="polite">
                {updLine}{updActions.map(([label, act]) => <span key={label}> · <button className="link" onClick={act}>{label}</button></span>)}
              </p>
              {upd.s === 'downloading' && (
                <div className="bar" role="progressbar" aria-label={t.updateDownloading(null)} aria-valuenow={upd.pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${upd.pct ?? 0}%` }} />
                </div>
              )}
              <Switch label={t.autoUpdate} on={settings.autoUpdate} toggle={() => set('autoUpdate', !settings.autoUpdate)} />
            </>}
          </section>

          <section>
            <div className="lab"><span>{t.keyboard}</span><span /></div>
            <p className="keys"><kbd>←</kbd><kbd>→</kbd> {t.footer.browse} · <kbd>P</kbd> {t.footer.pass} · <kbd>T</kbd> {t.footer.territory} · <kbd>{shortcut('Z')}</kbd> {t.footer.undo} · <kbd>{shortcut('N')}</kbd> {t.footer.newGame} · <kbd>H</kbd> {t.footer.panel}</p>
          </section>
        </Sheet>
      )}

      {sheet === 'nets' && <Networks nets={nets} progress={progress} onClose={closeNets} onChanged={refreshNets} opener={opener.current} />}
    </>
  )
}
