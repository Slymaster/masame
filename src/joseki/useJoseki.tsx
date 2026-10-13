// The joseki trainer: Explore, Practise and Programme panels, which borrow the board and the card while open.
// App keeps its game untouched underneath; its play(), bot turn and Undo defer to the trainer while it is open.
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Mark } from '../board/BoardView'
import { askFirst, saveSgfFile } from '../files'
import type { Move, Sign, Vertex } from '../game'
import { failureText, t } from '../i18n'
import { Icon } from '../Icon'
import { gtp } from '../katago'
import { Seg } from '../Seg'
import { loadJoseki, nearestProfile, reach, TAG, validate, type JosekiDb } from './db'
import { review } from './fsrs'
import {
  accepted, answer, continuation, counts, EXPLORE, focus, isTenuki, nextCard, node, pathTo, position, programme, reply, shown, shownAt,
  startLine, storedAt, tone, walk, type Line, type Orient, type Path,
} from './practice'
import { load, NEW_PER_DAY, record, reset, save, today, type Stored } from './store'
import { N, point } from './sym'

const LEVELS = ['20k', '15k', '10k', '5k', '1d', '5d']
const LENS = ['20k', '5k', '1d', 'pro']
const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ'
const REPLY_MS = 550, REPLAY_MS = 650
type Tab = 'explore' | 'practise' | 'programme'
type Link = [string, string, () => void]

/** The real data, or the committed fixture while developing without it (never shipped as the product data). */
const loadData = () => loadJoseki().catch(e => import.meta.env.DEV
  ? import('./fixture.json').then(m => { console.warn('joseki: using the fixture', e); return validate(structuredClone(m.default)) })
  : Promise.reject(e))
const randomOrient = (): Orient => ({ k: Math.floor(Math.random() * 8), swap: Math.random() < 0.5 })
const signOf = (o: Orient, ply: number) => ((ply % 2 ? 1 : -1) * (o.swap ? -1 : 1)) as Sign // ply: moves after the context

