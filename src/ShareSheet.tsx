import { useState } from 'react'
import { t } from './i18n'
import { shortcut } from './platform'
import { Sheet } from './Sheet'

/** The meta row's Share: the game as SGF, the board as a postcard, the kifu (once App passes onKifu), an OGS game's link. */
export function ShareSheet({ onClose, opener, onSave, onPostcard, onKifu, ogsId }: {
  onClose: () => void; opener: HTMLElement | null
  onSave: () => void; onPostcard: () => void; onKifu?: () => void // each closes the sheet first (App)
  ogsId?: number // the shown game is an OGS game
}) {
  const [said, setSaid] = useState<string | null>(null)
  const url = ogsId === undefined ? '' : `https://online-go.com/game/${ogsId}`
  // written within the click: WebKit refuses a clipboard write made later
  const copy = () => navigator.clipboard.writeText(url).then(() => setSaid(t.shareCopied(url)), () => setSaid(t.shareCopyFailed))
  return (
    <Sheet title={t.share} onClose={onClose} opener={opener}>
      <section className="share-list">
        <button className="share-row" onClick={onSave}><span>{t.shareSave}</span><kbd>{shortcut('S')}</kbd></button>
        <button className="share-row" onClick={onPostcard} title={t.postcardHint}><span>{t.sharePostcard}</span></button>
        {onKifu && <button className="share-row" onClick={onKifu}><span>{t.shareKifu}</span></button>}
        {url && <button className="share-row" onClick={copy}><span>{t.shareLink}</span></button>}
        {said && <p className="say" aria-live="polite">{said}</p>}
      </section>
    </Sheet>
  )
}
