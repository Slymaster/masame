import type { Cat } from './classify'

export type Skin = 'washi' | 'laque'

// Japanese pigments. Washi: deep tones, ≥ 4.5:1 against paper (#F9F4EB, the seal's symbol) and the sheet (#F1EADD);
// Laque: light tones, ≥ 4.5:1 against the lacquer sheet (#1B1612, also the seal's symbol there).
export const CAT_COLORS: Record<Cat, [washi: string, laque: string]> = {
  brilliant: ['#22706B', '#6CC0B5'], // seiheki, blue-green
  great: ['#2D4F94', '#93AEE6'], // gunjō, ultramarine
  best: ['#2F6B3F', '#7EC28C'], // wakatake, bamboo green
  excellent: ['#4F6A1F', '#AFC66A'], // moegi, sprout green
  good: ['#6A5F2E', '#C7BA7E'], // uguisu, warbler olive
  book: ['#7A5A3A', '#C9A681'], // kōiro, incense tan
  inaccuracy: ['#8A5F00', '#E6B84A'], // yamabuki, kerria yellow
  mistake: ['#A2470F', '#EE9358'], // kaki, persimmon
  miss: ['#A33A55', '#EE8DA2'], // sango, coral
  blunder: ['#8E1A24', '#F06A6A'], // enji, crimson
}
export const catColor = (cat: Cat, skin: Skin) => CAT_COLORS[cat][skin === 'washi' ? 0 : 1]

// Symbols on a 24-unit grid, stroked in round caps ("h0" draws a dot); `fill` paths are also filled.
const q = (x: number, k = 1) => // a question mark at x, k = width scale (paired marks are narrower)
  `M${x - 3 * k} 9.3a${3 * k} ${3 * k} 0 1 1 ${4.3 * k} ${2.7 * k}c${-.9 * k} ${.45 * k} ${-1.3 * k} ${1.1 * k} ${-1.3 * k} ${2 * k}v.4M${x} 17.6h0`
const bang = (x: number) => `M${x} 6.4v7.4M${x} 17.6h0`
const star = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 ? 2.9 : 6.6, a = (i * 36 - 90) * Math.PI / 180
  return `${i ? 'L' : 'M'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12.6 + r * Math.sin(a)).toFixed(2)}`
}).join('') + 'z'
export const CAT_SYMBOLS: Record<Cat, { d: string; fill?: true; w?: number }> = {
  brilliant: { d: bang(9) + bang(15) },
  great: { d: bang(12) },
  best: { d: star, fill: true, w: 1.6 },
  excellent: { d: 'M12 6.6a5.4 5.4 0 1 0 0 10.8a5.4 5.4 0 1 0 0-10.8zM12 12h0', w: 2.1 }, // ◎, the Japanese "very good"
  good: { d: 'M7.2 12.4l3.3 3.3L16.8 9' },
  book: { d: 'M5.2 7.6c2.5-1 4.9-.8 6.8.8c1.9-1.6 4.3-1.8 6.8-.8v9c-2.5-1-4.9-.8-6.8.8c-1.9-1.6-4.3-1.8-6.8-.8zM12 8.4v9', w: 1.7 },
  inaccuracy: { d: q(9.2, .85) + bang(16) },
  mistake: { d: q(12) },
  miss: { d: 'M8.3 8.3l7.4 7.4M15.7 8.3l-7.4 7.4' },
  blunder: { d: q(8.2, .8) + q(15.8, .8) },
}
