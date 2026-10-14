import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { call, inTauri } from './katago'
import { failureText, t } from './i18n'
import * as ogs from './ogs'
import { Seg } from './Seg'
import { Switch } from './Switch'
import { OgsGames } from './OgsGames'
import { OgsWatch } from './OgsWatch'

const silent = (e: unknown) => (e as { code?: string })?.code === 'ogs_cancelled'

/** The Game sheet's OGS part: sign-in, automatch and my games. Whether we're signed in is asked when it appears. */
/** What the App does for the OGS section; the section itself only talks to ogs.ts for lists and stores. */
export interface OgsSectionProps {
  speed: ogs.Speed
  setSpeed: (s: ogs.Speed) => void
  /** Automatch at the sheet's size and pace: a live pace closes the sheet and waits under the board; correspondence stays listed here. */
  onFind: () => void
  /** A challenge at the sheet's size and pace; rejects with an error to show in the form (ogs_no_player…). */
  onChallenge: (username: string, o: { ranked: boolean; handicap: boolean }) => Promise<void>
  onAccept: (c: ogs.ChallengeRow) => void
  onResume: (id: number) => void // one of my ongoing games
  onImport: (id: number) => void // a finished game, as SGF
  onWatch: (id: number) => void // someone else's live game
  onOpenLink: (id: number) => void // a game id from a pasted OGS link
  onSignOut: () => Promise<boolean>
  /** Signed in: a game watched as a guest must be followed again on the new connection. */
  onSignedIn: () => void
}

type Tab = 'play' | 'games' | 'watch'
const TAB_KEY = 'masame.ogs.tab'
const storedTab = (): Tab => {
  try { const v = localStorage.getItem(TAB_KEY); return v === 'games' || v === 'watch' ? v : 'play' } catch { return 'play' }
}

export function OgsSection(p: OgsSectionProps) {
  const { onSignOut, onSignedIn } = p
  const [me, setMe] = useState<ogs.Player | null | undefined>(ogs.me ?? undefined) // undefined: not known yet
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(storedTab)
  const pick = (v: Tab) => { setTab(v); try { localStorage.setItem(TAB_KEY, v) } catch { /* private mode: not remembered */ } }
  // the sign-in button gives way to Cancel while the browser is out: focus follows, then lands on what replaces it
  const cancel = useRef<HTMLButtonElement>(null), main = useRef<HTMLButtonElement>(null), waited = useRef(false)
  useEffect(() => {
    if (waiting) cancel.current?.focus(); else if (waited.current) main.current?.focus()
    waited.current = waiting
  }, [waiting])
  useEffect(() => {
    if (!inTauri()) return setMe(null)
    ogs.connect().then(setMe, e => { setMe(null); if (e?.code !== 'ogs_login_required') setError(failureText(e)) })
  }, [])
  const signIn = () => {
    setWaiting(true); setError(null)
    call('ogs_login').then(() => ogs.connect()).then(p => { setMe(p); if (p) onSignedIn() }, e => { if (!silent(e)) setError(failureText(e)) })
      .finally(() => setWaiting(false))
  }
  const signOut = async () => {
    if (!(await onSignOut())) return
    setError(null)
    ogs.logout().then(() => setMe(null), e => setError(failureText(e)))
  }

  if (!me) return <>
    <p className="quiet">{inTauri() ? t.ogsSignInHelp : t.ogsInAppOnly}</p>
    {waiting
      ? <p className="quiet" aria-live="polite">{t.ogsWaiting} <button className="link" ref={cancel} onClick={() => void call('ogs_login_cancel').catch(() => {})}>{t.cancel}</button></p>
      : <button className="btn accent" ref={main} onClick={signIn} disabled={!inTauri() || me === undefined}>{t.ogsSignIn}</button>}
    {error && <p className="quiet err" role="alert">{error}</p>}
    {inTauri() && <div className="ogs-pane">
      <div className="lab"><span>{t.ogsTabs.watch}</span><span /></div>
      <OgsWatch onWatch={p.onWatch} onOpenLink={p.onOpenLink} />
    </div>}
  </>

  return <>
    <p className="quiet">
      {t.ogsSignedIn(me.username)}{me.rank && <span className="rk">{me.rank}</span>} · <button className="link" onClick={signOut}>{t.ogsSignOut}</button>
    </p>
    {error && <p className="quiet err" role="alert">{error}</p>}
    <Seg label={t.ogsTabsLabel} value={tab} options={(['play', 'games', 'watch'] as const).map(v => [v, t.ogsTabs[v]])} set={pick} />
    <div className="ogs-pane">
      {tab === 'play' ? <Play {...p} main={main} />
        : tab === 'games' ? <OgsGames onResume={p.onResume} onImport={p.onImport} />
        : <OgsWatch onWatch={p.onWatch} onOpenLink={p.onOpenLink} />}
    </div>
  </>
}

