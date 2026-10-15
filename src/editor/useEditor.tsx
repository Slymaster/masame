// The position editor (Jouer › Depuis une position…): it borrows the board and the card like the trainers. Stones are
// placed by hand (a book problem copied in a minute), then the position is played against the AI, by two players, or
// kept on the board (Terminer) to analyse, count or save.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Board3DState } from '../board3d/Board3D'
import type { Game, Sign, Vertex } from '../game'
import { t } from '../i18n'
import { Icon } from '../Icon'
import { Seg } from '../Seg'
import { edit, empty, resize, toGame, type Stones } from './position'

type Link = [string, string, () => void]
const SIZES = [9, 13, 19]

export function useEditor({ view, open, setOpen, blocked, size, onAi, onTwo, onDone }: {
  view: RefObject<{ drop(v: Vertex, c: Sign): void } | null>
  open: boolean; setOpen: (o: boolean) => void; blocked: boolean
  size: number // the shown game's size: a fresh editor starts on it
  onAi: (g: Game) => void; onTwo: (g: Game) => void; onDone: (g: Game) => void
}) {
  const [map, setMap] = useState<Stones>(() => empty(size))
  const [tool, setTool] = useState<Sign>(1)
  const [side, setSide] = useState<Sign>(1)
  // the board hands App a vertex only: Shift is read from the pointer that pressed it
  const shift = useRef(false)
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => { shift.current = e.shiftKey }
    addEventListener('pointerdown', down, true)
    return () => removeEventListener('pointerdown', down, true)
  }, [open])
  useEffect(() => { if (blocked) setOpen(false) }, [blocked]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => { if (!blocked) setOpen(true) }
  const toggle = () => { if (open) setOpen(false); else start() }
  const close = () => setOpen(false)
  const none = { open, start, toggle, close, play: () => false, board: null, note: null, links: [] as Link[], body: null, acts: null, keys: null }
  if (!open) return none

  const play = (v: Vertex | null) => {
    if (!v) return false
    const next = edit(map, v, tool, shift.current), c = next[v[1]][v[0]]
    setMap(next)
    if (c) view.current?.drop(v, c) // drawn and sounded like a move; the board itself places nothing (false)
    return false
  }
  const board: Partial<Board3DState> = {
    signMap: map, last: null, toPlay: tool || side, interactive: true, coords: true, // coordinates always, to copy a diagram
    ownership: null, counting: null, marks: null, focus: null, captures: { black: 0, white: 0 },
  }
  const body = (
    <section className="rv ed" aria-label={t.edTitle}>
      <div className="lab"><span>{t.edTitle}</span><span /></div>
      <div className="field"><span>{t.edTool}</span>
        <Seg label={t.edTool} value={tool} options={[[1, t.black], [-1, t.white], [0, t.edErase]]} set={setTool} /></div>
      <div className="field"><span>{t.edToPlay}</span>
        <Seg label={t.edToPlay} value={side} options={[[1, t.black], [-1, t.white]]} set={setSide} /></div>
      <div className="field"><span>{t.size}</span>
        <Seg label={t.size} value={map.length} options={SIZES.map(n => [n, `${n}×${n}`])} set={n => setMap(resize(map, n))} /></div>
      <p className="quiet"><button className="link" onClick={() => setMap(empty(map.length))}>{t.edClear}</button></p>
      <div className="share-list">
        <button className="share-row" onClick={() => onAi(toGame(map, side))}><span>{t.edVsAi}</span></button>
        <button className="share-row" onClick={() => onTwo(toGame(map, side))}><span>{t.edTwo}</span></button>
        <button className="share-row" onClick={() => onDone(toGame(map, side))}><span>{t.edDone}</span></button>
      </div>
    </section>
  )
  // the three ways on read as sentences in the card's body (the acts row's small labels would wrap); Esc or Back leaves
  const acts = <button className="act" onClick={close} title="Esc"><Icon name="arrow-back-up" />{t.backToGame}</button>
  // the game's own keys are muted while the editor has the board
  const keys: Record<string, (() => void) | undefined> = {
    escape: close, ' ': undefined, arrowup: () => {}, arrowdown: () => {}, arrowleft: () => {}, arrowright: () => {}, home: () => {}, end: () => {}, p: () => {}, c: () => {}, t: () => {},
  }
  return { ...none, play, board, note: t.edHelp, body, acts, keys }
}
