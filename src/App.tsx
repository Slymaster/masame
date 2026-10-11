import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { BoardView } from './board/BoardView'
import type { Board3D, Board3DOptions, Board3DState, FallbackReason, TimeMode } from './board3d/Board3D'
import { rng } from './board/noise'
import { adjustRank, clampRank, decide, DEFAULT_RANK, humanProfile, stepRank } from './bot'
import { confirmDiscard, openSgfFile, saveSgfFile } from './files'
import { Game, type Sign, type Vertex } from './game'
import { analyze, call, inTauri, on, type Analysis, type EngineStatus, type NetState, type Progress } from './katago'
import { Networks } from './Networks'
import { noDead, score, suggestDead, toggleDead, type Dead } from './scoring'
import { loadSgf, resignResult, saveSgf, scoreResult } from './sgf'
import { failureText, LocalizedError, pick, setLang, storedLang, t, type Lang, type Msg } from './i18n'
import { DECORS, type Decor } from './board3d/decors'
import { isMac, shortcut } from './platform'

const SIZES = [9, 13, 19]
const HUMAN_BYTES = 99_066_230
const BOT_VISITS = 60, TERRITORY_VISITS = 150, FINAL_VISITS = 300
const BOT_ATTEMPTS = 3 // a failed query (engine restarting on another net, crash) is retried after 1 s, then 2 s
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const random = rng(Date.now())

type Renderer = '3d' | '2d'
const LIGHTS: TimeMode[] = ['auto', 'morning', 'afternoon', 'evening']
interface Settings {
  lang: Lang; opponent: 'human' | 'ai'; color: 'b' | 'w' | 'r'; myRank: string; aiRank: string; autoAdjust: boolean; delay: boolean; territory: boolean
  renderer: Renderer; camera: Board3DOptions['camera']; light: TimeMode; highContrast: boolean; decor: Decor
  langChosen: boolean; panelHidden: boolean
}
const SETTINGS_KEY = 'baduk.settings'
function loadSettings(): Settings {
  const d: Settings = {
    lang: 'en', opponent: 'ai', color: 'b', myRank: DEFAULT_RANK, aiRank: DEFAULT_RANK, autoAdjust: true, delay: true, territory: false,
    renderer: '3d', camera: 'study', light: 'auto', highContrast: false, decor: 'atelier', langChosen: false, panelHidden: false,
  }
  let j: Partial<Settings> = {}
  try { j = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') ?? {} } catch { /* private mode or garbage: defaults */ }
  const s = { ...d, ...j }
  return {
    ...s, lang: storedLang(j), langChosen: j.langChosen === true, myRank: clampRank(s.myRank), aiRank: clampRank(s.aiRank),
    renderer: j.renderer === '2d' || j.renderer === '3d' ? j.renderer : webgl2() ? '3d' : '2d',
    camera: s.camera === 'contemplation' ? 'contemplation' : 'study', light: LIGHTS.includes(s.light) ? s.light : 'auto', highContrast: s.highContrast === true,
    decor: DECORS.includes(s.decor) ? s.decor : 'atelier', panelHidden: s.panelHidden === true,
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
type View = { update(s: Board3DState): void; drop(v: Vertex, c: Sign): void; destroy(): void }

function Goban({ state, onPlay, view, mode, options, thinking, onFallback }: {
  state: Board3DState; onPlay: (v: Vertex) => boolean; view: React.RefObject<View | null>
  mode: Renderer; options: Board3DOptions; thinking: boolean; onFallback: (r: FallbackReason) => void
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
        mount(b, r => b.resize(r.width, r.height))
      }, () => live && latest.current.onFallback('webgl2'))
    }
    return () => { live = false; ro?.disconnect(); v?.destroy(); view.current = three.current = null }
  }, [mode, view])
  useEffect(() => { view.current?.update(state); if (import.meta.env.DEV) Object.assign(window, { __badukState: state }) })
  useEffect(() => three.current?.setOptions(options), [options.camera, options.time, options.highContrast, options.decor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => three.current?.setThinking(thinking), [thinking])
  // a fresh canvas per renderer: one canvas can't hold both a 2D and a WebGL context
  return <div className="board-wrap" ref={wrap}><canvas key={mode} ref={canvas} aria-label={t.boardLabel(state.signMap.length)} /></div>
}

