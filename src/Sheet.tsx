import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'

/** A modal side sheet: Esc (before the app's shortcuts) and the backdrop close it; focus goes in, then back to the opener. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null), close = useRef(onClose)
  close.current = onClose
  const [opener] = useState(() => document.activeElement as HTMLElement | null) // read at render: StrictMode's 2nd mount sees the dialog focused
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
    addEventListener('keydown', onKey, true)
    return () => { removeEventListener('keydown', onKey, true); opener?.focus() } // runs after the commit that drops .stage's inert
  }, [opener])
  return (
    <div className="sheet-back" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={e => e.stopPropagation()}>
        <header>
          <h2 className="title">{title}</h2>
          <button className="close" onClick={onClose} aria-label={t.close} title={t.closeHint}>×</button>
        </header>
        {children}
      </aside>
    </div>
  )
}
