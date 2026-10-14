import { useEffect, useRef, useState } from 'react'
import { call, inTauri } from './katago'
import { failureText, t } from './i18n'
import * as ogs from './ogs'
import { Seg } from './Seg'

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

export function OgsSection({ speed, setSpeed, onFind, onResume, onImport, onSignOut }: OgsSectionProps) {
  const [me, setMe] = useState<ogs.Player | null | undefined>(ogs.me ?? undefined) // undefined: not known yet
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    call('ogs_login').then(() => ogs.connect()).then(setMe, e => { if (!silent(e)) setError(failureText(e)) }).finally(() => setWaiting(false))
  }
  const signOut = async () => {
    if (!(await onSignOut())) return
    setError(null)
    ogs.logout().then(() => setMe(null), e => setError(failureText(e)))
  }

  return <>
    {me ? <>
      <p className="quiet">
        {t.ogsSignedIn(me.username)}{me.rank && <span className="rk">{me.rank}</span>} · <button className="link" onClick={signOut}>{t.ogsSignOut}</button>
      </p>
      <div className="field">
        <span>{t.pace}</span>
        <Seg label={t.pace} value={speed} options={(['blitz', 'rapid', 'live'] as const).map(s => [s, t.paces[s]])} set={setSpeed} />
      </div>
      <button className="btn accent" ref={main} onClick={onFind}>{t.ogsFind}</button>
    </> : <>
      <p className="quiet">{inTauri() ? t.ogsSignInHelp : t.ogsInAppOnly}</p>
      {waiting
        ? <p className="quiet" aria-live="polite">{t.ogsWaiting} <button className="link" ref={cancel} onClick={() => void call('ogs_login_cancel').catch(() => {})}>{t.cancel}</button></p>
        : <button className="btn accent" ref={main} onClick={signIn} disabled={!inTauri() || me === undefined}>{t.ogsSignIn}</button>}
    </>}
    {error && <p className="quiet err" role="alert">{error}</p>}
    {me && <Games onResume={onResume} onImport={onImport} />}
  </>
}

/** Ongoing and finished games, fetched once each time the section appears. */
function Games({ onResume, onImport }: { onResume: (id: number) => void; onImport: (id: number) => void }) {
  const [lists, setLists] = useState<[ogs.GameRow[] | string | null, ogs.GameRow[] | string | null]>([null, null])
  useEffect(() => {
    let live = true
    const load = (f: () => Promise<ogs.GameRow[]>, i: 0 | 1) =>
      f().catch(failureText).then(r => live && setLists(l => (i ? [l[0], r] : [r, l[1]])))
    load(ogs.activeGames, 0); load(ogs.finishedGames, 1)
    return () => { live = false }
  }, [])
  const who = (g: ogs.GameRow) => <><span className="nm">{g.opponent.username}</span>{g.opponent.rank && <span className="rk">{g.opponent.rank}</span>}</>
  return (
    <div className="ogs-games">
      <div className="lab"><span>{t.ogsGames}</span><span /></div>
      {([[t.ongoing, lists[0], onResume, (g: ogs.GameRow) => `${g.size}×${g.size} · ${t.color(g.color)}`],
        [t.finished, lists[1], onImport, (g: ogs.GameRow) => `${g.size}×${g.size} · ${g.result ?? ''} · ${t.date(g.date)}`]] as const).map(([title, list, act, detail]) => (
        <div key={title} className="games">
          <div className="games-title">{title}</div>
          {list === null ? <p className="quiet">{t.ogsLoading}</p>
            : typeof list === 'string' ? <p className="quiet err">{list}</p>
            : !list.length ? <p className="quiet">{t.none}</p>
            : list.map(g => (
              <button key={g.id} className="game-row" onClick={() => act(g.id)}>
                <span className="who">{who(g)}</span><span className="dim">{detail(g)}</span>
              </button>
            ))}
        </div>
      ))}
    </div>
  )
}
