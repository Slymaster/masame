// The joseki trainer: Explore, Practise and Programme panels, which borrow the board and the card while open. The same
// hook is the fuseki trainer (book 'fuseki': Explore and Practise only, its own progress), each its own takeover.
// App keeps its game untouched underneath; its play(), bot turn and Undo defer to the trainer while it is open.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Mark } from '../board/BoardView'
import { askFirst, saveSgfFile } from '../files'
import type { Move, Sign, Vertex } from '../game'
import { failureText, t } from '../i18n'
import { Icon } from '../Icon'
import { note as journal } from '../journal'
import { gtp } from '../katago'
import { Seg } from '../Seg'
import { deckStep } from '../today/ritual'
import { loadJoseki, nearestProfile, reach, TAG, validate, type Book, type JosekiDb } from './db'
import { review } from './fsrs'
import {
  accepted, answer, contextOf, continuation, counts, exploreOf, focus, isTenuki as tenukiIn, nextCard, node, pathTo, position, programme, randomOrient, reply,
  shown as shownIn, shownAt, startLine, storedAt, tone, walk, type Line, type Orient, type Path,
} from './practice'
import { FUSEKI_KEY, KEY, load, NEW_PER_DAY, record, reset, save, today, type Stored } from './store'
import { N, point } from './sym'

const LEVELS = ['20k', '15k', '10k', '5k', '1d', '5d']
const LENS = ['20k', '5k', '1d', 'pro']
const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'
const REPLY_MS = 550, REPLAY_MS = 650
type Tab = 'explore' | 'practise' | 'programme'
type Link = [string, string, () => void]

/** The real data, or the committed fixture while developing without it (never shipped as the product data). */
const loadData = (book: Book) => loadJoseki(book).catch(e => import.meta.env.DEV
  ? (book === 'fuseki' ? import('./fuseki-fixture.json') : import('./fixture.json')).then(m => {
    console.warn(`${book}: using the fixture`, e)
    const d = validate(structuredClone(m.default))
    return book === 'fuseki' ? { ...d, family: book } : d
  })
  : Promise.reject(e))
/** Who plays move `ply` (counted after the context). */
const signOf = (o: Orient, ply: number, context: string[]) => (((context.length + ply) % 2 ? -1 : 1) * (o.swap ? -1 : 1)) as Sign