/** State holding a Msg, rendered at display time (a bare function given to useState's setter would run as an updater). */
function useMsg() {
  const [m, set] = useState<Msg | null>(null)
  return [m, useCallback((v: Msg | null) => set(() => v), [])] as const
}

function Switch({ label, k, on, toggle }: { label: string; k?: string; on: boolean; toggle: () => void }) {
  return (
    <div className="row" onClick={toggle}>
      <span>{label} {k && <kbd>{k}</kbd>}</span>
      <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={e => { e.stopPropagation(); toggle() }} />
    </div>
  )
}

function Seg<T extends string | number>({ label, value, options, set, disabled, title }: {
  label: string; value: T; options: [T, string, string?][]; set: (v: T) => void; disabled?: boolean; title?: string
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} title={title}>
      {options.map(([v, l, tip]) => <button key={v} role="radio" aria-checked={value === v} disabled={disabled} title={tip} onClick={() => set(v)}>{l}</button>)}
    </div>
  )
}

function Stepper({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <div className="row stepper">
      <span>{label}</span>
      <span className="step">
        <button onClick={() => set(stepRank(value, -1))} aria-label={t.weaker(label)}>‹</button>
        <output aria-live="polite">{value}</output>
        <button onClick={() => set(stepRank(value, 1))} aria-label={t.stronger(label)}>›</button>
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
  const [session2d, setSession2d] = useState(false) // 2D after a WebGL context loss, for this session only
  const renderer: Renderer = session2d ? '2d' : settings.renderer
  // counting phase after two passes: which stones are dead (suggested by KataGo, toggled by the player)
  const [counting, setCounting] = useState<{ game: Game; dead: Dead } | null>(null)

  const [engine, setEngine] = useState<EngineStatus>({ state: 'stopped' })
  const [nets, setNets] = useState<NetState | null>(null)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [showNets, setShowNets] = useState(false)
  const [own, setOwn] = useState<{ game: Game; data: number[] | null; score: number } | null>(null)

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

  const changed = () => { setNote(null); setBotError(null); rerender() }
  const humanTurn = !bot || game.toPlay !== bot.sign
  const atEnd = game.cursor === game.moves.length
  const countingNow = counting?.game === game && game.ended && atEnd ? counting : null
  const locked = !!result && (!!bot || atEnd) // two players may branch off a validated game from an earlier move
  const play = (v: Vertex | null) => {
    if (countingNow) {
      if (v && !result) setCounting({ game, dead: toggleDead(game.board.signMap, countingNow.dead, v) })
      return false
    }
    if (locked || !humanTurn) return false
    const r = game.play(v)
    if (r === 'ok') { setDirty(true); setCounting(null); if (!bot) setResult(null); changed() }
    else if (pick(t.refused, r)) setNote(d => pick(d.refused, r)!)
    return r === 'ok'
  }
  const undo = () => {
    if (bot && result) return
    let undone = false
    // against the bot, take back to the player's last move
    while (game.undo()) { undone = true; if (!bot || game.cursor === 0 || game.toPlay !== bot.sign) break }
    if (undone) { winrates.current = winrates.current.slice(0, Math.ceil(game.cursor / 2)); setDirty(true); setCounting(null); changed() }
    if (undone && !bot) setResult(null) // two players: counted again if the game ends again (Game.undo dropped the RE)
  }
  const goTo = (i: number) => { if (i !== game.cursor) { game.goTo(i); changed() } }
  const start = (g: Game, b: typeof bot) => {
    setGame(g); setBot(b); setResult(null); setNote(null); setBotError(null); setDirty(false); setOwn(null); setCounting(null); winrates.current = []
  }
  const newGame = async (size = nextSize) => {
    if (dirty && !(await confirmDiscard())) return
    setNextSize(size)
    if (settings.opponent === 'ai' && canPlayAI) {
      const me: Sign = settings.color === 'b' ? 1 : settings.color === 'w' ? -1 : random() < 0.5 ? 1 : -1
      const rank = settings.aiRank, name = t.botName(rank)
      start(new Game({ size, playerBlack: me === 1 ? '' : name, playerWhite: me === 1 ? name : '' }), { sign: -me as Sign, rank })
    } else start(new Game({ size }), null)
  }
  const open = async () => {
    try {
      const text = await openSgfFile()
      if (text === null) return
      const g = loadSgf(text)
      if (dirty && !(await confirmDiscard())) return
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
  const resign = () => {
    if (!bot || result) return
    finish(d => d.resigns(-bot.sign), true, resignResult(bot.sign))
  }
  const final = countingNow && score(game.board.signMap, countingNow.dead, { black: game.board.getCaptures(1), white: game.board.getCaptures(-1) }, game.info.komi)
  const validate = () => {
    if (!final || result) return
    finish(d => d.score(final.lead), bot && final.lead !== 0 ? (final.lead > 0) === (bot.sign === 1) : null, scoreResult(final.lead))
  }

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
      setDirty(true); changed()
    }).catch(e => live && setBotError(d => d.botFailed(failureText(e, d)))).finally(() => live && setThinking(false))
    return () => { live = false; setThinking(false) }
  }, [botTurn, ver, game, botRetry]) // eslint-disable-line react-hooks/exhaustive-deps

  // Two passes: counting. KataGo's ownership suggests the dead stones (without an engine, none are suggested);
  // the player corrects them, then validates a Japanese count (territory + prisoners + komi).
  useEffect(() => {
    if (!game.ended || !atEnd || result || counting) return
    let live = true
    const enter = (own: number[] | null) => {
      if (live) setCounting({ game, dead: own ? suggestDead(game.board.signMap, own) : noDead(game.board.signMap) })
    }
    if (!canAnalyze) enter(null)
    else analyze(game, { maxVisits: FINAL_VISITS, includeOwnership: true }).then(a => enter(a.ownership), () => enter(null))
    return () => { live = false }
  }, [game.ended, atEnd, ver, game, canAnalyze, counting, result])

  // "Ombre et lumière": ownership of the displayed position, debounced, kept until the next estimate arrives.
  useEffect(() => {
    if (!settings.territory || !canAnalyze) return
    let live = true
    const t = setTimeout(() => {
      analyze(game, { maxVisits: TERRITORY_VISITS, includeOwnership: true })
        .then(a => live && setOwn({ game, data: a.ownership, score: a.scoreLead }), e => live && setNote(d => failureText(e, d)))
    }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [settings.territory, ver, game, canAnalyze])

  // ⌘/Ctrl commands, shared by the keyboard and the macOS menu bar (whose items emit "menu" with these ids)
  const togglePanel = () => set('panelHidden', !settings.panelHidden)
  const commands: Record<string, () => void> = { undo, new: () => newGame(), open, save, panel: togglePanel }
  const blocked = (target: EventTarget | null) => target instanceof HTMLInputElement || showNets
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
            arrowleft: () => goTo(game.cursor - 1), arrowright: () => goTo(game.cursor + 1),
            home: () => goTo(0), end: () => goTo(game.moves.length),
            p: () => play(null), c: () => setCoords(v => !v), m: () => setSound(v => !v),
            t: () => set('territory', !settings.territory), h: togglePanel,
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
  const botName = bot ? t.botName(bot.rank) : '' // in the current language (the SGF gets the one at save time)
  const board = game.board, total = game.moves.length, toPlay = game.toPlay, last = game.lastMove
  const shownOwn = settings.territory && own?.game === game ? own : null
  const message = result ? [result(t), note?.(t)].filter(Boolean).join(' ')
    : countingNow ? t.countingHelp
    : game.ended ? t.countingWait
    : (botError ?? note)?.(t) ?? (last && !last.vertex ? t.passes(last.sign) : null)
  const humanNet = nets?.installed.find(i => i.name === nets.human)
  const engineLine = !inTauri() ? t.engineInAppOnly
    : engine.state === 'error' ? failureText(engine.error)
    : engine.state === 'starting' ? t.engineStarting
    : engine.state === 'tuning' ? t.engineTuning
    : engine.state === 'warming' ? t.engineWarming
    : !canAnalyze ? t.noAnalysisNet
    : `${engine.state === 'ready' ? t.engineReady : t.engineIdle} · ${pick(t.labels, nets?.activeKey ?? '') ?? nets?.active}`

  return (
    <>
      {isMac && <div className="titlebar" data-tauri-drag-region />}
      <main className="stage">
        <Goban
          view={view}
          mode={renderer}
          options={{ camera: settings.camera, time: settings.light, highContrast: settings.highContrast, decor: settings.decor }}
          thinking={thinking}
          onFallback={r => { if (r === 'context-lost') setSession2d(true); else set('renderer', '2d'); setNote(d => d.fellBack) }}
          state={{
            signMap: board.signMap, last: last?.vertex ?? null, toPlay, coords, sound,
            interactive: countingNow ? !result : !game.ended && !locked && humanTurn,
            ownership: countingNow ? null : shownOwn?.data ?? null,
            counting: final ? { dead: countingNow!.dead, territory: final.territory } : null,
            captures: { black: board.getCaptures(1), white: board.getCaptures(-1) }, // the 3D lids: prisoners taken by each
          }}
          onPlay={play}
        />
        <button className="panel-toggle" onClick={togglePanel} aria-expanded={!settings.panelHidden} aria-controls="panel"
          aria-label={settings.panelHidden ? t.showPanel : t.hidePanel} title={`${settings.panelHidden ? t.showPanel : t.hidePanel} (H)`}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="2" /><path d="M10 2.5v11" /></svg>
        </button>
        {/* hidden panel: only whose turn it is (breathing while the bot thinks), next to the toggle */}
        {settings.panelHidden && !game.ended && !result && (
          <i className={`turn st ${toPlay === 1 ? 'b' : 'w'}${thinking ? ' thinking' : ''}`} role="img" aria-label={t.color(toPlay)} />
        )}
        <aside className="panel" id="panel" hidden={settings.panelHidden}>
          <header>
            <div className="eyebrow"><i className="mark" />{t.tagline}</div>
            <h1 className="title">Masame <span className="jp">柾目</span></h1>
            <div className="sub">{t.board(size, komi)}</div>
          </header>

          <section>
            <div className="lab">
              <span>{t.game}</span>
              <span>{t.moveOf(game.cursor, total)}</span>
            </div>
            {([[1, bot?.sign === 1 ? botName : playerBlack], [-1, bot?.sign === -1 ? botName : playerWhite]] as const).map(([sign, name]) => (
              <div key={sign} className={`pl${toPlay === sign && !game.ended && !result ? ' on' : ''}${thinking && bot?.sign === sign ? ' thinking' : ''}`}>
                <i className={`st ${sign === 1 ? 'b' : 'w'}`} />
                <span className="nm">{name || t.color(sign)}{name && <em> · {t.color(sign)}</em>}</span>
                <span className="cp">{t.captures(board.getCaptures(sign))}</span>
              </div>
            ))}
            <p className="note" aria-live="polite">
              {message}
              {botError && !result && <> <button className="link" onClick={retryBot}>{t.retry}</button></>}
            </p>
            {final && (
              <p className="estimate" aria-live="polite">
                {t.side(1, final.black.total, final.black.territory, final.black.prisoners)}<br />
                {t.side(-1, final.white.total, final.white.territory, final.white.prisoners, komi)}
              </p>
            )}
            <div className="nav" aria-label={t.history}>
              <button onClick={() => goTo(0)} disabled={game.cursor === 0} aria-label={t.start} title={`${t.start} (Home)`}>⇤</button>
              <button onClick={() => goTo(game.cursor - 1)} disabled={game.cursor === 0} aria-label={t.prev} title={`${t.prev} (←)`}>←</button>
              <button onClick={() => goTo(game.cursor + 1)} disabled={game.cursor === total} aria-label={t.next} title={`${t.next} (→)`}>→</button>
              <button onClick={() => goTo(total)} disabled={game.cursor === total} aria-label={t.end} title={`${t.end} (End)`}>⇥</button>
            </div>
          </section>

          <div className="acts">
            {final && !result
              ? <button className="btn accent" onClick={validate}>{t.validate}</button>
              : <button className="btn" onClick={() => play(null)} disabled={game.ended || locked || !humanTurn} title="P">{t.pass}</button>}
            <button className="btn" onClick={undo} disabled={game.cursor === 0 || (!!bot && !!result)} title={shortcut('Z')}>{t.undo}</button>
            <button className="btn" onClick={open} title={shortcut('O')}>{t.open}</button>
            <button className="btn" onClick={save} title={shortcut('S')}>{t.save}</button>
            {bot && <button className="btn" onClick={resign} disabled={!!result}>{t.resign}</button>}
          </div>

          <section>
            <div className="lab"><span>{t.newGame}</span><span /></div>
            <div className="opts">
              <Seg label={t.size} value={nextSize} options={SIZES.map(n => [n, `${n}×${n}`])} set={setNextSize} />
              <Seg label={t.opponent} value={settings.opponent} options={[['human', t.twoPlayers], ['ai', t.ai]]} set={v => set('opponent', v)} />
              {settings.opponent === 'ai' && (canPlayAI ? <>
                <Seg label={t.yourColor} value={settings.color} options={[['b', t.black], ['w', t.white], ['r', t.random]]} set={v => set('color', v)} />
                <Stepper label={t.aiLevel} value={settings.aiRank} set={v => set('aiRank', v)} />
                <details className="more">
                  <summary>{t.aiSettings}</summary>
                  <Stepper label={t.myLevel} value={settings.myRank} set={v => setSettings(s => ({ ...s, myRank: v, aiRank: v }))} />
                  <Switch label={t.autoAdjust} on={settings.autoAdjust} toggle={() => set('autoAdjust', !settings.autoAdjust)} />
                  <Switch label={t.thinkTime} on={settings.delay} toggle={() => set('delay', !settings.delay)} />
                </details>
              </> : (
                <div className="cta">
                  <p>{!inTauri() ? t.aiOnlyInApp : t.aiNeeds(humanNet?.complete ? null : t.mb(HUMAN_BYTES), !canAnalyze)}</p>
                  {inTauri() && <button className="btn" onClick={() => setShowNets(true)}>{t.openNetworks}</button>}
                </div>
              ))}
              <button className="btn accent" onClick={() => newGame()} title={shortcut('N')} disabled={settings.opponent === 'ai' && !canPlayAI}>{t.begin}</button>
            </div>
          </section>

          <section>
            <div className="lab"><span>{t.display}</span><span /></div>
            <Switch label={t.coords} k="C" on={coords} toggle={() => setCoords(v => !v)} />
            <Switch label={t.sound} k="M" on={sound} toggle={() => setSound(v => !v)} />
            <Switch label={t.territory} k="T" on={settings.territory} toggle={() => set('territory', !settings.territory)} />
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
            <div className="row" style={{ cursor: 'default', gap: 16 }}>
              <span>{t.language}</span>
              <Seg label={t.language} value={settings.lang} options={[['fr', 'Français'], ['en', 'English']]} set={v => { setLang(v); setSettings(s => ({ ...s, lang: v, langChosen: true })) }} />
            </div>
            {settings.territory && (
              <p className="estimate" aria-live="polite">
                {!inTauri() || !canAnalyze ? t.territoryNeedsNet : shownOwn ? t.estimate(shownOwn.score) : t.estimating}
              </p>
            )}
          </section>

          <section>
            <div className="lab"><span>{t.engine}</span><button className="link" onClick={() => setShowNets(true)}>{t.networksBtn}</button></div>
            <p className={`engine${engine.state === 'error' ? ' err' : ''}`}>{engineLine}</p>
          </section>

          <footer className="foot"><kbd>←</kbd><kbd>→</kbd> {t.footer.browse} · <kbd>P</kbd> {t.footer.pass} · <kbd>T</kbd> {t.footer.territory} · <kbd>{shortcut('Z')}</kbd> {t.footer.undo} · <kbd>{shortcut('N')}</kbd> {t.footer.newGame} · <kbd>H</kbd> {t.footer.panel}</footer>
        </aside>
      </main>
      {showNets && <Networks nets={nets} progress={progress} onClose={() => setShowNets(false)} onChanged={refreshNets} />}
    </>
  )
}
