import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { BoardView } from './board/BoardView'
import { centreShift } from './board/frame'
import type { Board3D, Board3DOptions, Board3DState, FallbackReason, TimeMode } from './board3d/Board3D'
import { rng } from './board/noise'
import { adjustRank, botProfile, clampEra, clampRank, decide, DEFAULT_RANK, lessonFlags, MASTER_RANK, RANKS, stepEra, stepRank } from './bot'
import { askFirst, confirmDiscard, openSgfFile, savePngFile, saveSgfFile } from './files'
import { Game, type GameNode, type Move, type Sign, type Vertex } from './game'
import { analyze, call, candidates, gtp, inTauri, on, type Analysis, type EngineStatus, type NetState, type Progress } from './katago'
import { Networks } from './Networks'
import { notify } from './notify'
import { OgsSection } from './OgsSection'
import { Clock } from './Clock'
import { handicapStones, proposeHandicap, stepHandicap } from './handicap'
import { CLOCKS, flagAt, read, sgfTime, startClock, sync, timeUp, type ClockSetting, type LocalClock } from './localClock'
import { Seg } from './Seg'
import { Switch } from './Switch'
import * as ogs from './ogs'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { Timeline } from './Timeline'
import { cardSkin } from './board3d/logic'
import { noDead, score, suggestDead, toggleDead, type Dead } from './scoring'
import { loadSgf, MAX_SGF, readResult, resignResult, saveSgf, scoreResult, timeResult } from './sgf'
import { failureText, LocalizedError, pick, setLang, storedLang, t, type Lang, type Msg } from './i18n'
import { DECORS, type Decor } from './board3d/decors'
import { isMac, shortcut } from './platform'
import { useFullscreen, useWindowTheme } from './window'
import { getVersion } from '@tauri-apps/api/app'
import { checkDue, updateSettings, type UpdateInfo } from './update'
import { fromOf, gradeTry, lessonBoard, readGame, REPLY, verdict, type Moment, type Step } from './review'
import { useJoseki } from './joseki/useJoseki'
import { phaseLine, useExercises } from './exercises/useExercises'
import { anchored, loadRanks, localRank, rankName, readRank, saveRanks, withReading, type Reading } from './rank'
import { useAutoReview } from './exercises/useAutoReview'
import { useMining } from './tsumego/useMining'
import { recordKey, weakest } from './exercises/deck'
import { tone } from './joseki/practice'
import { openingBook } from './today/ritual'
import { useToday } from './today/useToday'
import { MonthLetters } from './MonthLetters'
import { canGuess, useClassics } from './classics/useClassics'
import { LearnSheet, OgsRating, RankProgress, storeTab, WhereLost, type DeckRow, type ProgressSection } from './LearnSheet'
import { GamesSheet } from './GamesSheet'
import { ShareSheet } from './ShareSheet'
import { menuEnabled } from './menu'
import * as library from './library'
import { isLocal, local, noteRank, noteReview, resumable, unfinished, useCurrentGame, type Bot } from './current'
import { useMentor } from './useMentor'
import { useCounting } from './count/useCounting'
import { useMemory } from './memory/useMemory'
import { COUNTS, countStep, handStep, HAND } from './today/ritual'
import { useEditor } from './editor/useEditor'
import { Kifu } from './KifuPage'

// free analysis: a near-instant read, then one that sharpens it
const QUICK = { maxVisits: 80, overrideSettings: { maxTime: 0.3 } }, DEEP = { maxVisits: 800, overrideSettings: { maxTime: 2.5 } }

const SIZES = [9, 13, 19]
const HUMAN_BYTES = 99_066_230
const BOT_VISITS = 60, TERRITORY_VISITS = 150, FINAL_VISITS = 300
const BOT_ATTEMPTS = 3 // a failed query (engine restarting on another net, crash) is retried after 1 s, then 2 s
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const random = rng(Date.now())

type Renderer = '3d' | '2d'
const LIGHTS: TimeMode[] = ['auto', 'morning', 'afternoon', 'evening']
const AUTOPLAY = [0.5, 1, 2, 4] as const // seconds per move
interface Settings {
  lang: Lang; opponent: 'human' | 'ai' | 'ogs'; ogsSpeed: ogs.Speed; color: 'b' | 'w' | 'r'; myRank: string; aiRank: string; autoAdjust: boolean; botResign: boolean; delay: boolean; territory: boolean
  renderer: Renderer; camera: Board3DOptions['camera']; light: TimeMode; highContrast: boolean; decor: Decor
  langChosen: boolean; panelHidden: boolean; autoUpdate: boolean; updateChecked: number; autoplay: typeof AUTOPLAY[number]
  handicap: number; clock: ClockSetting
  style: 'level' | 'era'; era: number; mentor: boolean // a Master of an era instead of the AI level; the mentor (v0.5 B)
}
const SETTINGS_KEY = 'baduk.settings'
function loadSettings(): Settings {
  const d: Settings = {
    lang: 'en', opponent: 'ai', ogsSpeed: 'rapid', color: 'b', myRank: DEFAULT_RANK, aiRank: DEFAULT_RANK, autoAdjust: true, botResign: true, delay: true, territory: false,
    renderer: '3d', camera: 'study', light: 'auto', highContrast: false, decor: 'atelier', langChosen: false, panelHidden: false,
    autoUpdate: true, updateChecked: 0, autoplay: 1, handicap: 0, clock: 'off', style: 'level', era: 1850, mentor: false,
  }
  let j: Partial<Settings> = {}
  try { j = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {} } catch { /* private mode or garbage: defaults */ }
  const s = { ...d, ...j }
  return {
    ...s, lang: storedLang(j), langChosen: j.langChosen === true,
    opponent: (['human', 'ai', 'ogs'] as const).includes(s.opponent) ? s.opponent : 'ai',
    ogsSpeed: (['blitz', 'rapid', 'live', 'correspondence'] as const).includes(s.ogsSpeed) ? s.ogsSpeed : 'rapid', myRank: clampRank(s.myRank), aiRank: clampRank(s.aiRank),
    renderer: j.renderer === '2d' || j.renderer === '3d' ? j.renderer : webgl2() ? '3d' : '2d',
    camera: s.camera === 'contemplation' ? 'contemplation' : 'study', light: LIGHTS.includes(s.light) ? s.light : 'auto', highContrast: s.highContrast === true,
    decor: DECORS.includes(s.decor) ? s.decor : 'atelier', panelHidden: s.panelHidden === true, ...updateSettings(j),
    autoplay: AUTOPLAY.includes(s.autoplay) ? s.autoplay : 1, botResign: s.botResign !== false,
    handicap: Number.isInteger(s.handicap) && s.handicap >= 2 && s.handicap <= 9 ? s.handicap : 0,
    clock: typeof s.clock === 'string' && Object.hasOwn(CLOCKS, s.clock) ? s.clock : 'off',
    style: s.style === 'era' ? 'era' : 'level', era: clampEra(s.era), mentor: s.mentor === true,
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
type View = { update(s: Board3DState): void; drop(v: Vertex, c: Sign): void; pass?(c: Sign): void; shake?(v: Vertex, c: Sign): void; resetCamera?(): void; snapshot?(): Promise<Blob | null>; destroy(): void }

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
    // --shift: how far right of .board-wrap's centre the board is drawn (centred on the window beside the card); the caption follows
    const shift = (px: number) => wrap.current?.style.setProperty('--shift', `${px}px`)
    if (mode === '2d') {
      const b = new BoardView(canvas.current!, play)
      mount(b, () => {
        const r = wrap.current!.getBoundingClientRect(), S = Math.min(r.width, r.height), l = r.left + (r.width - S) / 2
        shift(centreShift(l, l + S, r.right, innerWidth / 2)) // before resize(), which snaps the canvas to the pixel grid
        b.resize(S)
      })
    } else {
      // three.js is a lazy chunk; until it boots the canvas stays empty and Board3D fades in on its first frame
      import('./board3d/Board3D').then(({ Board3D }) => {
        if (!live) return
        const b = three.current = new Board3D(canvas.current!, play, { options: latest.current.options, onFallback: r => latest.current.onFallback(r), onShift: shift })
        b.setThinking(latest.current.thinking)
        // full-bleed canvas (fixed, the whole window); the board stays framed in .board-wrap's rectangle
        mount(b, () => b.resize(innerWidth, innerHeight, wrap.current!.getBoundingClientRect()))
      }, () => live && latest.current.onFallback('webgl2'))
    }
    return () => { live = false; ro?.disconnect(); v?.destroy(); view.current = three.current = null; shift(0) }
  }, [mode, view])
  useEffect(() => { view.current?.update(state); if (import.meta.env.DEV) Object.assign(window, { __badukState: state }) })
  useEffect(() => three.current?.setOptions(options), [options.camera, options.time, options.highContrast, options.decor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => three.current?.setThinking(thinking), [thinking])
  // a fresh canvas per renderer: one canvas can't hold both a 2D and a WebGL context
  return <div className="board-wrap" ref={wrap}><canvas key={mode} ref={canvas} data-r={mode} aria-label={t.boardLabel(state.signMap.length)} />{children}</div>
}

/** The signed-in OGS player's colour in an imported game, by name (OGS writes usernames in PB/PW). */
const ogsSide = ({ info }: Game): Sign | 0 => !ogs.me ? 0 : info.playerBlack === ogs.me.username ? 1 : info.playerWhite === ogs.me.username ? -1 : 0

/** Keeps an OGS game of mine in the library (once), at its end or when imported. */
const keepOgs = (g: Game, me: Sign | 0, ogsId: number, extra: Partial<library.Entry> = {}) => { library.keep(g, 'ogs', me, { ogsId, ...extra }).catch(e => console.error('library', e)) }

/** State holding a Msg, rendered at display time (a bare function given to useState's setter would run as an updater). */
function useMsg() {
  const [m, set] = useState<Msg | null>(null)
  return [m, useCallback((v: Msg | null) => set(() => v), [])] as const
}

/** ‹ steps by +1 (a rank: stronger), › by −1. */
function Stepper({ label, value, step, names = [t.stronger(label), t.weaker(label)] }: { label: string; value: string; step: (d: number) => void; names?: string[] }) {
  return (
    <div className="row stepper">
      <span>{label}</span>
      <span className="step">
        <button onClick={() => step(1)} aria-label={names[0]}>‹</button>
        <output aria-live="polite">{value}</output>
        <button onClick={() => step(-1)} aria-label={names[1]}>›</button>
      </span>
    </div>
  )
}

