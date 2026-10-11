import { useEffect, useState } from 'react'
import { call, inTauri, type NetEntry, type NetState, type Progress } from './katago'
import { failureText, pick, t } from './i18n'

interface Props { nets: NetState | null; progress: Record<string, Progress>; onClose: () => void; onChanged: () => void }

const link = (which: string) => (e: React.MouseEvent) => { e.preventDefault(); void call('open_link', { which }) }

export function Networks({ nets, progress, onClose, onChanged }: Props) {
  const [entries, setEntries] = useState<NetEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!inTauri()) return setError(t.managerInAppOnly)
    call<{ entries: NetEntry[]; error: unknown }>('networks_catalog')
      .then(r => { setEntries(r.entries); setError(r.error ? failureText(r.error) : null) }, e => setError(failureText(e)))
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])
  const top = Math.max(0, ...(entries ?? []).map(e => e.elo ?? 0))

  return (
    <div className="sheet-back" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={t.networks} onClick={e => e.stopPropagation()}>
        <header>
          <div className="eyebrow"><i className="mark" />{t.engineEyebrow}</div>
          <h2 className="title">{t.networks}</h2>
          <button className="close" onClick={onClose} aria-label={t.close} title={t.closeHint}>×</button>
        </header>
        <p className="quiet">{t.humanRequired}</p>
        {error && <p className="note">{error}</p>}
        {!entries && !error && <p className="quiet">{t.loading}</p>}
        {entries && (['recommended', 'current'] as const).map(id => {
          const list = entries.filter(e => e.section === id)
          return list.length > 0 && (
            <section key={id}>
              <div className="lab"><span>{t.sections[id]}</span><span /></div>
              {list.map(e => <Row key={e.key} e={e} top={top} nets={nets} p={progress[e.name]} onChanged={onChanged} />)}
            </section>
          )
        })}
        <footer className="foot credits">
          <a href="#" onClick={link('katago')}>{t.creditsKataGo}</a> {t.creditsMid} <a href="#" onClick={link('license')}>{t.creditsLicense}</a>
        </footer>
      </aside>
    </div>
  )
}

function Row({ e, top, nets, p, onChanged }: { e: NetEntry; top: number; nets: NetState | null; p?: Progress; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const inst = nets?.installed.find(i => i.name === e.name)
  const human = e.name === nets?.human
  const busy = p ? p.state === 'downloading' || p.state === 'verifying' : !!nets?.downloading.includes(e.name)
  const act = (cmd: string) => { setErr(null); call(cmd, { name: e.name }).then(onChanged, x => setErr(failureText(x))) }
  const pct = (n: number, d: number) => Math.floor((100 * n) / Math.max(1, d))
  const rating = e.elo == null || e.evaluating ? null : Math.round(e.elo) // a fresh net's Elo is noise until it has rating games
  const strength = rating == null ? 0 : Math.max(0.06, Math.min(1, (rating - (top - 1000)) / 1000))

  let status: string
  if (p?.state === 'verifying') status = t.verifying
  else if (busy && p) status = t.progress(pct(p.received, p.total), t.mb(p.received), t.mb(p.total))
  else if (busy) status = t.downloadingNow
  else if (inst?.complete) status = t.installed
  else if (inst) status = t.interruptedAt(pct(inst.bytes, e.bytes))
  else status = '' // the size is on the details line
  const message = err ?? (p?.state === 'error' && p.error ? failureText(p.error) : null)

  return (
    <div className={`net${inst?.complete ? ' on' : ''}`}>
      <div className="net-head">
        <span className="net-name">{pick(t.labels, e.key) ?? e.key}</span>
        <span className={`net-status${message ? ' err' : ''}`}>{message ? t.error : status}</span>
      </div>
      <div className="net-tech" title={e.name}>{e.name}</div>
      <div className="net-meta">
        {human ? <span>{t.imitates}</span> : (
          <>
            <span className="meter" title={rating == null ? t.notRatedYet : t.elo(rating)}><i style={{ width: `${strength * 100}%` }} /></span>
            <span>{e.evaluating ? t.evaluating : rating == null ? t.unrated : t.elo(rating)}{e.games != null && ` · ${t.games(e.games)}`}</span>
          </>
        )}
        <span className="dim">{t.mb(e.bytes)} · {t.month(e.createdAt)}</span>
      </div>
      {busy && p && <div className="bar" role="progressbar" aria-valuenow={pct(p.received, p.total)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct(p.received, p.total)}%` }} /></div>}
      {message && <p className="net-err">{message}</p>}
      <div className="net-acts">
        {busy ? <button className="link" onClick={() => act('network_cancel')} disabled={p?.state === 'verifying'}>{t.cancel}</button>
          : inst?.complete ? <>
            {!human && (
              <label className="use">
                <input type="radio" name="active-net" checked={nets?.active === e.name} onChange={() => act('network_set_active')} />
                {t.useForAnalysis}
              </label>
            )}
            <button className="link" onClick={() => act('network_delete')}>{t.remove}</button>
          </>
          : <button className="link accent" onClick={() => act('network_download')}>{inst ? t.resume : t.download}</button>}
      </div>
    </div>
  )
}