export function useJoseki({ book = 'joseki', setBook, view, open, preload, setOpen, rank, setRank, blocked, playFrom }: {
  book?: Book; setBook?: (b: Book) => void // the family switch: opens the other book's takeover
  view: RefObject<{ drop(v: Vertex, c: Sign): void } | null>; open: boolean; preload: boolean; setOpen: (o: boolean) => void
  rank: string; setRank: (r: string) => void; blocked: boolean; playFrom: (moves: Move[]) => Promise<boolean>
}) {
  const fuseki = book === 'fuseki', key = fuseki ? FUSEKI_KEY : KEY
  const T = fuseki
    ? { title: t.fuseki, loading: t.fLoading, failed: t.fFailed, root: t.fFirst, exploreNote: t.fExploreNote, context: t.fContext, help: t.fPractiseHelp, wrong: t.fWrong, resetAsk: t.fResetAsk, fileName: t.fFileName, notInBook: t.fNotInBook, askPunish: t.fAskPunish }
    : { title: t.joseki, loading: t.jLoading, failed: t.jFailed, root: t.jCorner, exploreNote: t.jExploreNote, context: t.jContext, help: t.jPractiseHelp, wrong: t.jWrong, resetAsk: t.jResetAsk, fileName: t.jFileName, notInBook: t.jNotInBook, askPunish: t.jAskPunish }
  const [tab, setTab] = useState<Tab>('explore')
  const [db, setDb] = useState<JosekiDb | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [ex, setEx] = useState<{ path: Path; line: boolean }>({ path: { root: 0, picks: [] }, line: false })
  const [line, setLine] = useState<Line | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [store, setStore] = useState<Stored>(() => load(localStorage, key))
  const [say, setSay] = useState<string | null>(null) // a one-off note (not in the book, exported)
  const loaded = useRef(store)
  useEffect(() => { if (store !== loaded.current) save(store, localStorage, key) }, [store]) // written on real changes only, never at launch

  useEffect(() => {
    if (!(open || preload) || db) return
    let live = true
    setError(null)
    loadData(book).then(d => live && setDb(d), e => live && setError(e))
    return () => { live = false }
  }, [open, preload, db])
  useEffect(() => { if (blocked) setOpen(false) }, [blocked])

  const R = useMemo(() => db && reach(db), [db])
  const ctx = db ? contextOf(db) : [], shown = (ms: string[], o: Orient) => shownIn(ms, o, ctx), isTenuki = (m: string) => !!db && tenukiIn(db, m)
  const p = db ? nearestProfile(db.profiles, rank) : 0

  // the opponent's answer, then any replayed line (punishment, continuation), one stone at a time
  useEffect(() => {
    if (!open || !db || !line || (line.phase !== 'reply' && !replaying)) return
    const id = setTimeout(() => {
      if (line.phase === 'reply') {
        const next = reply(db, line, p, Math.random), m = shown(walk(db, next.path).moves, line.o).at(-1)!
        view.current?.drop(m.vertex!, m.sign)
        setLine(next)
      } else if (line.more.length) {
        const extra = [...line.extra, line.more[0]], m = shown([...walk(db, line.path).moves, ...extra], line.o).at(-1)!
        view.current?.drop(m.vertex!, m.sign)
        setLine({ ...line, extra, more: line.more.slice(1) })
      } else setReplaying(false)
    }, line.phase === 'reply' ? REPLY_MS : REPLAY_MS)
    return () => clearTimeout(id)
  }, [open, db, line, replaying, p, view])

  const now = Date.now(), fresh = store.p.day === today(now) ? store.p.fresh : 0
  const newLine = () => {
    if (!db || !R) return
    setReplaying(false); setSay(null)
    const n = nextCard(db, R, p, store.p.cards, fresh, now, fuseki ? Math.random() < 0.5 ? 0 : 1 : undefined)
    setLine(n === null ? null : startLine(db, pathTo(db, R, p, n), randomOrient(book)))
    if (n === null) setSay(t.jDone)
  }
  const toggle = () => { if (!blocked) { setOpen(!open); setSay(null) } }
  const close = () => setOpen(false)
  /** The daily ritual's step (and Travailler › Opening): the Practise tab, a line started at once, or as soon as the book is loaded. */
  const [queued, setQueued] = useState(false)
  const practise = () => { setTab('practise'); if (db) newLine(); else setQueued(true) }
  useEffect(() => { if (queued && db && R) { setQueued(false); newLine() } }, [queued, db, R]) // eslint-disable-line react-hooks/exhaustive-deps
  const left = db && counts(db, store.p.cards, fresh, now), todayStep = left && deckStep(store.p.cards, left.due + left.fresh, now) // null until loaded
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null, today: todayStep, practise, counts: left, failed: !!error }
  if (!open) return none
  // the game's own keys are muted while the trainer has the board (Space still presses a focused button)
  const muted: Record<string, (() => void) | undefined> = { escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {} }
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  if (!db || !R) {
    const note = error ? T.failed(failureText(error)) : T.loading
    // the family switch stays, so a missing book is never a dead end
    return { ...none, acts, note, body: <section className="rv jt">{setBook && <Seg label={t.fFamily} value={book} options={[['joseki', t.joseki], ['fuseki', t.fuseki]]} set={setBook} />}<p className={error ? 'say' : 'estimate'}>{note}</p></section>, keys: muted }
  }

  const lens = db.profiles[p]
  const pct = (f: number) => t.percent(f)

  // ---------- Explore ----------
  const EXPLORE = exploreOf(db)
  const goEx = (path: Path) => { setEx({ path, line: false }); setSay(null) }
  const exW = walk(db, ex.path), exNode = db.nodes[node(exW)], exEdges = exNode.e
  const exLetters = new Map<number, string>() // edge index → its marker letter
  // mirror twins (two moves, one position up to symmetry) share one child: one row, one letter, their frequencies summed
  const head = (i: number) => exEdges.findIndex(e => e[1] === exEdges[i][1]), heads = exEdges.flatMap((_, i) => head(i) === i ? [i] : [])
  const freqOf = (i: number, q: number) => exEdges.reduce((a, e) => a + (e[1] === exEdges[i][1] ? e[3][q] : 0), 0)
  let nLetters = 0
  exEdges.forEach((e, i) => { if (!isTenuki(e[0])) exLetters.set(i, head(i) === i ? LETTERS[nLetters++] ?? '·' : exLetters.get(head(i))!) })
  const into = exW.nodes.length > 1 ? db.nodes[exW.nodes.at(-2)!].e[ex.path.picks.at(-1)!] : null // the edge that led here
  const exLine = !exEdges.length || (into && into[2] > 10) ? continuation(db, node(exW), exW.frames.at(-1)!) : []
  const tenukiEdge = exEdges.findIndex(e => isTenuki(e[0]))
  const proLocal = exEdges.reduce((a, e) => a + (isTenuki(e[0]) ? 0 : e[3][db.profiles.indexOf('pro')] ?? 0), 0) / 100
  // settled alone fires early in this context (the neighbours are the approacher's): complete = the tree's end, or settled and pros leave
  const complete = exEdges.length > 0 && (exEdges.every(e => !db.nodes[e[1]].e.length) || (exNode.s === 1 && proLocal < 0.3))
  const frequent = heads.reduce((b, i) => b < 0 || freqOf(i, p) > freqOf(b, p) ? i : b, -1)
  const exMoves = [...exW.moves, ...ex.line ? exLine : []]
  const back = () => ex.path.picks.length && goEx({ ...ex.path, picks: ex.path.picks.slice(0, -1) })
  const down = (i: number) => {
    const v = shownAt(exW, EXPLORE, exEdges[i][0])
    view.current?.drop(v, signOf(EXPLORE, exW.moves.length, ctx))
    goEx({ ...ex.path, picks: [...ex.path.picks, i] })
  }
  const moveName = (i: number) => isTenuki(exEdges[i][0]) ? t.jTenuki : `${exLetters.get(i)} · ${gtp(shownAt(exW, EXPLORE, exEdges[i][0]), N)}`
  const tags = (bits: number) => (Object.keys(TAG) as (keyof typeof TAG)[]).filter(k => bits & TAG[k]).map(k => t.jTags[k]).join(' · ')
  const loss = (x10: number) => x10 ? t.jLoss(x10 / 10) : t.jBest

  // ---------- Practise ----------
  const fromHere = () => { setTab('practise'); setReplaying(false); setSay(null); setLine(startLine(db, ex.path, randomOrient(book))) }
  const graded = (l: Line) => {
    const c = l.last?.card
    if (c && (store.p.cards[c] || fresh < NEW_PER_DAY)) setStore(s => ({ ...s, p: record(s.p, c, review(s.p.cards[c], l.last!.rating, Date.now())) }))
    if (l.last) journal(book, l.last.rating === 3, c ?? undefined)
    setLine(l)
  }
  const lw = line && walk(db, line.path), ln = lw && db.nodes[node(lw)]
  const toPlayLine = line ? signOf(line.o, lw!.moves.length, ctx) : 1
  const answerTenuki = () => { if (line?.phase === 'ask') graded(answer(db, line, 'tenuki')) }
  const lineMarks: Mark[] = line?.phase === 'wrong' && ln!.e.length
    ? (() => { const kids: number[] = [] // as in Explore: mirror twins (same child) share one letter
        return accepted(db, node(lw!)).filter(i => !isTenuki(ln!.e[i][0])).map(i => {
          const c = ln!.e[i][1], k = kids.includes(c) ? kids.indexOf(c) : kids.push(c) - 1
          return { v: shownAt(lw!, line.o, ln!.e[i][0]), label: LETTERS[k] ?? '·', tone: tone(ln!.e[i][2] / 10) }
        }) })()
    : []
  const progress = counts(db, store.p.cards, fresh, now)

  // ---------- the board, the note and its links ----------
  const practising = tab === 'practise' && !!line
  const o = practising ? line!.o : EXPLORE
  const moves = shown(practising ? [...lw!.moves, ...line!.extra] : exMoves, o), b = position(moves)
  const board: Partial<Board3DState> = {
    signMap: b.signMap, last: moves.at(-1)!.vertex, toPlay: -moves.at(-1)!.sign as Sign, ownership: null, counting: null,
    captures: { black: b.getCaptures(1), white: b.getCaptures(-1) }, focus: focus(db, o),
    interactive: practising ? line!.phase === 'ask' && !replaying : tab === 'explore' && !ex.line,
    marks: practising ? lineMarks : tab === 'explore' && !ex.line
      ? [...exLetters].map(([i, label]) => ({ v: shownAt(exW, EXPLORE, exEdges[i][0]), label, tone: tone(exEdges[i][2] / 10) })) : [],
  }
  const play = (v: Vertex | null) => {
    if (!v || b.get(v)) return false
    if (practising) {
      if (line!.phase !== 'ask' || replaying) return false
      graded(answer(db, line!, v)); setSay(null)
      return true
    }
    if (tab !== 'explore' || ex.line) return false
    const i = exEdges.findIndex(e => e[0] === storedAt(exW, EXPLORE, v))
    if (i < 0) { setSay(T.notInBook); return false }
    goEx({ ...ex.path, picks: [...ex.path.picks, i] })
    return true
  }
  const last = line?.last
  // the tree keeps one tenuki stone, which may land in another corner of a turned board: say so
  const away = practising && line!.phase !== 'wrong' && isTenuki(lw!.nodes.length > 1 ? db.nodes[lw!.nodes.at(-2)!].e[line!.path.picks.at(-1)!][0] : 'pd')
  const lineNote = !line ? null
    : away && line.phase === 'ask' ? `${t.jElsewhere}${t.jAsk(toPlayLine)}`
    : line.phase === 'ask' ? line.dev !== null ? T.askPunish(line.dev) : `${last ? last.rating === 3 ? t.jGood : t.jHard : ''}${t.jAsk(toPlayLine)}`
    : line.phase === 'reply' ? last?.rating === 3 ? t.jGood : t.jHard
    : line.phase === 'wrong' ? ln!.e.length ? lineMarks.length ? T.wrong : t.jWrongTenuki : t.jMissedPunish
    : `${away ? t.jElsewhere : ''}${last ? last.rating === 1 ? '' : line.dev !== null ? `${t.found} ` : t.jGood : ''}${t.jLineEnd}`
  const note = say ?? (tab === 'practise' ? lineNote ?? T.help : tab === 'explore'
    ? exLine.length && ex.line ? t.jKataLine(exLine.map(m => gtp(point(m), N)).join(' '))
    : T.exploreNote(exW.moves.length) : t.jProgrammeNote)
  const links: Link[] = practising && (line!.phase === 'wrong' || line!.phase === 'end') ? [
    ...line!.more.length && !replaying ? [['more', line!.phase === 'wrong' ? t.seePunishment : t.jContinuation, () => setReplaying(true)] as Link] : [],
    ['next', t.jNextLine, newLine],
  ] : tab === 'practise' && !line ? [['next', t.jStart, newLine]] : []

  // ---------- panels ----------
  const exportProgress = async () => {
    try { if (await saveSgfFile(JSON.stringify(store.p, null, 1), T.fileName, 'json')) setSay(t.jExported) } catch (e) { setSay(failureText(e)) }
  }
  const resetProgress = async () => { if (await askFirst(T.resetAsk, t.jReset)) { setStore({ p: reset(), readOnly: false }); setSay(null) } }
  const fams = tab === 'programme' ? programme(db, R, p).slice(0, 8) : []
  const body = (
    <section className="rv jt" aria-label={T.title}>
      <div className="lab"><span>{T.title}</span><span>{lens}</span></div>
      {setBook && <Seg label={t.fFamily} value={book} options={[['joseki', t.joseki], ['fuseki', t.fuseki]]} set={setBook} />}
      <Seg label={T.title} value={tab} options={[['explore', t.jTabs.explore], ['practise', t.jTabs.practise], ...fuseki ? [] : [['programme', t.jTabs.programme] as [Tab, string]]]} set={v => { setTab(v); setSay(null) }} />
      <div className="field">
        <span>{t.myLevel}</span>
        <Seg label={t.myLevel} value={LEVELS[nearestProfile(LEVELS, rank)]} options={LEVELS.map(r => [r, r])} set={setRank} />
      </div>
      {tab === 'explore' && <>
        <Seg label={T.root} value={ex.path.root} options={db.roots.map((r, i) => [i, r.name])} set={root => goEx({ root, picks: [] })} />
        <div className="jnav">
          <button className="chev" onClick={back} disabled={!ex.path.picks.length} aria-label={t.jBack} title={`${t.jBack} (←)`}><Icon name="chevron-left" /></button>
          <span className="quiet">{t.move(exW.moves.length)}</span>
          <button className="chev" onClick={() => frequent >= 0 && down(frequent)} disabled={frequent < 0} aria-label={t.jFrequent} title={`${t.jFrequent} (→)`}><Icon name="chevron-right" /></button>
        </div>
        {exEdges.length > 0 && <ul className="jrows" aria-label={t.jMoves}>
          {heads.map(i => [exEdges[i], i] as const).map(([e, i]) => (
            <li key={i}><button className={`jrow ${tone(e[2] / 10)}`} onClick={() => down(i)}>
              <b>{moveName(i)}</b><span>{loss(e[2])}</span><span>{t.jAt(pct(freqOf(i, p)), lens)}</span><small>{tags(e[4])}</small>
            </button></li>
          ))}
        </ul>}
        {tenukiEdge >= 0 && exEdges[tenukiEdge][2] <= 5 && <p className="quiet">{t.jTenukiFine(exEdges[tenukiEdge][2] / 10)}</p>}
        {complete && !fuseki && <p className="estimate">{t.jComplete}</p>}
        {exEdges.length > 0 && <p className="quiet jlens">
          <span>{t.jLens}</span>
          {LENS.map(r => db.profiles.indexOf(r)).filter(q => q >= 0).map(q => {
            const i = heads.reduce((b, j) => freqOf(j, q) > freqOf(b, q) ? j : b, 0)
            return <span key={q}>{t.jLensOf(db.profiles[q], `${exLetters.get(i) ?? t.jTenuki} ${pct(freqOf(i, q))}`)}</span>
          })}
          <span>{t.jLensOf('KataGo', exLetters.get(0) ?? t.jTenuki)}</span>
        </p>}
        {exLine.length > 0 && <button className="link" onClick={() => setEx({ ...ex, line: !ex.line })} aria-pressed={ex.line}>{ex.line ? t.jHideLine : t.jShowLine}</button>}
        <div className="opts">
          <button className="btn" onClick={fromHere} disabled={!exEdges.length}>{t.jPractiseHere}</button>
          <button className="btn" onClick={() => playFrom(moves).then(ok => ok && close())}>{t.jPlayHere}</button>
        </div>
        <p className="quiet">{T.context}</p>
      </>}
      {tab === 'practise' && <>
        <p className="quiet" aria-live="polite">{store.readOnly ? t.jReadOnly : t.jProgress(progress.due, progress.fresh)}</p>
        <div className="opts">
          {line ? !fuseki && <button key="tenuki" className="btn" onClick={answerTenuki} disabled={line.phase !== 'ask' || replaying} title={t.jTenukiHelp}>{t.jTenuki}</button>
            : <button key="start" className="btn accent" onClick={newLine}>{t.jStart}</button>}
        </div>
        <p className="quiet"><button className="link" onClick={exportProgress}>{t.jExport}</button> · <button className="link" onClick={resetProgress} disabled={store.readOnly}>{t.jReset}</button></p>
      </>}
      {tab === 'programme' && <>
        <p className="quiet">{t.jProgrammeHelp(lens)}</p>
        <ul className="jfams">
          {fams.map(f => {
            const w = walk(db, { root: f.root, picks: [f.pick] }), name = `${db.roots[f.root].name} · ${gtp(point(w.moves[1]), N)}`
            return <li key={`${f.root}-${f.pick}`}><button onClick={() => { setTab('explore'); goEx({ root: f.root, picks: [f.pick] }) }} aria-label={t.jOpenFamily(name)}>
              <Corner moves={shown(w.moves, EXPLORE)} />
              <b>{name}</b><span>{t.jMet(Math.max(1, Math.round(1 / Math.max(f.reach, 1e-4))))}</span><span>{t.jLoss(f.reach ? f.score / f.reach : 0)}</span>
            </button></li>
          })}
        </ul>
      </>}
    </section>
  )
  const keys: Record<string, (() => void) | undefined> = {
    ...muted, arrowleft: () => { if (tab === 'explore') back() }, arrowright: () => { if (tab === 'explore' && frequent >= 0) down(frequent) },
  }
  return { ...none, play, board, note, links, body, acts, keys }
}

/** A family's corner (the top-right 12×12 of the explorer's frame), as a small SVG diagram. */
function Corner({ moves }: { moves: Move[] }) {
  const b = position(moves), X0 = 7, n = 12, c = 10, o = c / 2
  const stones: ReactNode[] = []
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const s = b.get([X0 + x, y])
    if (s) stones.push(<circle key={`${x},${y}`} cx={o + x * c} cy={o + y * c} r={c * 0.47} className={s === 1 ? 'b' : 'w'} />)
  }
  // the board's edges are at the top and right; the lines run off to the left and bottom
  const lines = Array.from({ length: n }, (_, i) => `M0 ${o + i * c}H${o + (n - 1) * c}M${o + i * c} ${o}V${n * c}`).join('')
  return <svg viewBox={`0 0 ${n * c} ${n * c}`} aria-hidden="true"><path d={lines} /><>{stones}</></svg>
}
