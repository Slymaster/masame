import { useEffect, useState } from 'react'
import { failureText, t } from './i18n'
import * as ogs from './ogs'

const who = (p: ogs.Player) => <><span className="nm">{p.username}</span>{p.rank && <span className="rk">{p.rank}</span>}</>

/** A pasted OGS link, and the strongest live games; works signed out, on a guest connection. */
export function OgsWatch({ onWatch, onOpenLink }: { onWatch: (id: number) => void; onOpenLink: (id: number) => void }) {
  const [link, setLink] = useState(''), [bad, setBad] = useState(false)
  const [list, setList] = useState<ogs.WatchRow[] | string | null>(null)
  const load = () => {
    setList(null)
    return ogs.connect({ guest: true }).then(() => ogs.liveGames()).then(setList, e => setList(failureText(e)))
  }
  useEffect(() => { void load() }, [])
  const open = (e: React.FormEvent) => {
    e.preventDefault()
    const id = ogs.gameIdOf(link)
    setBad(id === null)
    if (id !== null) onOpenLink(id)
  }

  return <>
    <form className="games" onSubmit={open}>
      <div className="games-title">{t.ogsOpenLink}</div>
      <div className="ogs-inline">
        <input className="ogs-input" type="text" value={link} onChange={e => { setLink(e.target.value); setBad(false) }} placeholder={t.ogsLinkPlaceholder}
          aria-label={t.ogsOpenLink} aria-invalid={bad || undefined} autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
        <button className="btn" type="submit" disabled={!link.trim()}>{t.ogsOpen}</button>
      </div>
      {bad && <p className="quiet err" role="alert">{t.ogsBadLink}</p>}
    </form>
    <div className="games">
      <div className="games-title"><span>{t.ogsLiveNow}</span><button className="link" onClick={() => void load()} disabled={list === null}>{t.ogsRefresh}</button></div>
      {list === null ? <p className="quiet">{t.ogsLoading}</p>
        : typeof list === 'string' ? <p className="quiet err" role="alert">{list}</p>
        : !list.length ? <p className="quiet">{t.none}</p>
        : list.map(g => (
          <button key={g.id} className="game-row" onClick={() => onWatch(g.id)}>
            <span className="who">{who(g.black)}<span className="vs" aria-hidden>–</span>{who(g.white)}</span>
            <span className="dim">{`${g.size}×${g.size} · ${t.ogsMoveN(g.move)}`}</span>
          </button>
        ))}
    </div>
  </>
}
