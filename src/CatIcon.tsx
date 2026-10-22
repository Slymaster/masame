import type { CSSProperties, ReactElement } from 'react'
import type { Cat } from './classify'
import { CAT_COLORS, CAT_STYLE, CAT_SYMBOLS, type CatStyle } from './cats'
import './cats.css'

const FRAME: Record<CatStyle, ReactElement> = {
  seal: <circle className="cat-fill" cx="12" cy="12" r="11.5" />,
  hanko: <rect className="cat-frame" x="2.2" y="2.2" width="19.6" height="19.6" rx="4.6" />,
  enso: <circle className="cat-frame" cx="12" cy="12" r="10.2" transform="rotate(-62 12 12)" />,
}

/** A move category's glyph: a symbol in its pigment (colour per skin in cats.css). Decorative unless `title` is given. */
export function CatIcon({ cat, size = 16, title, look = CAT_STYLE }: { cat: Cat; size?: number; title?: string; look?: CatStyle }) {
  const s = CAT_SYMBOLS[cat], [w, l] = CAT_COLORS[cat]
  return (
    <svg className={`cat cat-${look}`} viewBox="0 0 24 24" width={size} height={size} style={{ '--cw': w, '--cl': l } as CSSProperties}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {FRAME[look]}
      <path className="cat-sym" d={s.d} fill={s.fill ? 'currentColor' : 'none'} strokeWidth={s.w ?? 2.3} />
    </svg>
  )
}
