/** A segmented choice: a radiogroup of buttons. */
export function Seg<T extends string | number>({ label, value, options, set, disabled, title }: {
  label: string; value: T; options: [T, string, string?][]; set: (v: T) => void; disabled?: boolean; title?: string
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} title={title}>
      {options.map(([v, l, tip]) => <button key={v} role="radio" aria-checked={value === v} disabled={disabled} title={tip} onClick={() => set(v)}>{l}</button>)}
    </div>
  )
}
