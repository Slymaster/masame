import type { Game } from './game'
import { t } from './i18n'
import { Icon } from './Icon'

/** History of the shown line: autoplay, steps, the range with its forks, then the variation links and the node's comment. */
export function Timeline({ g, floor, go, auto, toggleAuto, live, relocate }: {
  g: Game; floor: number; go: (i: number) => void; auto: boolean; toggleAuto: () => void; live: boolean; relocate: (f: (g: Game) => void) => void
}) {
  const total = g.moves.length, fork = g.fork, comment = g.nodes[g.cursor].data.C?.[0]
  const forks = g.nodes.flatMap((_, i) => (i > floor && g.nodes[i - 1].children.length > 1 ? [i] : []))
  return <>
    <div className="tl">
      <button className="chev" aria-pressed={auto} onClick={toggleAuto} disabled={live || total === floor} aria-label={t.autoplay} title={`${t.autoplay} (${t.space})`}>
        <Icon name={auto ? 'pause' : 'play'} />
      </button>
      <button className="chev" onClick={() => go(g.cursor - 1)} disabled={g.cursor <= floor} aria-label={t.prev} title={`${t.prev} (←)`}><Icon name="chevron-left" /></button>
      <span className="track">
        <input type="range" min={floor} max={total} value={g.cursor} onChange={e => go(+e.target.value)} aria-label={t.history}
          aria-valuetext={t.move(g.moveNumber())} style={{ '--n': total - floor } as React.CSSProperties} />
        {forks.map(i => <i key={i} aria-hidden="true" style={{ left: `calc(6px + (100% - 12px) * ${(i - floor) / (total - floor)})` }} />)}
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
