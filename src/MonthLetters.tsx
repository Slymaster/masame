// Progrès › La lettre du mois: this month "so far", then the past months, each one sentence per fact (src/letter.ts),
// and "Save as an image": the letter as a print (postcard.ts letterCanvas), saved as a PNG.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Played } from './exercises/deck'
import { savePngFile } from './files'
import { failureText, t } from './i18n'
import * as journal from './journal'
import { inTauri } from './katago'
import { letterLines, loadCounts, monthFacts, months, type Sources } from './letter'
import * as library from './library'
import { letterCanvas, signatureFonts, toPng } from './postcard'
import type { Read } from './rank'

export function MonthLetters({ played, ranks }: { played: Played[]; ranks: Read[] }) {
  const entries = useSyncExternalStore(library.subscribe, library.get)
  useEffect(() => { if (inTauri()) library.load().catch(() => {}) }, []) // outside the app (or unreadable): the letter goes without games
  const [stored] = useState(() => ({ journal: journal.load(), counts: loadCounts() }))
  const s: Sources = { entries: entries ?? [], played, ranks, ...stored }
  const list = months(s, Date.now())
  const [i, setI] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const saving = useRef(false)
  const { y, m } = list[i], title = t.letter.title(y, m), side = i === 0 ? t.letter.soFar : ''
  const lines = letterLines(monthFacts(y, m, s), t)
  const save = async () => {
    if (saving.current) return // a second click mustn't open a second save dialog
    saving.current = true
    try {
      await signatureFonts()
      const png = await toPng(letterCanvas(title, side, lines))
      if (png && await savePngFile(png, t.letter.fileName(y, m), t.letter.saveTitle)) setNote(t.letter.saved)
    } catch (e) { setNote(t.letter.failed(failureText(e))) } finally { saving.current = false }
  }
  const go = (k: number) => { setI(k); setNote(null) }
  return <>
    <article className="letter">
      <h3><span>{title}</span>{side && <em>{side}</em>}</h3>
      {lines.map(l => <p key={l}>{l}</p>)}
      <button className="btn" onClick={save}>{t.letter.save}</button>
    </article>
    <div className="letter-nav">
      {i < list.length - 1 && <button className="link" onClick={() => go(i + 1)}>‹ {t.letter.title(list[i + 1].y, list[i + 1].m)}</button>}
      {i > 0 && <button className="link next" onClick={() => go(i - 1)}>{t.letter.title(list[i - 1].y, list[i - 1].m)} ›</button>}
    </div>
    {note && <p className="say">{note}</p>}
  </>
}