/** The AI's name on the card and in the SGF: a Master of an era, else KataGo at its rank. */
const botName = (b: { rank: string; era?: number }) => (b.era ? t.masterOf(b.era) : t.botName(b.rank))

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

  // the current match against the bot (null = two players), the results by line (keyed by its leaf), the bot's winrates for resigning
  // ritual: the daily 9×9, which never moves the AI level; era: a Master of that year (no auto-adjust); mentor: a lesson (no rank, no auto-adjust)
  const [bot, setBot] = useState<Bot | null>(null)
  const outcomes = useRef(new WeakMap<GameNode, { msg: Msg; re: string }>())
  const outcome = outcomes.current.get(game.leaf), result = outcome?.msg ?? null
  const setResult = (g: Game, o: { msg: Msg; re: string } | null) => { if (o) outcomes.current.set(g.leaf, o); else outcomes.current.delete(g.leaf); rerender() }
  const [thinking, setThinking] = useState(false)
  const winrates = useRef(new WeakMap<Move, number>())
  const scored = useRef<Game | null>(null)
  const [botError, setBotError] = useMsg()
  const [diag, setDiag] = useMsg() // "Copy diagnostics": copied, or why not
  const [botRetry, retryBot] = useReducer((x: number) => x + 1, 0)
  // the followed OGS game (its leave() in a ref), an automatch search, the socket's state
  const [online, setOnline] = useState<ogs.Followed | null>(null)
  const leaveOnline = useRef<(() => void) | null>(null)
  const [search, setSearch] = useState<{ size: number; speed: ogs.Speed } | null>(null)
  const [joining, setJoining] = useState(false) // followed, its first gamedata not here yet
  const searching = useRef<(() => void) | null>(null) // cancels the pending automatch
  const ogsStatus = useSyncExternalStore(ogs.onStatus, ogs.getStatus)
  // a live challenge sent and not answered yet (its keepalive and wait stopped by stop), a game started meanwhile elsewhere
  const [challengeWait, setChallengeWait] = useState<{ id: number; gameId: number; who: string } | null>(null)
  const waiting = useRef<{ id: number; gameId: number; stop: () => void } | null>(null)
  const [started, setStarted] = useState<{ id: number; who: string } | null>(null)
  const challengeRows = useSyncExternalStore(ogs.challenges.subscribe, ogs.challenges.get)
  const activeRows = useSyncExternalStore(ogs.active.subscribe, ogs.active.get)
  useEffect(() => ogs.startBackground(), [])
  const [session2d, setSession2d] = useState(false) // 2D after a WebGL context loss, for this session only
  const renderer: Renderer = session2d ? '2d' : settings.renderer
  // the card's skin follows the scene's backdrop; set before paint, and crossfaded only once the first frame is shown
  const skin = cardSkin(renderer, settings.camera, settings.decor)
  useLayoutEffect(() => { document.documentElement.dataset.skin = skin }, [skin])
  useWindowTheme(skin)
  const [fullscreen, setFullscreen] = useFullscreen()
  useEffect(() => { requestAnimationFrame(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = '' })) }, [])
  // counting phase after two passes: which stones are dead (suggested by KataGo, toggled by the player)
  const [counting, setCounting] = useState<{ game: Game; dead: Dead; own: number[] | null } | null>(null)
  const [clock, setClock] = useState<LocalClock | null>(null) // a local game's byo-yomi clock, dropped with its game
  const [paused, setPaused] = useState<{ game: Game; len: number } | null>(null) // a restored game's clock waits for the next move

  const [engine, setEngine] = useState<EngineStatus>({ state: 'stopped' })
  const [nets, setNets] = useState<NetState | null>(null)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  // the four doors' sheets (play, learn, games, settings), Share, and 'atelier': Settings scrolled to its Atelier section
  const [sheet, setSheet] = useState<'game' | 'learn' | 'games' | 'settings' | 'atelier' | 'share' | 'nets' | 'kifu' | null>(null)
  // the control a sheet returns focus to (WebKit doesn't focus clicked buttons), kept when one sheet opens another
  const opener = useRef<HTMLElement | null>(null), netsFromSettings = useRef(false)
  const openSheet = (s: NonNullable<typeof sheet>) => (e: React.MouseEvent<HTMLElement>) => {
    if (!e.currentTarget.closest('.sheet')) { opener.current = e.currentTarget; netsFromSettings.current = false }
    setSheet(s)
  }
  const [own, setOwn] = useState<{ game: Game; data: number[] | null; score: number } | null>(null)
  // game review: null = off; moments null while reading; branch = the lesson's variation (null while reading or clean)
  const [review, setReview] = useState<{ side: Sign | 0; pct: number; error: unknown; moments: Moment[] | null; k: number; step: Step
    branch: Game | null; ask: GameNode | null; gap: number | null; explored: boolean; rank?: Reading | null } | null>(null) // rank: undefined while read
  const [reviewTry, retryReview] = useReducer((x: number) => x + 1, 0)
  const scan = useRef<{ last: Game['board']; leads: (number | undefined)[] } | null>(null) // scan leads of the record ending on `last`
  const scanRun = useRef<Promise<unknown>>(Promise.resolve()) // the last readGame or answer: the next one starts once it settles (2 queries at most)
  const reviewId = useRef<Promise<string | undefined>>(Promise.resolve(undefined)) // the reviewed game's library id

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
  // OGS forbids engine help in an ongoing game: no KataGo query of any kind until it is finished (nor while joining one: `joining`)
  const ongoing = !!online && online.phase !== 'finished'
  const myGame = ongoing && online.me !== 0 ? online : null // an unfinished OGS game I play
  const opponent = online && online.me !== 0 ? online.players[online.me === 1 ? 'white' : 'black'] : null
  // The trainers borrow the board and the card, one at a time; the game waits underneath, untouched. A new activity (a
  // takeover of the same shape as useJoseki/useExercises) plugs in at four places: its name in Panel, its hook in
  // `trainers` below, its row in the Learn sheet's `decks`, and its command in `commands` (menu ids: src/menu.ts).
  type Panel = 'joseki' | 'fuseki' | 'exercises' | 'count' | 'memory' | 'editor' | 'classics'
  const [panel, setPanel] = useState<Panel | null>(null)
  /** A trainer's setOpen: opening it replaces any other; closing it closes only itself. */
  const panelOpen = (name: Panel) => (o: boolean) => setPanel(p => (o ? name : p === name ? null : p))
  // Autoplay: the line being played, one move per settings.autoplay seconds, dropped like the bot's moves
  const [auto, setAuto] = useState<Game | null>(null)
  const [held, setHeld] = useState(false) // A held: free analysis of the shown position
  // the automatic review reads only when nothing else wants the engine, nor a local game the player's attention
  const playingLocal = !result && (!!bot || dirty || unfinished(game))
  // the player's rank read in their moves (src/rank.ts); with "Auto-adjust", it sets their level and anchors the AI's
  const [ranks, setRanks] = useState(loadRanks)
  const ranksRef = useRef(ranks) // the latest store, so two readings completing close together both count
  // the AI level the next game will use, announced on the shown game's result line (finish()'s nudge, then the rank's anchoring)
  const [nextAi, setNextAi] = useState<string | null>(null)
  /** Stores a reading of the player's own moves; with "Auto-adjust", their level and the AI's follow. The AI level, when it changed. */
  const keepRank = (k: string, r: Reading, adjust = true): string | null => {
    const s = ranksRef.current = { ...ranksRef.current, p: withReading(ranksRef.current.p, k, r, Date.now()) }, local = localRank(s.p.games)!
    setRanks(s); saveRanks(s)
    if (!settings.autoAdjust || !adjust) return null
    const me = rankName(local), ai = RANKS[anchored(RANKS.indexOf(settings.aiRank), local)]
    if (me !== settings.myRank || ai !== settings.aiRank) setSettings(x => ({ ...x, myRank: me, aiRank: ai }))
    return ai !== settings.aiRank ? ai : null
  }
  const keep = useRef(keepRank)
  keep.current = keepRank
  const bgFree = canAnalyze && engine.state !== 'error' && !thinking && !review && !panel && !ongoing && !joining && !playingLocal && !auto && !held
  const ar = useAutoReview({
    free: bgFree,
    ask: (g, q) => analyze(g, { ...q, priority: -1 }), // KataGo serves higher priorities first: the bot, the trainers jump the queue
    scanRun, add: (...x) => ex.add(...x),
    done: (k, ms, r, j) => { // a job is always the player's own game
      const prev = note, ai = r && keepRank(k, r, !j.noAdjust)
      noteReview(j.id, j.leads, ms).then(() => { if (r && !j.noRank) return noteRank(j.id, r) }).catch(console.error)
      if (ai) setNextAi(ai) // the next game's level, whichever game the line shows
      if (!result || recordKey(game) !== k) return
      setNote(d => [prev?.(d), d.autoDone(ms.length, r ? rankName(r.all) : undefined)].filter(Boolean).join(' '))
    },
    human: canPlayAI,
  })
  const books = { view, preload: sheet === 'learn', rank: settings.myRank, setRank: (v: string) => set('myRank', v), blocked: ongoing || !!review, playFrom: (m: Move[]) => playFrom(m), setBook: setPanel }
  const jt = useJoseki({ ...books, open: panel === 'joseki', setOpen: panelOpen('joseki') })
  const ft = useJoseki({ ...books, book: 'fuseki', open: panel === 'fuseki', setOpen: panelOpen('fuseki') })
  /** S'entraîner on the fuseki, a line started at once (the ritual, and Travailler › Opening). */
  const practiseJoseki = () => { setSheet(null); setPanel('joseki'); jt.practise() }
  const practiseFuseki = () => { if (ft.failed) return practiseJoseki(); setSheet(null); setPanel('fuseki'); ft.practise() } // the joseki stands in for a book that did not load
  // Compter (C1) and Rejouer de mémoire (C2)
  const ct = useCounting({
    open: panel === 'count', setOpen: panelOpen('count'), blocked: ongoing || !!review, canAnalyze, setThinking,
    light: g => { const run = scanRun.current.catch(() => {}).then(() => analyze(g, { maxVisits: TERRITORY_VISITS, includeOwnership: true })); scanRun.current = run; return run.then(a => a.ownership) },
  })
  const mem = useMemory({ view, open: panel === 'memory', setOpen: panelOpen('memory'), blocked: ongoing || !!review, onEnd: setNote })
  /** Replays the shown game from memory; its score goes to its library entry (a file or an unkept game is kept first). */
  const replay = () => mem.start(game, async () => library.idOf(game) ?? library.keep(game, online ? 'ogs' : bot ? 'ai' : 'file', mine, online ? { ogsId: online.id } : {}))
  const ex = useExercises({
    view, open: panel === 'exercises', setOpen: panelOpen('exercises'), blocked: ongoing || !!review, canAnalyze, setThinking,
    autoLine: ar.pct !== null ? t.autoRunning(ar.pct) : ar.pending ? t.autoPending(ar.pending) : null,
    ask: (g, q = REPLY) => { const run = scanRun.current.catch(() => {}).then(() => analyze(g, q as Record<string, unknown>)); scanRun.current = run; return run },
    hand: ct.available ? HAND - COUNTS : HAND,
  })
  useMining({ free: bgFree, ask: (g, q) => analyze(g, { ...q, priority: -1 }), scanRun, known: ex.has, add: ex.addItems }) // tsumego from reviewed games
  const workOpening = () => { if (!ongoing && !review) practiseFuseki() } // Travailler › Ouverture, after its exercises: S'entraîner on the fuseki
  const cl = useClassics({
    view, open: panel === 'classics', setOpen: panelOpen('classics'), blocked: ongoing || !!review, canAnalyze, setThinking, rank: settings.myRank,
    ask: (g, q) => { const run = scanRun.current.catch(() => {}).then(() => analyze(g, q)); scanRun.current = run; return run },
  })
  const [ritualSaid, setRitualSaid] = useState<number | null>(null) // the ritual got done with a panel open: its streak, said in that panel's note
  useEffect(() => setRitualSaid(null), [panel])
  const opening = ft.failed ? 'joseki' : openingBook(weakest(ex.games)) // the ritual's joseki or fuseki step
  const netsUnknown = inTauri() && !nets // at launch: the steps needing a net are neither done nor off yet
  const td = useToday({
    blocked: ongoing || !!review,
    // the exercises step: a hand of exercises, then two positions to count when your reviewed games give some
    decks: [handStep(netsUnknown ? { done: false, left: null } : canAnalyze ? ex.today : null, ct.available ? countStep(ct.today) : null), (opening === 'fuseki' ? ft : jt).today ?? { done: false, left: null }], canPlay: netsUnknown ? null : canPlayAI, rank: settings.myRank,
    // each step closes the Learn sheet, then takes the card
    start: [() => { setSheet(null); if (canAnalyze && !ex.today?.done) ex.start({ only: null }); else setPanel('count') }, opening === 'fuseki' ? practiseFuseki : practiseJoseki,
      () => { setSheet(null); setPanel(null); void newGame(9, { rank: settings.myRank, handicap: 0, ritual: true }) }],
    onDone: n => { if (panel) setRitualSaid(n); else setNote(d => d.ritualDone(n)) }, // a panel's note hides the game's
  })
  // the position editor: its position starts a game against the AI (through the Play sheet), by two, or stays shown
  const [fromPos, setFromPos] = useState<Game | null>(null) // the Play sheet starts from this position
  useEffect(() => { if (sheet !== 'game') setFromPos(null) }, [sheet])
  const positions = useRef(new WeakSet<Game>()) // shown positions: saved, they enter the library as 'position'
  const ed = useEditor({
    view, open: panel === 'editor', setOpen: panelOpen('editor'), blocked: ongoing || !!review, size: game.info.size,
    onAi: g => { setSettings(s => ({ ...s, opponent: 'ai', handicap: 0 })); resize(g.info.size); door('game'); setFromPos(g) },
    onTwo: g => void fromPosition(g), onDone: g => void fromPosition(g, true),
  })
  const trainers = [jt, ft, ex, ct, mem, ed, cl] // every takeover of the card, in no particular order: at most one is open
  const tr = trainers.find(x => x.open) ?? ex
  const removal = online?.phase === 'stone removal' && atEnd ? online : null
  const humanTurn = joining ? false : online ? online.phase === 'play' && atEnd && (online.placing ? online.me === 1 : game.toPlay === online.me) : !bot || game.toPlay !== bot.sign
  const mt = useMentor({ game, bot, changed, thinkingTime: !!bot && humanTurn && atEnd && !result && !game.ended && !panel })
  const mine: Sign | 0 = bot ? -bot.sign as Sign : online?.me ?? ogsSide(game) // the side a review looks at
  const shown = review?.branch ?? game
  const m = review?.moments?.[review.k]
  const from = m ? fromOf(m, review!.step) : 0
  const reading = !!review && !review.moments
  // ① takes only the punisher's moves (← may show the engine's turn); ② and ③ explore freely
  const lessonPlayable = !!review?.branch && !thinking && !shown.ended && !review.error && (review.step !== 'try' || shown.toPlay === -m!.sign)
  const countingNow = !review && counting?.game === game && game.ended && atEnd ? counting : null
  const reviewShown = inTauri() && game.info.size <= 19 && game.moves.length > 0 && (!bot || !!result) && !ongoing
  const canReview = reviewShown && canAnalyze
  // a game to replay from memory: moves to place, not one being played (the AI's, an OGS game going on), no review
  const canMemory = game.moves.some(m => !m.setup) && (!bot || !!result) && !ongoing && !review
  const shownEntry = library.idOf(game) ? library.get()?.find(e => e.id === library.idOf(game)) : undefined // the shown game's library entry, once loaded
  const live = ongoing || !!bot && !result || !!panel // a game being played (or a trainer shown): no autoplay
  const locked = !!result && atEnd // a decided line: playing from an earlier move opens a variation
  const play = (v: Vertex | null) => {
    if (tr.open) return tr.play(v)
    if (countingNow) {
      if (v && !result) setCounting({ ...countingNow, dead: toggleDead(game.board.signMap, countingNow.dead, v) })
      return false
    }
    if (review) {
      if (!lessonPlayable || !v) return false // after an error, only Try again goes on
      const r = shown.play(v)
      if (r === 'ok') {
        const graded = shown.cursor === from + 1 // a new try from the lesson's start: graded again
        setReview(x => x && { ...x, ask: shown.leaf, explored: x.explored || x.step !== 'try', gap: graded ? null : x.gap })
        changed()
      } else if (pick(t.refused, r)) setNote(d => pick(d.refused, r)!)
      return r === 'ok'
    }
    if (removal) {
      const r = v && ogs.removalToggle(game.board.signMap, removal.removed, v)
      if (r) send(() => ogs.setRemoved(removal.id, r.stones, r.removed))
      return false
    }
    // free handicap placement: OGS echoes each stone back as a reload with the new setup
    if (online?.placing) { if (v && humanTurn) send(() => ogs.move(online.id, v)); return false }
    if (locked || !humanTurn) return false
    // a move after the flag fell (the timer late, after a sleep) is no move: the loss on time first
    if (clock?.turn && !result && clock.turn !== bot?.sign && timeUp(clock, clock.turn, Date.now())) { loseOnTime(clock.turn); return false }
    const r = game.play(v)
    if (r === 'ok' && online) { changed(); if (!send(() => ogs.move(online.id, v))) game.undo() } // optimistic: OGS echoes it back
    else if (r === 'ok') { setDirty(true); setCounting(null); changed() }
    else if (pick(t.refused, r)) setNote(d => pick(d.refused, r)!)
    return r === 'ok'
  }
  const undo = async () => {
    if (panel || review || bot && result || online || game.cursor === 0) return
    // what goes: the subtree from the first move taken back (against the bot, back to the player's last move)
    let to = game.cursor - 1, n = 0
    if (bot) while (to > 0 && -game.moves[to - 1].sign === bot.sign) to--
    for (const st = [game.nodes[to + 1]]; st.length; n++) st.push(...st.pop()!.children)
    if (n > 2 && !(await askFirst(t.undoAsk(n - 1), t.undo))) return
    let undone = false
    // against the bot, take back to the player's last move
    while (game.undo()) { undone = true; if (!bot || game.cursor === 0 || game.toPlay !== bot.sign) break }
    if (undone) { setDirty(true); setCounting(null); changed() }
  }
  const goTo = (i: number) => {
    setAuto(null)
    i = Math.max(review?.branch ? from : 0, Math.min(shown.moves.length, i))
    if (i === shown.cursor) return
    shown.goTo(i) // in a lesson, an owed answer (ask) waits until the cursor is back at the branch end
    changed()
  }
  /** Another line of the shown tree (↑ ↓, the variation links); not while reading or without lessons. */
  const relocate = (f: (g: Game) => void) => {
    if (review && !review.branch) return
    setAuto(null); setCounting(null); f(shown); changed()
  }
  const toggleAuto = () => {
    if (auto) return setAuto(null)
    if (live || shown.moves.length === floor) return
    if (shown.cursor === shown.moves.length) { shown.goTo(floor); changed() } // from the start again (an opened file shows its end)
    setAuto(shown)
  }
  useEffect(() => {
    if (!auto) return
    if (auto !== shown || live || shown.cursor >= shown.moves.length) { setAuto(null); return }
    const id = setTimeout(() => {
      shown.goTo(shown.cursor + 1)
      const m = shown.lastMove
      if (m?.vertex) view.current?.drop(m.vertex, m.sign); else if (m) view.current?.pass?.(m.sign)
      changed()
    }, settings.autoplay * 1000)
    return () => clearTimeout(id)
  }, [auto, shown, ver, live, settings.autoplay]) // eslint-disable-line react-hooks/exhaustive-deps
  // online is cleared only here, and only with the board replaced: an unfinished OGS position never becomes a local
  // game open to KataGo (a finished one may stay, see signOut)
  const stopOnline = () => { leaveOnline.current?.(); leaveOnline.current = null; setOnline(null); setJoining(false) }
  const start = (g: Game, b: typeof bot) => { abandon(); stopOnline(); show(g, b) }
  const show = (g: Game, b: typeof bot) => {
    setGame(g); setBot(b); setNote(null); setStarted(null); setBotError(null); setDirty(false); setOwn(null); setCounting(null); setReview(null); setClock(null); setNextAi(null)
  }
  // the local game is written as it goes; at launch an unfinished one comes back without asking, its clock paused
  useCurrentGame({ game, bot, clock, myRank: settings.myRank }, ver, r => {
    show(r.game, r.bot); setClock(r.clock); setPaused({ game: r.game, len: r.game.moves.length })
    if (SIZES.includes(r.game.info.size)) resize(r.game.info.size)
    setNote(d => d.gameResumed)
  })
  /** Leaving the shown game: an unfinished OGS game goes on without us; unsaved moves are lost. */
  // only a live game I play goes on with my clock running; spectated and correspondence games are left silently
  const leaveAsked = !!myGame && !myGame.corr
  // an unfinished local game stays in the library, unfinished; a file played on and not saved loses its moves
  const canLeave = async () => leaveAsked ? askFirst(t.ogsLeaveAsk, t.ogsLeave) : unfinished(game) ? askFirst(t.abandonAsk, t.abandon) : !dirty || isLocal(game) || confirmDiscard()
  // an action that may replace the game cancels a pending search or live challenge before any picker, download or
  // dialog: a match starting meanwhile would replace the game without the leave question; backing out leaves it cancelled
  // o: the daily ritual's game (always against the AI, at your level, even)
  // from: a position from the editor, its stones the game's setup (no handicap)
  const newGame = async (size = nextSize, o: { rank?: string; handicap?: number; ritual?: true; from?: Game } = {}) => {
    if (o.ritual && !canPlayAI) return // never a two-player 9×9 in its place (the network state not known yet)
    abandon()
    if (!(await canLeave())) return
    const from = o.from && { setup: o.from.info.setup, firstSign: o.from.info.firstSign }
    if (o.from) { size = o.from.info.size; o.handicap = 0; ed.close() }
    resize(size)
    let g: Game
    if ((settings.opponent === 'ai' || o.ritual) && canPlayAI) {
      const h = o.handicap ?? settings.handicap // with a handicap the player takes Black, White plays first
      const me: Sign = h || settings.color === 'b' ? 1 : settings.color === 'w' ? -1 : random() < 0.5 ? 1 : -1
      const b = { sign: -me as Sign, rank: o.rank ?? settings.aiRank, ...o.ritual && { ritual: true as const },
        ...!o.ritual && settings.style === 'era' && { era: settings.era, rank: MASTER_RANK }, ...!o.ritual && settings.mentor && canAnalyze && { mentor: true as const } }
      const name = botName(b)
      g = new Game({ size, playerBlack: me === 1 ? '' : name, playerWhite: me === 1 ? name : '', ...from,
        ...h > 0 && { komi: 0.5, setup: { black: handicapStones(size, h), white: [] }, firstSign: -1 as Sign } })
      if (h > 0) g.root.data.HA = [String(h)]
      start(local(g), b)
    } else start(g = local(new Game({ size, ...from })), null)
    if (settings.clock !== 'off') { Object.assign(g.root.data, sgfTime(CLOCKS[settings.clock])); setClock(startClock(CLOCKS[settings.clock])) }
  }
  // from: an OGS game imported (kept in the library), or a game of the library (an unfinished local one is played again)
  const open = async (read: () => Promise<string | null> = openSgfFile, asked = false, from: { ogsId?: number; entry?: library.Entry } = {}) => {
    abandon()
    try {
      const text = await read()
      if (text === null) return
      if (text.length > MAX_SGF) throw new LocalizedError(l => l.sgfTooBig)
      const g = loadSgf(text)
      if (!asked && !(await canLeave())) return
      const e = from.entry, again = e && resumable(e)
      if (e) library.bind(g, e.id)
      start(again ? local(g, e) : g, again ? again.bot : null); if (SIZES.includes(g.info.size)) resize(g.info.size)
      if (from.ogsId !== undefined) { keepOgs(g, ogsSide(g), from.ogsId); ar.enqueue(g, ogsSide(g), { id: library.idOf(g) }) } // an ended OGS game of mine
    } catch (e) {
      setNote(d => d.openFailed(failureText(e, d)))
    }
  }
  /** The trainer's "Play a game from here": the bot takes the other side when it can play, else two players. */
  const playFrom = async (moves: Move[]) => {
    abandon()
    if (!(await canLeave())) return false
    const me = -moves.at(-1)!.sign as Sign, ai = settings.opponent === 'ai' && canPlayAI, name = t.botName(settings.aiRank)
    start(local(Game.fromRecord({ size: 19, playerBlack: ai && me === -1 ? name : '', playerWhite: ai && me === 1 ? name : '' }, moves)),
      ai ? { sign: -me as Sign, rank: settings.aiRank, ...settings.mentor && { mentor: true as const } } : null)
    return true
  }
  /** The editor's "Two players from here" and "Done": the position becomes the shown game. */
  const fromPosition = async (g: Game, done = false) => {
    abandon()
    if (!(await canLeave())) return
    ed.close(); resize(g.info.size); start(done ? g : local(g), null) // by two: a local game, kept from its first move
    if (done) positions.current.add(g)
  }
  const save = async () => {
    try {
      if (bot) game.info[bot.sign === 1 ? 'playerBlack' : 'playerWhite'] = botName(bot) // the SGF keeps the language it was saved in
      if (await saveSgfFile(saveSgf(game), t.fileName(game.info.size))) {
        setDirty(false); setNote(d => d.saved)
        if (positions.current.has(game)) library.keep(game, 'position', 0).catch(() => {}) // outside the app there is no library
      }
    } catch (e) {
      setNote(d => d.saveFailed(failureText(e, d)))
    }
  }
  const exporting = useRef(false) // a second click mustn't open a second save dialog
  const postcard = async () => {
    if (exporting.current) return
    exporting.current = true
    try {
      const png = await view.current?.snapshot?.()
      if (!png) throw new LocalizedError(d => d.postcardNotReady)
      const lent = tr.open && tr.board && 'signMap' in tr.board ? tr.board.signMap : undefined // a trainer's board is what the picture shows
      if (await savePngFile(png, lent ? t.postcardName(lent.length) : t.postcardName(shown.info.size, shown.moveNumber()))) setNote(d => d.postcardSaved)
    } catch (e) {
      setNote(d => d.postcardFailed(failureText(e, d)))
    } finally {
      exporting.current = false
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
        setOnline(s); setResult(s.game, r ? { msg: d => d.ogsResult(r.winner, r.how, r.points), re: r.re } : null)
      })
    } catch (e) { setJoining(false); setNote(d => failureText(e, d)) }
  }
  // for callbacks that outlive the render they were made in (a match or a challenge starting later)
  const latestFollow = useRef(follow)
  latestFollow.current = follow
  const resume = async (id: number) => { if (online?.id === id) return; abandon(); if (await canLeave()) follow(id) }
  const importGame = async (id: number) => { abandon(); if (await canLeave()) open(() => ogs.sgf(id), true, { ogsId: id }) }
  const find = async () => {
    if (!(await canLeave())) return // the shown game is left once a match starts
    abandon()
    try {
      const size = nextSize as ogs.BoardSize, speed = settings.ogsSpeed, m = ogs.findMatch(size, speed)
      searching.current = m.cancel
      setSearch({ size, speed })
      m.started.then(id => { searching.current = null; latestFollow.current(id) })
    } catch (e) { setNote(d => failureText(e, d)) }
  }
  const cancelSearch = () => { searching.current?.(); searching.current = null; setSearch(null) }
  /** Whatever would replace the shown game on its own later: a pending automatch, a live challenge's wait. */
  const abandon = () => { cancelSearch(); cancelChallenge(true) }
  /** Before signing out: an unfinished OGS game is left (asked first) and its board replaced; a finished one stays. */
  const signOut = async () => {
    if (leaveAsked && !(await askFirst(t.ogsLeaveAsk, t.ogsLeave))) return false
    stopWait()
    if (ongoing) start(new Game({ size: game.info.size }), null)
    else { cancelSearch(); stopOnline() }
    return true
  }
  const stopWait = () => { waiting.current?.stop(); waiting.current = null; setChallengeWait(null) }
  /** Ends the live challenge's wait and withdraws it; `quiet`: best effort, when something else replaces it. */
  const cancelChallenge = (quiet = false) => {
    const id = waiting.current?.id
    stopWait()
    if (id !== undefined) ogs.cancelChallenge(id).catch(e => { if (!quiet) setNote(d => failureText(e, d)) })
  }
  /** The sheet's Sent list: the waited challenge ends its wait too. */
  const cancelSent = (id: number) => {
    if (waiting.current?.id === id) cancelChallenge()
    else ogs.cancelChallenge(id).catch(e => setNote(d => failureText(e, d)))
  }
  /** A challenge sent; a live one waits, with its keepalive, for the game to start without replacing the board. */
  const sendChallenge = async (playerId: number, who: string, body: unknown, corr: boolean) => {
    if (!corr) cancelSearch()
    const { challengeId, gameId } = await ogs.challenge(playerId, body)
    if (corr) return setNote(d => d.ogsChallengeSent(who))
    cancelChallenge(true) // an earlier one still waiting
    setNote(null)
    let leave = () => {}
    const stopKeep = ogs.keepAlive(challengeId, gameId), w = { id: challengeId, gameId, stop: () => { stopKeep(); leave() } }
    waiting.current = w
    setChallengeWait({ id: challengeId, gameId, who })
    try {
      // the wait ends before follow(), whose start() would otherwise withdraw this very challenge
      leave = ogs.follow(gameId, (_, s) => { if (s && waiting.current === w) { stopWait(); latestFollow.current(gameId) } })
    } catch (e) { stopWait(); setNote(d => failureText(e, d)) }
  }
  const challengePlayer = async (username: string, o: { ranked: boolean; handicap: boolean }) => {
    const speed = settings.ogsSpeed, corr = speed === 'correspondence'
    const p = await ogs.findPlayer(username) // an unknown name fails here, before any leave question
    if (!corr && !(await canLeave())) return
    await sendChallenge(p.id, p.username, ogs.challengeBody({ size: nextSize as ogs.BoardSize, speed, ...o }), corr)
    if (!corr) closeSheet()
  }
  const rematch = () => {
    if (!online || !opponent) return
    sendChallenge(opponent.id, opponent.username, ogs.rematchBody(online), online.corr).catch(e => setNote(d => failureText(e, d)))
  }
  // asked for every pace: following the new game replaces the board
  const accept = async (c: ogs.ChallengeRow) => {
    abandon()
    if (!(await canLeave())) return
    try { const id = await ogs.acceptChallenge(c.id); closeSheet(); follow(id) } catch (e) { setNote(d => failureText(e, d)) }
  }
  const openLink = async (id: number) => {
    closeSheet()
    try { if ((await ogs.gameInfo(id)).ended) importGame(id); else resume(id) } catch (e) { setNote(d => failureText(e, d)) }
  }
  // OGS notices: a system notification in the background; in the app, only what the dot and the sheet don't show
  const onNotice = useRef((_: ogs.Notice) => {})
  onNotice.current = n => {
    const who = n.who ?? ''
    void notify(n.key, n.kind === 'yourTurn' ? t.ogsTurnTitle : n.kind === 'challenge' ? t.ogsChallengeFrom(who)
      : n.kind === 'started' ? t.ogsStartedVs(who) : n.kind === 'ended' ? t.ogsEndedVs(who) : t.ogsDeclined(who),
      n.kind === 'yourTurn' ? t.ogsTurnBody(who, n.size ?? 0) : undefined)
    // newer OGS news supersedes a stale note, which would otherwise hide the ambient line (a result line wins anyway: its note stays)
    if (n.kind === 'challenge' && !result) setNote(null)
    if (n.gameId === undefined) return
    // a game of mine that ended outside Masame (correspondence, the website): reviewed too, the game being over
    const id = n.gameId
    if (n.kind === 'ended' && n.outcome !== 'Void') ogs.sgf(id).then(s => { const g = loadSgf(s); keepOgs(g, ogsSide(g), id); ar.enqueue(g, ogsSide(g), { id: library.idOf(g) }) }).catch(console.error)
    if (n.kind === 'declined' && n.gameId === waiting.current?.gameId) { stopWait(); setNote(d => d.ogsDeclined(who)) }
    else if (n.kind === 'started' && n.gameId !== online?.id && n.gameId !== waiting.current?.gameId && document.hasFocus()) { if (!result) setNote(null); setStarted({ id: n.gameId, who }) }
  }
  useEffect(() => ogs.onNotice(n => onNotice.current(n)), [])
  // a followed OGS game of mine that finished (not cancelled): reviewed in the background, OGS's rules no longer apply
  const ogsEnded = online?.phase === 'finished' && online.me !== 0 && !!online.result && online.result.re !== 'Void' && online.result.how !== 'cancel'
  useEffect(() => {
    if (!ogsEnded) return
    const { black: b, white: w } = online.players
    keepOgs(online.game, online.me, online.id, { result: online.result!.re, black: { name: b.username, rank: b.rank }, white: { name: w.username, rank: w.rank } })
    ar.enqueue(online.game, online.me as Sign, { id: library.idOf(online.game) })
  }, [ogsEnded, online?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** End of a game: record the result (and, against the bot, nudge its rank toward a 50 % win rate, once). */
  const finish = (text: Msg, botWon: boolean | null, re: string) => {
    game.promote() // the decided line is the record's main line, which RE describes
    game.info.result = re
    setResult(game, { msg: text, re })
    if (bot) ar.enqueue(game, -bot.sign as Sign, { ...lessonFlags(bot), id: library.idOf(game) })
    if (bot?.ritual) td.played()
    if (!bot || scored.current === game || botWon === null) return
    scored.current = game
    if (settings.autoAdjust && !bot.ritual && !lessonFlags(bot).noAdjust) {
      // a step toward 50 % wins, kept within BAND of the rank read in the player's moves (once there is one)
      const step = adjustRank(bot.rank, botWon), local = localRank(ranksRef.current.p.games)
      const next = local === null ? step : RANKS[anchored(RANKS.indexOf(step), local)]
      if (next !== bot.rank) { set('aiRank', next); setNextAi(next) }
    }
  }
  const cancellable = !!myGame && ogs.canCancel(myGame) // early in the game: cancelled instead, not counted
  const resign = async () => {
    if (cancellable) { if (await askFirst(t.ogsCancelAsk, t.ogsCancelGame)) send(() => ogs.cancelGame(myGame.id)); return }
    if (online) { if (!result && await askFirst(t.ogsResignAsk, t.resign)) send(() => ogs.resign(online.id)); return }
    if (!bot || result) return
    finish(d => d.resigns(-bot.sign), true, resignResult(bot.sign))
  }
  // the local clock runs for the side to move at the end of the line; stopped after two passes, once decided, under a trainer
  const tail = game.moves.slice(-2), endTurn = (game.moves.length ? -game.moves.at(-1)!.sign : game.info.firstSign) as Sign
  const clockTurn = result || panel || tail.length === 2 && tail.every(m => !m.vertex) || paused?.game === game && paused.len === game.moves.length ? null : endTurn
  useEffect(() => { if (clock) { const c = sync(clock, clockTurn, Date.now(), game.moves.length); if (c !== clock) setClock(c) } })
  // a human side out of time loses (checked late too, after a sleep); the bot's clock runs but it never loses on time
  const loseOnTime = (s: Sign) => finish(d => d.losesOnTime(s), bot ? true : null, timeResult(-s as Sign))
  useEffect(() => {
    if (!clock || clock.turn === null || result) return
    const late = ([1, -1] as const).find(s => s !== bot?.sign && timeUp(clock, s, Date.now()))
    if (late) return loseOnTime(late)
    const s = clock.turn
    if (s === bot?.sign) return
    const id = setTimeout(() => loseOnTime(s), flagAt(clock)! - Date.now())
    return () => clearTimeout(id)
  }, [clock, result]) // eslint-disable-line react-hooks/exhaustive-deps
  const final = countingNow && score(game.board.signMap, countingNow.dead, { black: game.board.getCaptures(1), white: game.board.getCaptures(-1) }, game.info.komi, countingNow.own)
  const validate = () => {
    if (!final || result) return
    finish(d => d.score(final.lead), bot && final.lead !== 0 ? (final.lead > 0) === (bot.sign === 1) : null, scoreResult(final.lead))
  }

  // Game review: reading (scan + deep checks), then lessons on the branch boards
  const startReview = (side: Sign | 0) => {
    const last = game.boards.at(-1)!
    if (scan.current?.last !== last) scan.current = { last, leads: ar.leadsOf(game) } // a background review's leads, if any
    setReview({ side, pct: 0, error: null, moments: null, k: 0, step: 'try', branch: null, ask: null, gap: null, explored: false })
    // a reviewed game enters the library (a local or OGS game of mine is in it already)
    reviewId.current = (online ? library.keep(game, 'ogs', online.me, { ogsId: online.id }) : library.keep(game, 'file', side)).catch(e => { console.error('library', e); return undefined })
    changed()
  }
  const openMoment = (k: number, step: Step, moments = review!.moments!) => {
    const branch = moments[k] ? lessonBoard(game, moments[k], step) : null
    setReview(x => x && { ...x, moments, k, step, branch, ask: null, gap: null, explored: false, error: null })
    changed()
  }
  const leaveReview = () => { setReview(null); changed() }
  const retryLesson = () => { setReview(x => x && { ...x, error: null }); retryReview() }

  // The bot's turn: ask KataGo (human policy at the bot's rank + a small search), then play after a human-like pause.
  // A failed query is retried (the Rust side restarts a crashed engine and waits until it is warm); after the last
  // attempt the note offers "Réessayer" — undo and new game stay available throughout.
  const botTurn = !!bot && !result && !game.ended && atEnd && game.toPlay === bot.sign && !panel && !mt.stopped
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
          overrideSettings: { humanSLProfile: botProfile(bot), ignorePreRootHistory: false },
        })
      } catch (e) {
        if (!live || attempt >= BOT_ATTEMPTS) throw e
        await sleep(1000 * attempt)
        if (!live) throw e // undo / new game during the wait: send nothing more
        return ask(attempt + 1)
      }
    }
    // with the mentor, the player's last move is examined first (1 s at most): a costly one stops the game there
    mt.check(game).then(loss => (!live ? null : loss === null ? ask() : (mt.stop(game, loss), null))).then(async a => {
      if (!live || !a) return
      if (!a.humanPolicy) throw new LocalizedError(d => d.humanSilent)
      const n = game.info.size, botWinrate = bot.sign === 1 ? a.winrate : 1 - a.winrate
      const history = game.moves.slice(0, game.cursor).flatMap(m => winrates.current.get(m) ?? []) // the bot's moves on this line
      const m = decide({
        humanPolicy: a.humanPolicy, topMove: a.topMove, botWinrate, history, ownership: a.ownership,
        mayResign: settings.botResign, signMap: game.board.signMap, opponentPassed: !!game.lastMove && !game.lastMove.vertex, moveNumber: game.moveNumber(),
        legal: i => game.isLegal([i % n, Math.floor(i / n)]),
      }, random)
      if (m.kind === 'resign') return finish(d => d.resigns(bot.sign), false, resignResult(-bot.sign as Sign))
      const wait = settings.delay ? m.delay - (performance.now() - t0) : 0
      if (wait > 0) await new Promise(r => setTimeout(r, wait))
      if (!live) return
      const v: Vertex | null = m.kind === 'play' ? [m.index % n, Math.floor(m.index / n)] : null
      if (game.play(v) !== 'ok') game.play(null) // shortcut: an illegal sample (superko corner case) becomes a pass
      winrates.current.set(game.lastMove!, botWinrate)
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
    if (!settings.territory || !canAnalyze || review || ongoing || joining) return
    let live = true
    const t = setTimeout(() => {
      analyze(game, { maxVisits: TERRITORY_VISITS, includeOwnership: true })
        .then(a => live && setOwn({ game, data: a.ownership, score: a.scoreLead }), e => live && setNote(d => failureText(e, d)))
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [settings.territory, ver, game, canAnalyze, !!review, ongoing, joining]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reading: resumes from the scan cache after an error ("Try again") or a colour change.
  useEffect(() => {
    if (!reading || !review || !scan.current) return
    let live = true
    const leads = scan.current.leads
    const run = scanRun.current.catch(() => {}).then(() => readGame(game, review.side, leads,
      (at, q) => analyze(game.branch(at), q as Record<string, unknown>), () => live, pct => live && setReview(x => x && { ...x, pct })))
    scanRun.current = run
    run.then(ms => {
      if (!live) return
      ex.add(game, ms, leads, mine || review.side)
      noteReview(reviewId.current, leads, ms).catch(console.error)
      if (!canPlayAI || !review.side || review.side !== mine) ar.reviewed(game) // else once the rank is read too
      openMoment(0, 'try', ms)
    }, e => live && setReview(x => x && { ...x, error: e }))
    return () => { live = false }
  }, [reading, review?.side, game, reviewTry]) // eslint-disable-line react-hooks/exhaustive-deps
  // The reviewed side's rank, once the moments are in: not behind scanRun (the lessons' answers don't wait for its many
  // tiny queries), at a lower priority than them; stored only for the player's own side
  const rankSide = review?.moments && review.side && canPlayAI ? review.side : 0
  useEffect(() => {
    if (!rankSide) return
    let live = true
    readRank(game, rankSide, ar.ranksOf(game), (g, q) => analyze(g, { ...q, priority: -1 }), () => live).then(r => {
      if (!live) return
      setReview(x => x && { ...x, rank: r })
      if (rankSide !== mine) return
      const lesson = bot ?? (shownEntry && { era: shownEntry.era, ...shownEntry.mentor && { mentor: true as const } }) // a lesson reopened from Mes parties stays one
      const f = lesson ? lessonFlags(lesson) : {}, ai = r && !f.noRank && keep.current(recordKey(game), r, !f.noAdjust) // no note: it would replace the lesson's caption
      if (r && !f.noRank) noteRank(reviewId.current, r).catch(console.error)
      if (ai) setNextAi(ai)
      ar.reviewed(game)
    }, e => { if (live) { console.error('rank', e); setReview(x => x && { ...x, rank: null }) } })
    return () => { live = false }
  }, [rankSide, game]) // eslint-disable-line react-hooks/exhaustive-deps

  // In a lesson, the engine answers each move played on the branch; a try from the lesson's start is graded.
  const lesson = review?.branch
  // only for the try that asked: a switch to an answered try (its end is the engine's move) asks nothing more
  const answering = !!lesson && review?.ask === lesson.leaf && !review.error && lesson.cursor === lesson.moves.length && !lesson.ended
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
      setReview(x => x && { ...x, ask: null, error: null, gap: graded ? gradeTry(m, tried, a.scoreLead) : x.gap })
      changed()
    }).catch(e => live && setReview(x => x && { ...x, error: e })).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [answering, ver, lesson, reviewTry]) // eslint-disable-line react-hooks/exhaustive-deps
  // Free analysis while A is held: a quick read, then a deep one, cached per position (the deep one replaces it)
  const reads = useRef(new WeakMap<Game['board'], { a: Analysis; deep: boolean; toPlay: Sign }>()) // a PL pseudo-move keeps the board, not the side to move
  const [anError, setAnError] = useState<unknown>(null)
  const an = held && !ongoing && !joining && !panel && !countingNow && !removal && !reading // OGS forbids engine help in an ongoing game
  const anRead = an ? [reads.current.get(shown.board)].find(r => r?.toPlay === shown.toPlay) : undefined
  useEffect(() => {
    if (!an || !canAnalyze || anRead?.deep) return
    let live = true
    const g = shown, b = g.board
    setAnError(null)
    const ask = (deep: boolean, extra: Record<string, unknown>) => {
      const run = scanRun.current.catch(() => {}).then(() => { if (!live) throw null; return analyze(g, extra) }) // cancelled while queued: send nothing
      scanRun.current = run
      return run.then(a => { if (live) { reads.current.set(b, { a, deep, toPlay: g.toPlay }); rerender() } })
    }
    ;(anRead ? Promise.resolve() : ask(false, QUICK)).then(() => { if (live) return ask(true, DEEP) }).catch(e => live && e && setAnError(e))
    return () => { live = false }
  }, [an, canAnalyze, shown.board, shown.toPlay]) // eslint-disable-line react-hooks/exhaustive-deps
  const cands = anRead ? candidates(anRead.a, shown.toPlay) : null
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
  /** Opens a door's sheet from the keyboard or the menu bar (focus comes back to what had it). */
  const door = (s: NonNullable<typeof sheet>) => { opener.current = document.activeElement as HTMLElement | null; netsFromSettings.current = false; setSheet(s) }
  const openLearn = () => { storeTab('today'); door('learn') }
  // The commands registry: the macOS menu bar's items run these by id (src/menu.ts lists every id, menu.rs the items);
  // an id is enabled in the bar only when it is here and src/menu.ts's rule allows it now.
  const commands: Record<string, () => void> = {
    undo, new: newCommand, open, save, postcard, panel: togglePanel,
    pass: () => play(null), resign, territory: () => { if (!ongoing) set('territory', !settings.territory) }, review: () => { if (canReview && !review) startReview(mine) },
    today: openLearn, exercises: ex.toggle, tsumego: ex.tsumego, joseki: jt.toggle, fuseki: ft.toggle, games: () => door('games'), count: ct.toggle, memory: () => { if (canMemory) replay() },
    position: ed.start, kifu: () => door('kifu'), classics: cl.openList,
    camera: () => set('camera', settings.camera === 'study' ? 'contemplation' : 'study'),
  }
  // a focused range keeps the shortcuts: its arrows/Home/End go through goTo (preventDefault: no second native step)
  const blocked = (target: EventTarget | null) => target instanceof HTMLInputElement && target.type !== 'range' || sheet !== null
  const onMenu = useRef((_: string) => {})
  onMenu.current = id => { if (!blocked(document.activeElement) && Object.hasOwn(commands, id)) commands[id]() }
  useEffect(() => {
    if (!inTauri()) return
    const off = on<string>('menu', id => onMenu.current(id))
    return () => { off.then(f => f()) }
  }, [])
  // Files from outside: dropped on the window, or handed over by the OS (double-click, Open with); a sheet closes first
  const openFrom = useRef((_: () => Promise<string | null>) => {})
  openFrom.current = async read => {
    setSheet(null)
    try { // read and checked before open() abandons anything: a stray file mustn't cancel an OGS search or challenge
      const text = await read()
      if (text === null) return
      if (text.length > MAX_SGF) throw new LocalizedError(l => l.sgfTooBig)
      loadSgf(text)
      open(async () => text)
    } catch (e) {
      setNote(d => d.openFailed(failureText(e, d)))
    }
  }
  useEffect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    let depth = 0 // dragenter/dragleave fire for every element crossed
    const hint = (n: number) => {
      depth = n
      document.documentElement.toggleAttribute('data-drop', n > 0) // the frame
      if (n > 0) document.body.dataset.drop = t.dropHint; else delete document.body.dataset.drop // the veil and its caption
    }
    const enter = (e: DragEvent) => { if (files(e)) hint(depth + 1) }
    const leave = (e: DragEvent) => { if (files(e)) hint(Math.max(0, depth - 1)) }
    const over = (e: DragEvent) => { if (files(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy' } }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault(); hint(0)
      const f = e.dataTransfer!.files[0] // one game at a time
      if (f) openFrom.current(async () => { if (f.size > MAX_SGF) throw new LocalizedError(l => l.sgfTooBig); return f.text() })
    }
    const evs = { dragenter: enter, dragleave: leave, dragover: over, drop }
    for (const [k, f] of Object.entries(evs)) window.addEventListener(k, f as EventListener)
    return () => { for (const [k, f] of Object.entries(evs)) window.removeEventListener(k, f as EventListener) }
  }, [])
  useEffect(() => {
    if (!inTauri()) return
    // asked once listening, too: macOS may hand a file over before this page exists
    const take = () => call<{ name: string; text: string } | null>('take_opened')
      .then(f => { if (f) openFrom.current(async () => f.text) }, e => setNote(d => d.openFailed(failureText(e, d))))
    const off = on<null>('files-opened', take)
    off.then(take)
    return () => { off.then(f => f()) }
  }, [])
  // The macOS menu bar greys what makes no sense now (sent again whenever that changes)
  const enabled = menuEnabled(commands, {
    hasGame: game.moves.length > 0 || game.info.setup.black.length + game.info.setup.white.length > 0, canUndo: !panel && !review && !online && game.cursor > 0 && !(bot && result),
    canPass: !panel && !review && !countingNow && !removal && !game.ended && !locked && humanTurn && !online?.placing,
    canResign: !panel && !review && !result && (!!bot || !!myGame), canReview: !panel && !review && canReview,
    engineHelp: !ongoing && !review, canAnalyze, is3d: renderer === '3d', canMemory: !panel && canMemory,
  })
  const enabledKey = JSON.stringify(enabled)
  useEffect(() => { if (isMac && inTauri()) call('set_menu_enabled', { enabled }).catch(console.error) }, [enabledKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // The macOS menu bar speaks the UI language (its labels live in the dictionaries)
  useEffect(() => { if (isMac && inTauri()) call('set_language', { labels: { ...t.menu, panel: settings.panelHidden ? t.menu.showPanel : t.menu.hidePanel } }).catch(console.error) }, [settings.lang, settings.panelHidden])

  useEffect(() => {
    // In the macOS app the menu's key equivalents own ⌘Z/N/O/S/\: WebKit hands the menu every ⌘-key the page does not
    // preventDefault, so handling them here as well would run them twice.
    const menuKeys = isMac && inTauri()
    const onKey = (e: KeyboardEvent) => {
      // a window shortcut, so even over a sheet or a field; macOS keeps its menu's full screen only
      if (e.key === 'F11' && !isMac) { e.preventDefault(); return setFullscreen(!fullscreen) }
      if (blocked(e.target)) return
      if (e.key.toLowerCase() === 'a' && !e.altKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) setHeld(true); return }
      const cmd = isMac ? e.metaKey : e.ctrlKey, k = e.key.toLowerCase()
      const act = cmd
        ? menuKeys ? undefined : commands[({ z: 'undo', n: 'new', o: 'open', s: 'save', '\\': 'panel' } as Record<string, string>)[k]]
        : e.altKey || e.metaKey || e.ctrlKey ? undefined
        : ({
            arrowleft: () => goTo(shown.cursor - 1), arrowright: () => goTo(shown.cursor + 1),
            arrowup: () => relocate(g => g.switchVariation(-1)), arrowdown: () => relocate(g => g.switchVariation(1)),
            ' ': e.target instanceof HTMLButtonElement ? undefined : toggleAuto,
            home: () => goTo(0), end: () => goTo(shown.moves.length),
            ...(fullscreen && !isMac && { escape: () => setFullscreen(false) }), // after a sheet's Esc and before a review's
            ...(review && { escape: leaveReview }),
            j: jt.toggle, e: ex.toggle, d: openLearn, b: () => door('games'),
            p: () => play(null), c: () => setCoords(v => !v), m: () => setSound(v => !v),
            t: ongoing ? undefined : () => set('territory', !settings.territory), h: togglePanel,
            ...tr.keys, // an open takeover's keys win over the game's (the editor mutes P, C and T)
            ...(renderer === '3d' && {
              v: () => set('camera', settings.camera === 'study' ? 'contemplation' : 'study'),
              r: () => view.current?.resetCamera?.(),
            }),
            ...(renderer === '3d' && settings.decor !== 'lanterne' && { // lighting has no effect at night
              l: () => set('light', LIGHTS[(LIGHTS.indexOf(settings.light) + 1) % LIGHTS.length]),
            }),
          } as Record<string, () => void>)[k]
      if (!act || e.repeat && (cmd || k === ' ')) return
      e.preventDefault()
      act()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'a') setHeld(false) }, blur = () => setHeld(false)
    addEventListener('keyup', up); addEventListener('blur', blur)
    return () => { removeEventListener('keyup', up); removeEventListener('blur', blur) }
  }, [])

  const { size, komi, playerBlack, playerWhite } = game.info
  const board = shown.board, toPlay = shown.toPlay, last = shown.lastMove
  const shownOwn = settings.territory && own?.game === game && !ongoing ? own : null
  const ghost = mt.stopped && !tr.open && last?.vertex ? { v: last.vertex, sign: last.sign } : null // the stopped move, in half-tone
  const engineWait = engine.state === 'tuning' ? t.tuningCaption
    : (thinking || reading || an) && engine.state === 'starting' ? t.engineStarting
    : (thinking || reading || an) && engine.state === 'warming' ? t.engineWarming : null
  // the review's caption and its links (p: the colour that punishes, s: the one that made the mistake)
  const p = m ? -m.sign : 0, s = m?.sign ?? 0
  const graded = m && review?.step === 'try' && review.gap !== null ? verdict(m, review.gap) : null
  const lessonLine = !review ? null
    : reading ? t.reading
    : !m ? t.noMoments(review.side)
    : review.step === 'try' ? graded === 'found' ? t.found : graded === 'short' ? t.shortOf(review.gap!) : graded ? t.missed(s, review.gap!) : t.tryAsk(p, game.moveNumber(m.at) + 1)
    : review.step === 'punish' ? t.punishLine(p, gtp(m.punish[0]!, size), s, m.loss)
    : t.betterLine(s, gtp(m.better[0]!, size), m.loss)
  const lastMoment = !!review?.moments && review.k === review.moments.length - 1
  // [action id, label, action]: the id tells refocus whether the same action is still offered
  type Link = [string, string, () => void]
  const withNote = (text: string) => [text, note?.(t)].filter(Boolean).join(' ')
  const aiMoved = nextAi && nextAi !== bot?.rank ? nextAi : null
  const mentorLine = mt.mentor ? t.mentorStops(mt.stops) : null
  const resultLine = result && [result(t), note?.(t), aiMoved && t.aiNext(aiMoved), mentorLine].filter(Boolean).join(' ')
  const incoming = !myGame && challengeRows.find(c => !c.mine)
  // a finished game shown untouched (from Mes parties, or a file): Revoir, Rejouer de mémoire, Deviner les coups, when each makes sense
  const guessable = !ongoing && !joining && !playingLocal && !search && canAnalyze && canGuess(game) // Les Classiques' mode on a shown game
  const quietShown = canMemory && !bot && !dirty && !unfinished(game) && !result
  const libraryShown = quietShown && !!library.idOf(game) // a game opened from Mes parties
  const libraryLinks: Link[] = [...(canReview ? [['review', t.reviewGame, () => startReview(mine)] as Link] : []), ['memory', t.memLink, replay],
    ...(guessable ? [['guess', t.clOffer, () => cl.guess(game, shownEntry?.me || mine)] as Link] : [])]
  const undoAsk = myGame?.undo
  // outside trainers and reviews, top first: search, OGS game prompts, challenge wait, OGS game states, result, the local
  // game's lines; only when none has anything to say, a game started elsewhere or an incoming challenge
  const [line, lineLinks]: [string | null | undefined, Link[]] = search ? [note?.(t) ?? t.ogsSearching(search.size, t.paces[search.speed]), [['cancel', t.cancel, cancelSearch]]]
    : ongoing && ogsStatus !== 'online' ? [t.ogsReconnecting, []]
    : myGame?.placing ? [withNote(myGame.me === 1 ? t.ogsPlaceMine(myGame.placing) : t.ogsPlaceTheirs(myGame.players.black.username, myGame.placing)), []]
    : undoAsk && undoAsk.by === ogs.me?.id ? [withNote(t.ogsUndoSent), [['withdraw', t.ogsWithdraw, () => send(() => ogs.cancelUndo(myGame.id, undoAsk.move))]]]
    : undoAsk && ogs.me && ogs.canAnswerUndo(myGame, ogs.me.id) ? [withNote(t.ogsUndoAsked(opponent!.username)), [['accept', t.ogsAccept, () => send(() => ogs.acceptUndo(myGame.id, undoAsk.move))]]]
    : myGame?.pause ? [withNote(t.ogsPaused), ogs.canResume(myGame) ? [['resume', t.resume, () => send(() => ogs.resumeGame(myGame.id))]] : []]
    : removal ? [withNote(removal.scoring === 'waiting' ? t.ogsScoringWait : removal.scoring === 'failed' ? t.ogsScoringFailed : t.countingHelp), []]
    : challengeWait ? [t.ogsChallengeWait(challengeWait.who), [['cancel', t.cancel, () => cancelChallenge()]]]
    : ongoing && online.me === 0 ? [withNote(t.ogsWatching(online.players.black.username, online.players.white.username)),
      [['quit', t.ogsLeave, () => start(new Game({ size: game.info.size }), null)]]]
    : result ? [resultLine, [...(canReview ? [['review', t.reviewGame, () => startReview(mine)] as Link] : []), ...(canMemory ? [['memory', t.memLink, replay] as Link] : []),
      ...(online && online.me !== 0 && online.phase === 'finished' ? [['rematch', t.ogsRematch, rematch] as Link] : [])]]
    : mt.stopped ? [t.mentorStop(mt.stopped.loss), [['retry', t.retry, mt.retry], ['keep', t.mentorKeep, mt.keep]]]
    : countingNow ? [t.countingHelp, []]
    : game.ended ? [t.countingWait, []]
    : [[(botError ?? note)?.(t), engineWait].filter(Boolean).join(' ') || (mt.late && !result ? t.mentorLate : null) || (last && !last.vertex ? (atEnd && bot?.sign === last.sign ? t.botPasses : t.passes)(last.sign) : null),
      botError ? [['retry', t.retry, retryBot]] : quietShown ? libraryLinks : []]
  const [gameLine, gameLinks]: [string | null | undefined, Link[]] = line ? [line, lineLinks]
    : started ? [t.ogsStartedVs(started.who), [['open', t.ogsOpen, () => resume(started.id)]]]
    : incoming ? [t.ogsChallenged(incoming.from.username, incoming.from.rank, incoming.size, t.paces[incoming.speed], incoming.ranked),
      [['accept', t.ogsAccept, () => accept(incoming)], ['decline', t.ogsDecline, () => ogs.declineChallenge(incoming.id).catch(e => setNote(d => failureText(e, d)))]]]
    : libraryShown ? [t.libraryShown, libraryLinks]
    : quietShown && guessable ? [t.clOfferLine, libraryLinks]
    : [line, lineLinks]
  // td.onward's step index: the ritual's exercises 0 (its exercises, then its counting), joseki or fuseki 1
  const links: Link[] = tr.open ? [...tr.links, ...td.onward(jt.open || ft.open ? 1 : ex.open || ct.open ? 0 : -1, ex.open ? !!ex.today?.done : undefined)] : review?.error ? [['retry', t.retry, retryLesson]]
    : !review ? gameLinks
    : !m ? [['back', t.backToGame, leaveReview]]
    : review.step === 'try' ? [...(graded ? [['again', t.retry, () => openMoment(review.k, 'try')] as Link] : []), ['punish', t.seePunishment, () => openMoment(review.k, 'punish')]]
    : review.step === 'punish' ? [['better', t.seeBetter, () => openMoment(review.k, 'better')]]
    : lastMoment ? [['back', t.backToGame, leaveReview]] : [['next', t.nextMoment, () => openMoment(review.k + 1, 'try')]]
  const anLine = !an ? null : !canAnalyze ? t.anNeedsNet : anError ? t.anFailed(failureText(anError)) : engineWait
    ?? (cands ? t.anFor(toPlay) : t.anReading)
  const message = anLine ?? (tr.open ? (thinking && engineWait) || [tr.note, ritualSaid && t.ritualDone(ritualSaid)].filter(Boolean).join(' ') : review ? (review.error ? (review.branch ? t.answerFailed : t.reviewFailed)(failureText(review.error)) : note?.(t)) ?? engineWait ?? lessonLine
    : gameLine)
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
  // A promised ClipboardItem first: WebKit refuses a clipboard write made after an await, outside the click; older
  // WebKitGTK lacks it, and may accept the plain write.
  const copyDiagnostics = async () => {
    const text = call<string>('engine_log_tail')
    try {
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(s => new Blob([s], { type: 'text/plain' })) })]) }
      catch { await navigator.clipboard.writeText(await text) }
      setDiag(d => d.diagnosticsCopied)
    } catch { setDiag(d => d.diagnosticsFailed) }
  }
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
  const re = outcome?.re ?? '' // "B+R", "W+4.5", "0"
  const res = readResult(re) // the caption's card reads the result from RE
  const resignation = re.endsWith('+R'), timeout = re.endsWith('+T'), countingOpen = !!final && !result
  // the count, shown while counting and, once validated, at every cursor position (scored on the final board)
  const end = game.boards.at(-1)!
  const count = counting?.game === game && (countingOpen || (!!re && !resignation && !timeout))
    ? score(end.signMap, counting.dead, { black: end.getCaptures(1), white: end.getCaptures(-1) }, komi, counting.own) : null
  const sideOf = (s: Sign) => count ? s === 1 ? count.black : count.white : null
  const tallyOf = (s: Sign) => { const c = sideOf(s)!; return t.tally(c.territory, c.prisoners, s === -1 ? komi : undefined) }
  // counting: points over the tally; counted: "wins" over points and tally; a draw: the points alone
  const subOf = (s: Sign) => !count || re === '0' ? null : countingOpen ? tallyOf(s) : `${t.points(sideOf(s)!.total)} · ${tallyOf(s)}`
  const stateOf = (s: Sign) => count && (countingOpen || re === '0') ? t.points(sideOf(s)!.total)
    : re ? re[0] === (s === 1 ? 'B' : 'W') ? t.wins : resignation ? t.resigned : timeout ? t.onTime : ''
    : last && !last.vertex && last.sign === s ? t.passed
    : !playing ? ''
    : toPlay === s ? bot?.sign === s ? thinking ? t.thinking : t.waiting : online && online.me !== s ? t.thinking : t.yourMove
    : t.waiting
  // the doors' dots: a challenge awaits my answer (Play), the ritual waits (Learn), an OGS game awaits my move (My games)
  const doorHints = {
    play: challengeRows.some(c => !c.mine) ? t.ogsDotChallenge : null, learn: td.waiting ? t.ritualWaiting : null,
    games: activeRows?.some(r => r.myTurn && r.corr) ? t.ogsDotTurn : null,
  }
  const alert = upd.s === 'available' ? t.updateAvailable(upd.version) : engine.state === 'error' ? failureText(engine.error) : null
  const closeSheet = () => setSheet(null)
  /** The player's own changes in the Game sheet re-propose the handicap (the bot's auto-adjusted level does not). */
  const propose = ({ size = nextSize, ...c }: Partial<Pick<Settings, 'myRank' | 'aiRank' | 'style'>> & { size?: number }) =>
    setSettings(s => { const n = { ...s, ...c }; return { ...n, handicap: proposeHandicap(n.myRank, n.style === 'era' ? MASTER_RANK : n.aiRank, size) } })
  const master = settings.style === 'era' // a Master of an era: the handicap from the gap to 9d
  /** The next game's size changed (the sheet, a game of another size started or opened): its handicap is proposed again. */
  const resize = (n: number) => { if (n !== nextSize) { setNextSize(n); propose({ size: n }) } }
  // Networks opened from Settings closes back to Settings, on its link
  const closeNets = () => setSheet(netsFromSettings.current ? 'settings' : null)
  useEffect(() => { if (sheet === 'atelier') document.getElementById('atelier')?.scrollIntoView({ block: 'start' }) }, [sheet])
  // Apprendre: one row per deck, then Progrès's sections; a new activity appends its own (see Panel above)
  const decks: DeckRow[] = [
    { key: 'exercises', name: t.decks.exercises, phrase: t.deckPhrases.exercises, counts: ex.counts, off: canAnalyze ? undefined : t.tdOff.exercises,
      open: () => { closeSheet(); ex.start({}) } },
    { key: 'tsumego', name: t.tsDeck, phrase: t.tsPhrase, counts: ex.tsCounts, off: canAnalyze ? undefined : t.tdOff.exercises, open: () => { closeSheet(); ex.tsumego() } },
    // the counter's place shows the counting error, the same figure as Progrès
    { key: 'count', name: t.countDeck, phrase: t.countPhrase, counts: null, off: ct.median === null ? undefined : t.countFigure(ct.median), open: () => { closeSheet(); setPanel('count') } },
    { key: 'joseki', name: t.decks.joseki, phrase: t.deckPhrases.joseki, counts: jt.counts ?? null, open: () => { closeSheet(); setPanel('joseki') } },
    { key: 'fuseki', name: t.decks.fuseki, phrase: t.deckPhrases.fuseki, counts: ft.counts ?? null, open: () => { closeSheet(); setPanel('fuseki') } },
    { key: 'classics', name: t.clDeck, phrase: t.clDeckPhrase, counts: null, off: canAnalyze ? cl.deckLine : t.tdOff.exercises, open: () => { closeSheet(); cl.openList() } },
  ]
  const progressSections: ProgressSection[] = [
    { key: 'rank', title: t.rankSection, body: <RankProgress ranks={ranks.p.games} follows={settings.autoAdjust} /> },
    ...ogs.me && !ogs.isGuest() ? [{ key: 'ogs', title: t.ogsRatingSection, body: <OgsRating /> }] : [],
    { key: 'where', title: t.exWhere, side: ex.games.length ? t.exGames(ex.games.length) : '', body: <WhereLost games={ex.games} blocked={ongoing || !!review} work={p => { closeSheet(); ex.work(p, workOpening) }} /> },
    { key: 'count', title: t.countSection, body: <p className="say">{ct.median === null ? t.countNoneYet : t.countMedian(ct.median, ct.n)}</p> },
    { key: 'letter', title: t.letterSection, body: <MonthLetters played={ex.games} ranks={ranks.p.games} /> },
  ]
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
            signMap: ghost ? board.signMap.map((r, y) => r.map((c, x) => (x === ghost.v[0] && y === ghost.v[1] ? 0 : c))) : board.signMap,
            last: ghost ? null : last?.vertex ?? null, pending: ghost, toPlay, coords, sound,
            interactive: removal ? true : countingNow ? !result : review ? lessonPlayable : !game.ended && !locked && humanTurn,
            // ② and ③: what changed hands, until the player explores
            ownership: countingNow ? null : review ? (m && !review.explored ? review.step === 'punish' ? m.lost : review.step === 'better' ? m.kept : null : null)
              : shownOwn?.data ?? null,
            counting: final ? { dead: countingNow!.dead, territory: final.territory }
              : removal ? { dead: ogs.deadOf(board.signMap, removal.removed), territory: board.signMap.map(r => r.map(() => 0 as Sign)) } : null, // OGS scores
            captures: { black: board.getCaptures(1), white: board.getCaptures(-1) }, // the 3D lids: prisoners taken by each
            ...tr.board,
            ...(cands && { marks: cands.flatMap(c => c.v ? [{ v: c.v, label: c.label, tone: tone(c.loss) }] : []) }),
          }}
          onPlay={play}
        >
          <p className="note" aria-live="polite" tabIndex={-1}>
            {message && <span key={message} title={tuned ? `${message} · ${tuned}` : message} className={message === resultLine ? 'res' : undefined}>
              {message === resultLine ? <>
                {/* the result as a score sheet: winner's stone, who and how, the AI's next level; read in that order */}
                {res.winner !== 0 && <span className={`stone ${res.winner === 1 ? 'b' : 'w'}`} aria-hidden="true">{re}</span>}
                <span className="txt"><b>{t.ended(res.winner, res.how, res.points)}{mentorLine && <span className="said"> · {mentorLine}</span>}</b>{' '}
                  <small>{[res.winner !== 0 && t.endedHow(res.how, res.points), note?.(t)].filter(Boolean).join(' · ')}</small></span>
                {aiMoved && <span className="chip">{t.aiLevel}{' '}<b>{bot && <i>{bot.rank} →</i>} {aiMoved}</b></span>}
              </> : <span className="txt">{message}{tuned && <span aria-hidden="true"> · {tuned}</span>}</span>}
              {!anLine && links.map(([id, label, act]) => <button key={id} data-act={id} className="link" onClick={() => { refocus.current = id; act() }}>
                {id === 'review' && message === resultLine && <Icon name="review" />}{label}</button>)}
            </span>}
          </p>
        </Goban>
        <aside className={`card${settings.panelHidden ? ' off' : ''}`}>
          <header className="brand">
            {!settings.panelHidden && <>
              <span className="seal" aria-hidden="true">柾</span>
              <h1>Masame</h1>
              {([['game', 'play', 'plus', null], ['learn', 'learn', 'book', 'D'], ['games', 'games', 'library', 'B'], ['settings', 'settings', 'adjustments', null]] as const).map(([s, d, icon, key]) => {
                const hint = d === 'settings' ? alert : doorHints[d], name = key ? `${t.doors[d]} (${key})` : t.doors[d], label = hint ? `${name} · ${hint}` : name
                return <button key={d} className="door" onClick={openSheet(s)} aria-label={label} title={label}><Icon name={icon} /><span aria-hidden="true">{t.doors[d]}</span>{hint && <i className="dot" />}</button>
              })}
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
              {/* wraps only between its parts, never inside one */}
              <span>{(online ? t.ogsBoard(size, komi, pick(t.rules, online.rules) ?? online.rules) : cl.info ? t.board(cl.info.size, cl.info.komi) : t.board(size, komi)).split(' · ').map(x => x.replace(/ /g, '\u00a0')).join(' · ')}</span>
              <button className="icon sm" onClick={openSheet('share')} aria-label={t.share} title={t.share}><Icon name="share" /></button>
              <button className="icon sm" aria-pressed={sound} onClick={() => setSound(v => !v)} aria-label={t.sound} title={`${t.sound} (M)`}>
                <Icon name={sound ? 'volume' : 'volume-off'} />
              </button>
              <button className="icon sm" aria-pressed={renderer === '3d'} onClick={() => { setSession2d(false); set('renderer', renderer === '3d' ? '2d' : '3d') }}
                aria-label={t.renderToggle} title={renderer === '3d' ? t.render3d : t.render2d}><Icon name={renderer === '3d' ? 'cube' : 'square'} /></button>
              <button className="icon sm" onClick={openSheet('atelier')} aria-label={t.atelier} title={t.atelier}><Icon name="view" /></button>
            </div>
            <div className="body">
              {tr.body ?? <>{cands ? ( // while A is held, the candidates in place of the players (or the review)
                <ul className="jrows" aria-label={t.anFor(toPlay)}>
                  {cands.map((c, i) => <li key={i}><div className={`jrow an ${tone(c.loss)}`}><b>{c.v ? `${c.label} · ${gtp(c.v, size)}` : t.anPass}</b><span>{c.loss ? t.jLoss(c.loss) : t.jBest}</span><span /></div></li>)}
                </ul>
              ) : review ? (
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
                    <p className="state">{t.moment(review.k + 1, review.moments!.length, game.moveNumber(m.at) + 1, m.loss)}</p>
                    {review.moments!.length > 1 && (
                      <Seg label={t.moments} value={review.k} options={review.moments!.map((_, i) => [i, String(i + 1)])} set={k => openMoment(k, 'try')} />
                    )}
                    <Seg label={t.lesson} value={review.step} options={[['try', t.steps.try], ['punish', t.steps.punish], ['better', t.steps.better]]}
                      set={step => openMoment(review.k, step)} />
                    <p className="quiet">{review.step === 'try' ? t.tryHelp(p, s, m.loss) : review.step === 'punish' ? t.punishHelp : t.betterHelp}</p>
                    <p className="quiet">{t.exKept(review.moments!.length)}</p>
                  </>}
                  {rankSide !== 0 && <div className="rv-rank" aria-live="polite">
                    {review.rank === undefined ? <p className="quiet">{t.rankReading(rankSide === mine ? 0 : rankSide)}</p> : review.rank && <>
                      <p className="estimate">{t.rankPlayed(rankSide === mine ? 0 : rankSide, rankName(review.rank.all))}</p>
                      {review.rank.phases.some(x => x !== null) && <p className="quiet">{phaseLine(review.rank.phases)}</p>}
                    </>}
                  </div>}
                </section>
              ) : ([1, -1] as const).map(c => {
                const n = board.getCaptures(c), sub = subOf(c)
                const rank = online ? online.players[c === 1 ? 'black' : 'white'].rank : bot && (c === bot.sign ? !bot.era && bot.rank : settings.myRank)
                return (
                  <div key={c} role="group" aria-label={t.color(c)}
                    className={`pc ${c === 1 ? 'b' : 'w'}${toPlay === c && playing ? ' on' : ''}${thinking && bot?.sign === c ? ' thinking' : ''}`}>
                    <div className="lbl"><span className="nm">{bot ? c === bot.sign ? bot.era ? t.masterOf(bot.era) : t.ai : t.you : (c === 1 ? playerBlack : playerWhite) || t.color(c)}</span>{rank && <span className="rk">{rank}</span>}</div>
                    <div aria-live={countingOpen ? 'polite' : undefined}>
                      <div className="state" aria-live={online ? 'polite' : undefined}>{stateOf(c)}</div>
                      {online?.clock && !result ? <div className="sub"><Clock read={now => ogs.clockOf(online.clock!, c, now, ogs.drift(), online.pausedSince)}
                        period={online.tc?.system === 'byoyomi' ? online.tc.period_time : undefined} /></div>
                        : clock && !result && !sub ? <div className="sub"><Clock read={now => read(clock, c, now)} period={clock.spec.period / 1000} /></div>
                        : sub && <div className="sub">{sub}</div>}
                    </div>
                    <span className="cap" role="img" aria-label={t.captures(n)}>{n}</span>
                    <span className="wm" aria-hidden="true">{c === 1 ? '黒' : '白'}</span>
                  </div>
                )
              })}
              {!review && cta}
              <Timeline g={shown} floor={floor} go={goTo} auto={!!auto} toggleAuto={toggleAuto} live={live} relocate={relocate} />
              {settings.territory && !review && !ongoing && (
                <p className="estimate" aria-live="polite">
                  {!inTauri() || !canAnalyze ? t.territoryNeedsNet : shownOwn ? t.estimate(shownOwn.score) : t.estimating}
                </p>
              )}</>}
            </div>
            <div className="acts">
              {tr.acts ?? (review ? <button className="act" onClick={leaveReview} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button> : <>
                {(final || removal) && !result
                  ? <button className="act accent" onClick={removal ? () => send(() => ogs.acceptRemoved(removal.id, removal.removed)) : validate}><Icon name="hand-stop" />{t.validate}</button>
                  : <button className="act" onClick={() => play(null)} disabled={game.ended || locked || !humanTurn || !!online?.placing} title="P"><Icon name="hand-stop" />{t.pass}</button>}
                {online ? <button className="act" onClick={() => send(() => ogs.requestUndo(online.id, ogs.moveNumber(online)))} disabled={!atEnd || !ogs.canRequestUndo(online)}
                  title={t.ogsUndoHelp}><Icon name="arrow-back-up" />{t.undo}</button>
                  : <button className="act" onClick={undo} disabled={game.cursor === 0 || (!!bot && !!result)} title={shortcut('Z')}><Icon name="arrow-back-up" />{t.undo}</button>}
                {myGame ? myGame.pause?.player
                  ? <button key="resume" className="act" onClick={() => send(() => ogs.resumeGame(myGame.id))} disabled={!ogs.canResume(myGame)}><Icon name="play" />{t.resume}</button>
                  : <button key="pause" className="act" onClick={() => send(() => ogs.pauseGame(myGame.id))} disabled={!ogs.canPause(myGame)}
                    title={myGame.pausesLeft === undefined ? undefined : t.ogsPausesLeft(myGame.pausesLeft)}><Icon name="pause" />{t.ogsPause}</button>
                  : <button className="act" aria-pressed={settings.territory} onClick={() => set('territory', !settings.territory)} disabled={ongoing}
                    title={ongoing ? t.ogsUnavailable : 'T'}><Icon name="sun-low" />{t.territory}</button>}
                {reviewShown ? <button key="review" className={`act${result ? ' accent' : ''}`} onClick={() => startReview(mine)}
                  disabled={!canAnalyze} title={canAnalyze ? undefined : t.reviewNeedsNet}><Icon name="review" />{t.reviewGame}</button>
                  : (bot || online && online.me !== 0) && <button className="act" onClick={resign} disabled={!!result}><Icon name="flag" />{cancellable ? t.ogsCancelGame : t.resign}</button>}
              </>)}
            </div>
          </div>
        </aside>
      </main>

      {sheet === 'game' && (
        <Sheet title={t.doors.play} onClose={closeSheet} opener={opener.current}>
          <section>
            <div className="lab"><span>{t.newGame}</span><span /></div>
            <div className="opts">
              <Seg label={t.size} value={nextSize} options={SIZES.map(n => [n, `${n}×${n}`])} set={resize} />
              <Seg label={t.opponent} value={settings.opponent} options={[['human', t.twoPlayers], ['ai', t.ai], ['ogs', 'OGS']]} set={v => set('opponent', v)} />
              {settings.opponent === 'ogs' ? (
                <OgsSection speed={settings.ogsSpeed} setSpeed={v => set('ogsSpeed', v)}
                  // correspondence: the search is listed in the sheet, and its start told by a notice
                  onFind={() => { if (settings.ogsSpeed === 'correspondence') send(() => void ogs.findMatch(nextSize as ogs.BoardSize, 'correspondence')); else { closeSheet(); find() } }}
                  onSignOut={signOut}
                  onChallenge={challengePlayer} onAccept={accept} onCancelChallenge={cancelSent} onWatch={id => { closeSheet(); resume(id) }} onOpenLink={openLink}
                  onSignedIn={() => { if (online && online.me === 0) follow(online.id) }} />
              ) : <>
              {settings.opponent === 'ai' && (canPlayAI ? <>
                <Seg label={t.yourColor} value={settings.handicap ? 'b' : settings.color} options={[['b', t.black], ['w', t.white], ['r', t.random]]} set={v => set('color', v)}
                  disabled={!!settings.handicap} title={settings.handicap ? t.handicapBlack : undefined} />
                {/* the style first: a Master of an era takes the AI level's place, and sets the handicap below */}
                <div className="field">
                  <span>{t.style}</span>
                  <Seg label={t.style} value={settings.style} options={[['level', t.styleLevel], ['era', t.styleEra]]} set={v => propose({ style: v })} />
                </div>
                {master ? <>
                  <Stepper label={t.era} value={String(settings.era)} step={d => set('era', stepEra(settings.era, -d))} names={[t.earlier, t.later]} />
                  <p className="say">{t.eraHelp}</p>
                </> : <Stepper label={t.aiLevel} value={settings.aiRank} step={d => propose({ aiRank: stepRank(settings.aiRank, d) })} />}
                <Stepper label={t.handicap} value={t.handicapStones(settings.handicap)} step={d => set('handicap', stepHandicap(settings.handicap, -d))} names={[t.fewerStones, t.moreStones]} />
                {settings.handicap > 0 && settings.handicap === proposeHandicap(settings.myRank, master ? MASTER_RANK : settings.aiRank, nextSize)
                  && <p className={master ? 'say' : 'quiet'}>{master ? t.eraHandicap(settings.handicap) : t.handicapProposed}</p>}
                <details className="more">
                  <summary>{t.aiSettings}</summary>
                  <Stepper label={t.myLevel} value={settings.myRank} step={d => { const v = stepRank(settings.myRank, d); propose({ myRank: v, aiRank: v }) }} />
                  <Switch label={t.autoAdjust} on={settings.autoAdjust} toggle={() => set('autoAdjust', !settings.autoAdjust)} title={t.autoAdjustHelp} />
                  <Switch label={t.thinkTime} on={settings.delay} toggle={() => set('delay', !settings.delay)} />
                  <Switch label={t.botResign} on={settings.botResign} toggle={() => set('botResign', !settings.botResign)} />
                  {/* without an analysis network there is no AI to play, so the sheet shows the call to install one instead */}
                  <Switch label={t.mentor} on={settings.mentor} toggle={() => set('mentor', !settings.mentor)} />
                  <p className="say">{t.mentorHelp}</p>
                </details>
              </> : cta)}
              <div className="field">
                <span>{t.clock}</span>
                <Seg label={t.clock} value={settings.clock} set={v => set('clock', v)} options={[['off', t.clockOff, t.clockNone],
                  ...Object.entries(CLOCKS).map(([k, c]) => [k, t.clockShort(c.main / 60_000, c.periods, c.period / 1000), t.clockLong(c.main / 60_000, c.periods, c.period / 1000)] as [ClockSetting, string, string])]} />
              </div>
              <button className="btn accent" onClick={() => { closeSheet(); newGame(nextSize, fromPos ? { from: fromPos } : {}) }} title={shortcut('N')} disabled={settings.opponent === 'ai' && !canPlayAI}>{t.begin}</button>
              </>}
            </div>
          </section>
          {fromPos ? <p className="say">{t.edFrom}</p>
            : <section><button className="share-row" onClick={() => { closeSheet(); ed.start() }} disabled={ongoing || !!review}><span>{t.edOpen}</span></button></section>}
        </Sheet>
      )}

      {(sheet === 'settings' || sheet === 'atelier') && (
        <Sheet title={t.settings} onClose={closeSheet} opener={opener.current} focus={netsFromSettings.current ? '[data-nets]' : undefined}>
          <section>
            <div className="lab"><span>{t.boardSection}</span><span /></div>
            <Switch label={t.coords} k="C" on={coords} toggle={() => setCoords(v => !v)} />
            <Switch label={t.sound} k="M" on={sound} toggle={() => setSound(v => !v)} />
            <div className="row" style={{ cursor: 'default', gap: 16 }}>
              <span>{t.autoplay} <kbd>{t.space}</kbd></span>
              <Seg label={t.autoplay} value={settings.autoplay} options={AUTOPLAY.map(s => [s, t.perMove(s)])} set={v => set('autoplay', v)} />
            </div>
            <Switch label={t.territory} k="T" on={settings.territory} toggle={() => set('territory', !settings.territory)}
              disabled={ongoing} title={ongoing ? t.ogsUnavailable : undefined} />
          </section>

          <section id="atelier">
            <div className="lab"><span>{t.atelier}</span><span /></div>
            <div className="opts">
              <Seg label={t.rendering} value={renderer} options={[['3d', t.render3d], ['2d', t.render2d]]} set={v => { setSession2d(false); set('renderer', v) }} />
              {renderer === '3d' && <>
                <div className="row" style={{ cursor: 'default', gap: 16 }}>
                  <span>{t.view} <kbd>V</kbd></span>
                  <Seg label={t.view} value={settings.camera} options={[['study', t.study], ['contemplation', t.contemplation, t.contemplationHint]]} set={v => set('camera', v)} />
                </div>
                <div className="field">
                  <span>{t.decor}</span>
                  <Seg label={t.decor} value={settings.decor} options={DECORS.map(d => [d, t.decors[d], t.decorHints[d]])} set={v => set('decor', v)} />
                </div>
                <div className="field">
                  <span>{t.light} <kbd>L</kbd></span>
                  <Seg label={t.light} value={settings.light} options={LIGHTS.map(l => [l, t.lights[l], l === 'auto' ? t.lightAutoHint : undefined])} set={v => set('light', v)}
                    disabled={settings.decor === 'lanterne'} title={settings.decor === 'lanterne' ? t.noEffectAtNight : undefined} />
                </div>
                <Switch label={t.highContrast} on={settings.highContrast} toggle={() => set('highContrast', !settings.highContrast)} />
              </>}
            </div>
          </section>

          <section>
            <div className="lab"><span>{t.appSection}</span><span /></div>
            {!isMac && inTauri() && <Switch label={t.fullscreen} k="F11" on={fullscreen} toggle={() => setFullscreen(!fullscreen)} />}
            <div className="row" style={{ cursor: 'default', gap: 16 }}>
              <span>{t.language}</span>
              <Seg label={t.language} value={settings.lang} options={[['fr', 'Français'], ['en', 'English']]} set={v => { setLang(v); setSettings(s => ({ ...s, lang: v, langChosen: true })) }} />
            </div>
            <div className="row" style={{ cursor: 'default' }}>
              <span>{t.engine}</span>
              <button className="link" data-nets onClick={() => { netsFromSettings.current = true; setSheet('nets') }}>{t.networksBtn}</button>
            </div>
            <p className={`engine${engine.state === 'error' ? ' err' : ''}`}>{engineLine}</p>
            {inTauri() && <p className="engine" aria-live="polite">
              <button className="link" onClick={copyDiagnostics}>{t.copyDiagnostics}</button>
              {diag && <> · {diag(t)}</>}
            </p>}
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
            {ogs.me && !ogs.isGuest() && <p className="engine">
              {t.settingsOgs(ogs.me.username)} · <button className="link" onClick={async () => { if (await signOut()) ogs.logout().catch(e => setNote(d => failureText(e, d))) }}>{t.ogsSignOut}</button>
            </p>}
          </section>

          <section>
            <div className="lab"><span>{t.keyboard}</span><span /></div>
            <p className="keys"><kbd>←</kbd><kbd>→</kbd> {t.footer.browse} · <kbd>↑</kbd><kbd>↓</kbd> {t.footer.variations} · <kbd>{t.space}</kbd> {t.footer.autoplay} · <kbd>P</kbd> {t.footer.pass} · <kbd>T</kbd> {t.footer.territory} · <kbd>{shortcut('Z')}</kbd> {t.footer.undo} · <kbd>{shortcut('N')}</kbd> {t.footer.newGame} · <kbd>{shortcut('O')}</kbd> {t.footer.open} · <kbd>{shortcut('S')}</kbd> {t.footer.save} · <kbd>H</kbd> <kbd>{shortcut('\\')}</kbd> {t.footer.panel} · <kbd>J</kbd> {t.footer.joseki} · <kbd>E</kbd> {t.footer.exercises} · <kbd>D</kbd> {t.footer.today} · <kbd>B</kbd> {t.footer.games} · <kbd>A</kbd> {t.footer.candidates} · <kbd>C</kbd> {t.footer.coords} · <kbd>M</kbd> {t.footer.sound}{renderer === '3d' && <> · <kbd>V</kbd> {t.footer.view} · <kbd>L</kbd> {t.footer.light} · <kbd>R</kbd> {t.footer.recentre}</>}{!isMac && <> · <kbd>F11</kbd> {t.footer.fullscreen}</>}</p>
          </section>
        </Sheet>
      )}

      {sheet === 'learn' && (
        <LearnSheet onClose={closeSheet} opener={opener.current} ritual={td.body} decks={decks} blocked={ongoing || !!review} progress={progressSections} />
      )}
      {sheet === 'games' && (
        <GamesSheet onClose={closeSheet} opener={opener.current} onResume={id => { closeSheet(); resume(id) }}
          onOpen={e => { closeSheet(); open(() => library.read(e.id), false, { entry: e }) }} onImport={() => { closeSheet(); open() }}
          onImportOgs={id => { closeSheet(); importGame(id) }} />
      )}
      {sheet === 'share' && (
        <ShareSheet onClose={closeSheet} opener={opener.current} onSave={() => { closeSheet(); save() }} onPostcard={() => { closeSheet(); postcard() }}
          onKifu={() => setSheet('kifu')} ogsId={online?.id} />
      )}

      {sheet === 'kifu' && <Kifu game={game} onClose={closeSheet}
        ranks={([1, -1] as const).map(c => game.root.data[c === 1 ? 'BR' : 'WR']?.[0] || (bot?.sign === c ? bot.rank : '')) as [string, string]}
        source={game.root.data.EV?.[0] || (online ? `online-go.com/game/${online.id}` : bot ? t.kifuVsAi : 'Masame')} />}
      {cl.sheet}
      {sheet === 'nets' && <Networks nets={nets} progress={progress} onClose={closeNets} onChanged={refreshNets} opener={opener.current} />}
    </>
  )
}
