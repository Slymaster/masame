import { useId, type KeyboardEvent } from 'react'

/** A row of picture tiles, one choice: a radiogroup with one tab stop, the arrow keys move and choose (like native radios).
 *  Each option: value, name, one-line hint, picture (a missing or broken one leaves the neutral placeholder), and why it
 *  can't be chosen yet (an earned stone set): then it stays visible, focusable and read out, with that line instead of its hint. */
export function Gallery<T extends string>({ label, value, options, set }: {
  label: string; value: T | null; options: readonly (readonly [T, string, string, string?, string?])[]; set: (v: T) => void
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
    if (!options[n][4]) set(options[n][0])
  }
  return (
    <div className="gallery" role="radiogroup" aria-label={label} onKeyDown={keys}>
      {options.map(([v, name, hint, img, locked], i) => (
        <button key={v} role="radio" aria-checked={value === v} aria-disabled={locked ? true : undefined} tabIndex={v === stop ? 0 : -1} aria-label={name} aria-describedby={`${id}-${i}`}
          onClick={() => { if (!locked) set(v) }}
          onFocus={e => e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' }) /* honours the row's padding, unlike focus()'s own scroll */}>
          <span className="thumb">{img && <img key={img} src={img} alt="" width={320} height={200} loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />}</span>
          <span className="name">{name}</span>
          {locked ? <span className="locked" id={`${id}-${i}`}>{locked}</span> : <span className="hint" id={`${id}-${i}`}>{hint}</span>}
        </button>
      ))}
    </div>
  )
}
