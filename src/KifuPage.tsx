// Partager › Kifu: the record as a book prints it, on a page of its own that the system print dialog turns into paper
// or a PDF (@media print in styles.css), or saved as one PNG.
import { useEffect, useMemo, useRef, useState } from 'react'
import { savePngFile } from './files'
import type { Game } from './game'
import { failureText, t } from './i18n'
import { call, inTauri } from './katago'
import { diagrams, drawDiagram, INK, kifuName, PAPER, type Diagram } from './kifu'
import { toPng } from './postcard'
import { readResult } from './sgf'

const today = () => { const d = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
const legend = (d: Diagram) => d.notes.map(({ n, at }) => (at === null ? t.kifuPass(n) : t.kifuAt(n, at))).join(', ')

/** WKWebView ignores window.print(): inside the app the webview's own print dialog (Rust print_page), on every OS. */
const print = () => { if (inTauri()) call('print_page').catch(() => window.print()); else window.print() }

export function Kifu({ game, source, ranks, onClose }: { game: Game; source: string; ranks: [string, string]; onClose: () => void }) {
  const ds = useMemo(() => diagrams(game), [game])
  const [font, setFont] = useState(false) // the numbers' face, loaded before they are drawn
  useEffect(() => { document.fonts.load('600 20px Manrope').finally(() => setFont(true)) }, [])
  const pics = useMemo(() => (font ? ds.map(d => drawDiagram(d)) : []), [ds, font])
  const urls = useMemo(() => pics.map(c => c.toDataURL('image/png')), [pics])
  const [said, setSaid] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null), close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
    addEventListener('keydown', onKey, true)
    document.documentElement.classList.add('kifu-open') // @media print shows only the kifu
    return () => { removeEventListener('keydown', onKey, true); document.documentElement.classList.remove('kifu-open') }
  }, [])

  const { size, komi, playerBlack, playerWhite, result } = game.info
  const names = [playerBlack || t.color(1), playerWhite || t.color(-1)]
  const date = game.root.data.DT?.[0]?.slice(0, 10) || today()
  const res = result ? readResult(result) : null
  const title = `${names[0]}${ranks[0] ? ` ${ranks[0]}` : ''} – ${names[1]}${ranks[1] ? ` ${ranks[1]}` : ''}`
  const meta = [date, t.board(size, komi), res && [t.ended(res.winner, res.how, res.points), res.winner ? t.endedHow(res.how, res.points) : ''].filter(Boolean).join(' '), source]
    .filter(Boolean).join(' · ')

  const png = async () => {
    try {
      const blob = await toPng(sheetPng([title, meta], ds.map((d, i) => ({ caption: t.kifuMoves(d.from, d.to), pic: pics[i], legend: legend(d) }))))
      if (!blob) throw new Error('png')
      if (await savePngFile(blob, kifuName(date, names[0], names[1]), t.kifuSaveTitle)) setSaid(t.kifuSaved)
    } catch (e) { setSaid(t.kifuFailed(failureText(e))) }
  }

  return (
    <div className="kifu-page" role="dialog" aria-modal="true" aria-label={t.kifuTitle} tabIndex={-1} ref={ref}>
      <div className="kifu-bar">
        <h2 className="title">{t.kifuTitle}</h2>
        <button className="btn accent" onClick={print}>{t.kifuPrint}</button>
        <button className="btn" onClick={png} disabled={!font}>{t.kifuPng}</button>
        {said && <p className="say" aria-live="polite">{said}</p>}
        <button className="close" onClick={onClose} aria-label={t.close} title={t.closeHint}>×</button>
      </div>
      {ds.map((d, i) => (
        <article className="kifu-sheet" key={i}>
          {i === 0 && <header className="kifu-head"><h1>{title}</h1><p>{meta}</p></header>}
          <h3>{t.kifuMoves(d.from, d.to)}</h3>
          {urls[i] && <img src={urls[i]} alt={t.kifuDiagram(d.from, d.to)} />}
          {d.notes.length > 0 && <p className="kifu-legend">{legend(d)}</p>}
        </article>
      ))}
    </div>
  )
}

/** The whole kifu as one tall picture: the header, then each diagram with its caption and legend. */
function sheetPng(head: [string, string], parts: { caption: string; pic: HTMLCanvasElement; legend: string }[]): HTMLCanvasElement {
  const W = parts[0].pic.width, m = W * 0.05, fs = W * 0.02, line = fs * 1.45, inner = W - 2 * m
  const c = document.createElement('canvas'), x = c.getContext('2d')!
  const font = (w: number, px: number) => `${w} ${px}px Manrope, system-ui, sans-serif`
  const wrap = (s: string, px: number) => { // words to lines of at most `inner` px
    x.font = font(500, px)
    const out: string[] = []
    for (const w of s.split(' ')) { const l = out.length ? `${out[out.length - 1]} ${w}` : w; if (out.length && x.measureText(l).width <= inner) out[out.length - 1] = l; else out.push(w) }
    return out
  }
  const legends = parts.map(p => (p.legend ? wrap(p.legend, fs) : []))
  const metaLines = wrap(head[1], fs)
  c.width = W
  c.height = Math.ceil(m + line * 1.6 + metaLines.length * line + parts.reduce((h, _, i) => h + line * 1.8 + inner + legends[i].length * line + line, 0) + m)
  x.fillStyle = PAPER; x.fillRect(0, 0, c.width, c.height)
  x.fillStyle = INK; x.textBaseline = 'top'; x.textAlign = 'left'
  let y = m
  x.font = font(600, fs * 1.4); x.fillText(head[0], m, y); y += line * 1.6
  x.font = font(500, fs); for (const l of metaLines) { x.fillText(l, m, y); y += line }
  parts.forEach((p, i) => {
    y += line * 0.8
    x.font = font(600, fs); x.fillText(p.caption, m, y); y += line
    x.drawImage(p.pic, m, y, inner, inner); y += inner
    x.font = font(500, fs); for (const l of legends[i]) { x.fillText(l, m, y); y += line }
    y += line
  })
  return c
}
