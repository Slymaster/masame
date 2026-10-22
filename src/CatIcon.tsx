import type { CSSProperties } from 'react'
import type { Cat } from './classify'
import { CAT_COLORS, CAT_SYMBOLS } from './cats'
import './cats.css'

/** A move category's glyph: a symbol in its pigment (colour per skin in cats.css). Decorative unless `title` is given. */
export function CatIcon({ cat, size = 16, title }: { cat: Cat; size?: number; title?: string }) {
  const s = CAT_SYMBOLS[cat], [w, l] = CAT_COLORS[cat]
  return (
    <svg className="cat cat-seal" viewBox="0 0 24 24" width={size} height={size} style={{ '--cw': w, '--cl': l } as CSSProperties}
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <circle className="cat-fill" cx="12" cy="12" r="11.5" />
      <path className="cat-sym" d={s.d} fill={s.fill ? 'currentColor' : 'none'} strokeWidth={s.w ?? 2.3} />
    </svg>
  )
}
