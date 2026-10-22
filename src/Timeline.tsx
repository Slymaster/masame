import { CatIcon } from './CatIcon'
import { CATS, type Cat } from './classify'
import { CAT_COLORS } from './cats'
import type { Game } from './game'
import { t } from './i18n'
import { Icon } from './Icon'

/**
 * History of the shown line: autoplay, steps, the range with its forks (and a reviewed game's notable moves, `ticks`: a
 * band of notches under the range, the shown move's glyph over it), then the variation links and the node's comment.
 */
export function Timeline({ g, floor, go, auto, toggleAuto, live, relocate, ticks }: {
  g: Game; floor: number; go: (i: number) => void; auto: boolean; toggleAuto: () => void; live: boolean; relocate: (f: (g: Game) => void) => void
  ticks?: { at: number; cat: Cat; label: string }[]
}) {
  const total = g.moves.length, fork = g.fork, comment = g.nodes[g.cursor].data.C?.[0]
  const at = (i: number) => `calc(6px + (100% - 12px) * ${(i - floor) / (total - floor)})` // on the ticks' scale
  const forks = g.nodes.flatMap((_, i) => (i > floor && g.nodes[i - 1].children.length > 1 ? [i] : []))
  const rank = (c: Cat) => (c === 'brilliant' ? 5.5 : CATS.indexOf(c)) // errors first (blunder worst), then brilliant over great
  const notches = [...ticks ?? []].sort((a, b) => rank(a.cat) - rank(b.cat)) // painted last, the worst wins a shared spot
  const cur = ticks?.find(k => k.at === g.cursor)
  // the band: a click goes to the nearest notable move; keys step through them (Enter/Space: the next one, wrapping)
  const band = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!e.detail) return step(1, true)
    const r = e.currentTarget.getBoundingClientRect(), i = floor + (e.clientX - r.left) / r.width * (total - floor)
    go(ticks!.reduce((a, k) => (Math.abs(k.at - i) < Math.abs(a.at - i) ? k : a)).at)
  }
  const step = (d: 1 | -1, wrap = false) => {
    const k = (d > 0 ? ticks!.find(k => k.at > g.cursor) : [...ticks!].reverse().find(k => k.at < g.cursor)) ?? (wrap ? ticks![0] : undefined)
    if (k) go(k.at)
  }
  return <>
    <div className="tl">
      <button className="chev" aria-pressed={auto} onClick={toggleAuto} disabled={live || total === floor} aria-label={t.autoplay} title={`${t.autoplay} (${t.space})`}>
        <Icon name={auto ? 'pause' : 'play'} />
      </button>
      <button className="chev" onClick={() => go(g.cursor - 1)} disabled={g.cursor <= floor} aria-label={t.prev} title={`${t.prev} (←)`}><Icon name="chevron-left" /></button>
      <span className={`track${ticks?.length ? ' ticked' : ''}`}>
        <input type="range" min={floor} max={total} value={g.cursor} onChange={e => go(+e.target.value)} aria-label={t.history}
          aria-valuetext={t.move(g.moveNumber())} style={{ '--n': total - floor } as React.CSSProperties} />
        {!!ticks?.length && <button className="band" onClick={band} aria-label={t.keyMoments} title={t.keyMoments}
          onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); step(e.key === 'ArrowLeft' ? -1 : 1) } }}>
          {notches.map(k => <b key={k.at} aria-current={k === cur || undefined}
            style={{ left: `calc(100% * ${(k.at - floor) / (total - floor)})`, '--cw': CAT_COLORS[k.cat][0], '--cl': CAT_COLORS[k.cat][1] } as React.CSSProperties} />)}
        </button>}
        {forks.map(i => <i key={i} aria-hidden="true" style={{ left: at(i) }} />)}
        {cur && <span className="tick" style={{ left: at(cur.at) }}><CatIcon cat={cur.cat} size={16} title={cur.label} /></span>}
      </span>
      <button className="chev" onClick={() => go(g.cursor + 1)} disabled={g.cursor === total} aria-label={t.next} title={`${t.next} (→)`}><Icon name="chevron-right" /></button>
      <span className="mv">{t.moveOf(g.moveNumber(), g.moveNumber(total))}</span>
    </div>
    {(fork || !g.onMain) && (
      <p className="vars">
        {fork && <button className="link" onClick={() => relocate(x => x.switchVariation(1))} title="↑ ↓">{t.variation(fork.k, fork.n)}</button>}
        {!g.onMain && <button className="link" onClick={() => relocate(x => x.mainLine())}>{t.mainLine}</button>}
      </p>
    )}
    {comment && <p className="cmt">{comment}</p>}
  </>
}
