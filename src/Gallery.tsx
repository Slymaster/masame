import { useId, type KeyboardEvent } from 'react'

/** A row of picture tiles, one choice: a radiogroup with one tab stop, the arrow keys move and choose (like native radios).
 *  Each option: value, name, one-line hint, picture (a missing or broken one leaves the neutral placeholder). */
export function Gallery<T extends string>({ label, value, options, set }: {
  label: string; value: T | null; options: readonly (readonly [T, string, string, string?])[]; set: (v: T) => void
}) {
  const id = useId()
  const stop = options.some(o => o[0] === value) ? value : options[0]?.[0]
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key]
    if (!step) return
    e.preventDefault()
    const tiles = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')]
    const n = (tiles.indexOf(document.activeElement as HTMLButtonElement) + step + tiles.length) % tiles.length
    tiles[n].focus({ preventScroll: true })
    set(options[n][0])
  }
  return (
    <div className="gallery" role="radiogroup" aria-label={label} onKeyDown={keys}>
      {options.map(([v, name, hint, img], i) => (
        <button key={v} role="radio" aria-checked={value === v} tabIndex={v === stop ? 0 : -1} aria-label={name} aria-describedby={`${id}-${i}`} onClick={() => set(v)}
          onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) /* honours the row's padding, unlike focus()'s own scroll */}>
          <span className="thumb">{img && <img key={img} src={img} alt="" width={320} height={200} loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}</span>
          <span className="name">{name}</span>
          <span className="hint" id={`${id}-${i}`}>{hint}</span>
        </button>
      ))}
    </div>
  )
}