export function useJoseki({ view, rank, setRank, blocked, playFrom }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void } | null>; rank: string; setRank: (r: string) => void
  blocked: boolean; playFrom: (moves: Move[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('explore')
  const [db, setDb] = useState<JosekiDb | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [ex, setEx] = useState<{ path: Path; line: boolean }>({ path: { root: 0, picks: [] }, line: false })
  const [line, setLine] = useState<Line | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [store, setStore] = useState<Stored>(() => load())
  const [say, setSay] = useState<string | null>(null) // a one-off note (not in the book, exported)
  useEffect(() => save(store), [store])

  useEffect(() => {
    if (!open || db) return
    let live = true
    setError(null)
    loadData().then(d => live && setDb(d), e => live && setError(e))
    return () => { live = false }
  }, [open, db])
  useEffect(() => { if (blocked) setOpen(false) }, [blocked])

  const R = useMemo(() => db && reach(db), [db])
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

  const toggle = () => { if (!blocked) { setOpen(o => !o); setSay(null) } }
  const close = () => setOpen(false)
  const none = { open, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null }
  const button = (
    <button className="icon" aria-pressed={open} onClick={toggle} disabled={blocked} aria-label={t.joseki} title={`${t.joseki} (J)`}><Icon name="book" /></button>
  )
  if (!open) return { ...none, button }
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  if (!db || !R) {
    const note = error ? t.jFailed(failureText(error)) : t.jLoading
    return { ...none, button, acts, note, body: <section className="rv"><p className="estimate">{note}</p></section> }
  }

  const now = Date.now(), fresh = store.p.day === today(now) ? store.p.fresh : 0
  const lens = db.profiles[p]
  const pct = (f: number) => t.percent(f)

  // ---------- Explore ----------
  const goEx = (path: Path) => { setEx({ path, line: false }); setSay(null) }
  const exW = walk(db, ex.path), exNode = db.nodes[node(exW)], exEdges = exNode.e
  const exLetters = new Map<number, string>() // edge index → its marker letter
  exEdges.forEach((e, i) => { if (!isTenuki(e[0])) exLetters.set(i, LETTERS[exLetters.size] ?? '·') })
  const into = exW.nodes.length > 1 ? db.nodes[exW.nodes.at(-2)!].e[ex.path.picks.at(-1)!] : null // the edge that led here
  const exLine = !exEdges.length || (into && into[2] > 10) ? continuation(db, node(exW), exW.frames.at(-1)!) : []
  const tenukiEdge = exEdges.findIndex(e => isTenuki(e[0]))
  const proLocal = exEdges.reduce((a, e) => a + (isTenuki(e[0]) ? 0 : e[3][db.profiles.indexOf('pro')] ?? 0), 0) / 100
  // settled alone fires early in this context (the neighbours are the approacher's): complete = the tree's end, or settled and pros leave
  const complete = exEdges.length > 0 && (exEdges.every(e => !db.nodes[e[1]].e.length) || (exNode.s === 1 && proLocal < 0.3))
  const frequent = exEdges.reduce((b, e, i) => e[3][p] > (exEdges[b]?.[3][p] ?? -1) ? i : b, -1)
  const exMoves = [...exW.moves, ...ex.line ? exLine : []]
  const back = () => ex.path.picks.length && goEx({ ...ex.path, picks: ex.path.picks.slice(0, -1) })
  const down = (i: number) => {
    const v = shownAt(exW, EXPLORE, exEdges[i][0])
    view.current?.drop(v, signOf(EXPLORE, exW.moves.length))
    goEx({ ...ex.path, picks: [...ex.path.picks, i] })
  }
  const moveName = (i: number) => isTenuki(exEdges[i][0]) ? t.jTenuki : `${exLetters.get(i)} · ${gtp(shownAt(exW, EXPLORE, exEdges[i][0]), N)}`
  const tags = (bits: number) => (Object.keys(TAG) as (keyof typeof TAG)[]).filter(k => bits & TAG[k]).map(k => t.jTags[k]).join(' · ')
  const loss = (x10: number) => x10 ? t.jLoss(x10 / 10) : t.jBest

  // ---------- Practise ----------
  const newLine = () => {
    setReplaying(false); setSay(null)
    const n = nextCard(db, R, p, store.p.cards, fresh, now)
    setLine(n === null ? null : startLine(db, pathTo(db, R, p, n), randomOrient()))
    if (n === null) setSay(t.jDone)
  }
  const fromHere = () => { setTab('practise'); setReplaying(false); setSay(null); setLine(startLine(db, ex.path, randomOrient())) }
  const graded = (l: Line) => {
    const c = l.last?.card
    if (c && (store.p.cards[c] || fresh < NEW_PER_DAY)) setStore(s => ({ ...s, p: record(s.p, c, review(s.p.cards[c], l.last!.rating, Date.now())) }))
    setLine(l)
  }
  const lw = line && walk(db, line.path), ln = lw && db.nodes[node(lw)]
  const toPlayLine = line ? signOf(line.o, lw!.moves.length) : 1
  const answerTenuki = () => { if (line?.phase === 'ask') graded(answer(db, line, 'tenuki')) }
  const lineMarks: Mark[] = line?.phase === 'wrong' && ln!.e.length
    ? accepted(db, node(lw!)).filter(i => !isTenuki(ln!.e[i][0])).map((i, k) => ({ v: shownAt(lw!, line.o, ln!.e[i][0]), label: LETTERS[k], tone: tone(ln!.e[i][2] / 10) }))
    : []
  const progress = counts(db, store.p.cards, fresh, now)

  // ---------- the board, the note and its links ----------
  const practising = tab === 'practise' && !!line
  const o = practising ? line!.o : EXPLORE
  const moves = shown(practising ? [...lw!.moves, ...line!.extra] : exMoves, o), b = position(moves)
  const board: Partial<Board3DState> = {
    signMap: b.signMap, last: moves.at(-1)!.vertex, toPlay: -moves.at(-1)!.sign as Sign, ownership: null, counting: null,
    captures: { black: b.getCaptures(1), white: b.getCaptures(-1) }, focus: focus(o),
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
    if (i < 0) { setSay(t.jNotInBook); return false }
    goEx({ ...ex.path, picks: [...ex.path.picks, i] })
    return true
  }
  const last = line?.last
  const lineNote = !line ? null
    : line.phase === 'ask' ? line.dev !== null ? t.jAskPunish(line.dev) : `${last ? last.rating === 3 ? t.jGood : t.jHard : ''}${t.jAsk(toPlayLine)}`
    : line.phase === 'reply' ? last?.rating === 3 ? t.jGood : t.jHard
    : line.phase === 'wrong' ? ln!.e.length ? lineMarks.length ? t.jWrong : t.jWrongTenuki : t.jMissedPunish
    : `${last ? last.rating === 1 ? '' : line.dev !== null ? `${t.found} ` : t.jGood : ''}${t.jLineEnd}`
  const note = say ?? (tab === 'practise' ? lineNote ?? t.jPractiseHelp : tab === 'explore'
    ? exLine.length && ex.line ? t.jKataLine(exLine.map(m => gtp(point(m), N)).join(' '))
    : t.jExploreNote(exW.moves.length) : t.jProgrammeNote)
  const links: Link[] = practising && (line!.phase === 'wrong' || line!.phase === 'end') ? [
    ...line!.more.length && !replaying ? [['more', line!.phase === 'wrong' ? t.seePunishment : t.jContinuation, () => setReplaying(true)] as Link] : [],
    ['next', t.jNextLine, newLine],
  ] : tab === 'practise' && !line ? [['next', t.jStart, newLine]] : []

  // ---------- panels ----------
  const exportProgress = async () => {
    try { if (await saveSgfFile(JSON.stringify(store.p, null, 1), t.jFileName, 'json')) setSay(t.jExported) } catch (e) { setSay(failureText(e)) }
  }
  const resetProgress = async () => { if (await askFirst(t.jResetAsk, t.jReset)) { setStore({ p: reset(), readOnly: false }); setSay(null) } }
  const fams = tab === 'programme' ? programme(db, R, p).slice(0, 8) : []
  const body = (
    <section className="rv jt" aria-label={t.joseki}>
      <div className="lab"><span>{t.joseki}</span><span>{lens}</span></div>
      <Seg label={t.joseki} value={tab} options={[['explore', t.jTabs.explore], ['practise', t.jTabs.practise], ['programme', t.jTabs.programme]]} set={v => { setTab(v); setSay(null) }} />
      <div className="field">
        <span>{t.myLevel}</span>
        <Seg label={t.myLevel} value={LEVELS[nearestProfile(LEVELS, rank)]} options={LEVELS.map(r => [r, r])} set={setRank} />
      </div>
      {tab === 'explore' && <>
        <Seg label={t.jCorner} value={ex.path.root} options={db.roots.map((r, i) => [i, r.name])} set={root => goEx({ root, picks: [] })} />
        <div className="jnav">
          <button className="chev" onClick={back} disabled={!ex.path.picks.length} aria-label={t.jBack} title={`${t.jBack} (←)`}><Icon name="chevron-left" /></button>
          <span className="quiet">{t.move(exW.moves.length)}</span>
          <button className="chev" onClick={() => frequent >= 0 && down(frequent)} disabled={frequent < 0} aria-label={t.jFrequent} title={`${t.jFrequent} (→)`}><Icon name="chevron-right" /></button>
        </div>
        {exEdges.length > 0 && <ul className="jrows" aria-label={t.jMoves}>
          {exEdges.map((e, i) => (
            <li key={i}><button className={`jrow ${tone(e[2] / 10)}`} onClick={() => down(i)}>
              <b>{moveName(i)}</b><span>{loss(e[2])}</span><span>{t.jAt(pct(e[3][p]), lens)}</span><small>{tags(e[4])}</small>
            </button></li>
          ))}
        </ul>}
        {tenukiEdge >= 0 && exEdges[tenukiEdge][2] <= 5 && <p className="quiet">{t.jTenukiFine(exEdges[tenukiEdge][2] / 10)}</p>}
        {complete && <p className="estimate">{t.jComplete}</p>}
        {exEdges.length > 0 && <p className="quiet jlens">
          <span>{t.jLens}</span>
          {LENS.map(r => db.profiles.indexOf(r)).filter(q => q >= 0).map(q => {
            const i = exEdges.reduce((b, e, j) => e[3][q] > exEdges[b][3][q] ? j : b, 0)
            return <span key={q}>{db.profiles[q]}: {exLetters.get(i) ?? t.jTenuki} {pct(exEdges[i][3][q])}</span>
          })}
          <span>KataGo: {exLetters.get(0) ?? t.jTenuki}</span>
        </p>}
        {exLine.length > 0 && <button className="link" onClick={() => setEx({ ...ex, line: !ex.line })} aria-pressed={ex.line}>{ex.line ? t.jHideLine : t.jShowLine}</button>}
        <div className="opts">
          <button className="btn" onClick={fromHere} disabled={!exEdges.length}>{t.jPractiseHere}</button>
          <button className="btn" onClick={() => playFrom(moves).then(ok => ok && close())}>{t.jPlayHere}</button>
        </div>
        <p className="quiet">{t.jContext}</p>
      </>}
      {tab === 'practise' && <>
        <p className="quiet" aria-live="polite">{store.readOnly ? t.jReadOnly : t.jProgress(progress.due, progress.fresh)}</p>
        <div className="opts">
          {line ? <button key="tenuki" className="btn" onClick={answerTenuki} disabled={line.phase !== 'ask' || replaying} title={t.jTenukiHelp}>{t.jTenuki}</button>
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
  // the game's own keys are muted while the trainer has the board (Space still presses a focused button)
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, home: () => {}, end: () => {}, p: () => {},
    arrowleft: () => { if (tab === 'explore') back() }, arrowright: () => { if (tab === 'explore' && frequent >= 0) down(frequent) },
  }
  return { open, toggle, close, play, board, note, links, body, acts, keys, button }
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
