import { useEffect, useRef, useState } from 'react'
import { CatIcon } from './CatIcon'
import { CATS, type Cat } from './classify'
import type { Game } from './game'
import { t } from './i18n'
import { Icon } from './Icon'

/**
 * History of the shown line: autoplay, steps, the range with its forks (and a reviewed game's notable moves, `ticks`: the
 * position after each, clickable), then the variation links and the node's comment.
 */
export function Timeline({ g, floor, go, auto, toggleAuto, live, relocate, ticks }: {
  g: Game; floor: number; go: (i: number) => void; auto: boolean; toggleAuto: () => void; live: boolean; relocate: (f: (g: Game) => void) => void
  ticks?: { at: number; cat: Cat; label: string }[]
}) {
  const total = g.moves.length, fork = g.fork, comment = g.nodes[g.cursor].data.C?.[0]
  const at = (i: number) => `calc(6px + (100% - 12px) * ${(i - floor) / (total - floor)})` // on the ticks' scale
  const forks = g.nodes.flatMap((_, i) => (i > floor && g.nodes[i - 1].children.length > 1 ? [i] : []))
  const track = useRef<HTMLSpanElement>(null), [w, setW] = useState(0)
  useEffect(() => {
    const el = track.current, ro = el && new ResizeObserver(() => setW(el.clientWidth))
    if (el) ro!.observe(el)
    return () => ro?.disconnect()
  }, [])
  const glyph = matchMedia('(pointer: coarse)').matches ? 22 : 16, px = (i: number) => (w - 12) * (i - floor) / (total - floor)
  const rank = (c: Cat) => (c === 'brilliant' ? 5.5 : CATS.indexOf(c)) // errors first (blunder worst), then brilliant over great
  const groups: NonNullable<typeof ticks>[] = []
  for (const k of ticks ?? []) {
    const gr = groups[groups.length - 1]
    if (gr && px(k.at) - px(gr[0].at) < glyph) gr.push(k); else groups.push([k])
  }
  return <>
    <div className="tl">
      <button className="chev" aria-pressed={auto} onClick={toggleAuto} disabled={live || total === floor} aria-label={t.autoplay} title={`${t.autoplay} (${t.space})`}>
        <Icon name={auto ? 'pause' : 'play'} />
      </button>
      <button className="chev" onClick={() => go(g.cursor - 1)} disabled={g.cursor <= floor} aria-label={t.prev} title={`${t.prev} (←)`}><Icon name="chevron-left" /></button>
      <span ref={track} className={`track${ticks?.length ? ' ticked' : ''}`}>
        <input type="range" min={floor} max={total} value={g.cursor} onChange={e => go(+e.target.value)} aria-label={t.history}
          aria-valuetext={t.move(g.moveNumber())} style={{ '--n': total - floor } as React.CSSProperties} />
        {forks.map(i => <i key={i} aria-hidden="true" style={{ left: at(i) }} />)}
        {groups.map(gr => {
          const cat = gr.reduce((a, k) => (rank(k.cat) > rank(a) ? k.cat : a), gr[0].cat), cur = gr.findIndex(k => k.at === g.cursor)
          return <button key={gr[0].at} className="tick" data-cat={cat} aria-current={cur >= 0 || undefined} style={{ left: at(gr[0].at) }}
            onClick={() => go(gr[(cur + 1) % gr.length].at)} aria-label={gr.map(k => k.label).join(', ')} title={gr.map(k => k.label).join('\n')}>
            <CatIcon cat={cat} size={16} /></button>
        })}
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