const size = (n: number) => `${n}×${n}`

/** Pace and automatch, my correspondence searches, challenges both ways. */
function Play({ speed, setSpeed, onFind, onChallenge, onAccept, main }: OgsSectionProps & { main: React.RefObject<HTMLButtonElement | null> }) {
  const searches = useSyncExternalStore(ogs.searches.subscribe, ogs.searches.get)
  const challenges = useSyncExternalStore(ogs.challenges.subscribe, ogs.challenges.get)
  const [name, setName] = useState(''), [ranked, setRanked] = useState(true), [handicap, setHandicap] = useState(true)
  const [sending, setSending] = useState(false), [sendErr, setSendErr] = useState<string | null>(null)
  const [actErr, setActErr] = useState<string | null>(null)
  const act = (f: () => unknown) => { setActErr(null); Promise.resolve().then(f).catch(e => setActErr(failureText(e))) }
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || sending) return
    setSending(true); setSendErr(null)
    try { await onChallenge(name.trim(), { ranked, handicap }); setName('') } catch (err) { setSendErr(failureText(err)) } finally { setSending(false) }
  }
  const received = challenges.filter(c => !c.mine), sent = challenges.filter(c => c.mine)

  return <>
    <div className="field">
      <span>{t.pace}</span>
      <Seg label={t.pace} value={speed} set={setSpeed}
        options={(['blitz', 'rapid', 'live', 'correspondence'] as const).map(s => s === 'correspondence' ? [s, t.ogsCorrShort, t.paces[s]] : [s, t.paces[s]])} />
    </div>
    <button className="btn accent" ref={main} onClick={onFind}>{t.ogsFind}</button>
    {searches.length > 0 && <div className="games">
      {searches.map(s => (
        <div key={s.uuid} className="ogs-item">
          <span className="dim">{t.ogsCorrSearch(s.size)}</span>
          <span className="ogs-acts"><button className="link" onClick={() => act(() => ogs.cancelSearch(s.uuid))}>{t.cancel}</button></span>
        </div>
      ))}
    </div>}

    <form className="games ogs-form" onSubmit={send}>
      <div className="games-title">{t.ogsChallengeTitle}</div>
      <input className="ogs-input" type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t.ogsUsername} aria-label={t.ogsUsername}
        autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} />
      <Switch label={t.ogsRanked} on={ranked} toggle={() => setRanked(r => !r)} />
      <Switch label={t.ogsAutoHandicap} on={handicap} toggle={() => setHandicap(h => !h)} />
      <button className="btn" type="submit" disabled={!name.trim() || sending}>{t.ogsChallenge}</button>
      {sendErr && <p className="quiet err" role="alert">{sendErr}</p>}
      <p className="quiet ogs-hint">{t.ogsChallengeHint}</p>
    </form>

    {received.length > 0 && <div className="games">
      <div className="games-title">{t.ogsReceived}</div>
      {received.map(c => (
        <div key={c.id} className="ogs-item">
          <span className="who"><span className="nm">{c.from.username}</span>{c.from.rank && <span className="rk">{c.from.rank}</span>}</span>
          <span className="ogs-acts">
            <button className="link accent" onClick={() => onAccept(c)}>{t.ogsAccept}</button>
            <button className="link" onClick={() => act(() => ogs.declineChallenge(c.id))}>{t.ogsDecline}</button>
          </span>
          <span className="dim">{[size(c.size), t.paces[c.speed].toLowerCase(), c.ranked ? t.ogsRankedShort : t.ogsFriendly].join(' · ')}</span>
        </div>
      ))}
    </div>}
    {sent.length > 0 && <div className="games">
      <div className="games-title">{t.ogsSent}</div>
      {sent.map(c => (
        <div key={c.id} className="ogs-item">
          <span className="who"><span className="to" aria-hidden>→</span><span className="nm">{c.to.username}</span>{c.to.rank && <span className="rk">{c.to.rank}</span>}</span>
          <span className="ogs-acts"><button className="link" onClick={() => act(() => ogs.cancelChallenge(c.id))}>{t.cancel}</button></span>
          <span className="dim">{[size(c.size), t.paces[c.speed].toLowerCase()].join(' · ')}</span>
        </div>
      ))}
    </div>}
    {actErr && <p className="quiet err" role="alert">{actErr}</p>}
  </>
}
