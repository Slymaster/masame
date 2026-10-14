/** A labelled on/off row: the whole row toggles, the switch carries the ARIA state. */
export function Switch({ label, k, on, toggle, disabled, title }: { label: string; k?: string; on: boolean; toggle: () => void; disabled?: boolean; title?: string }) {
  return (
    <div className="row" onClick={disabled ? undefined : toggle} title={title}>
      <span>{label} {k && <kbd>{k}</kbd>}</span>
      <button className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={e => { e.stopPropagation(); toggle() }} />
    </div>
  )
}
