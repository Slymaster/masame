// "Carte postale": the board as drawn, cropped to its frame, on a linen mount signed like a print (seal + Masame), as a PNG.

export type Rect = { x: number; y: number; w: number; h: number }

/** The frame (CSS px of a W×H canvas) clamped to the canvas, in device pixels at ratio r; null if nothing is left. */
export function cropRect(fr: Rect, W: number, H: number, r: number): Rect | null {
  const x0 = Math.max(0, fr.x), y0 = Math.max(0, fr.y), x1 = Math.min(W, fr.x + fr.w), y1 = Math.min(H, fr.y + fr.h)
  if (x1 <= x0 || y1 <= y0) return null
  const x = Math.round(x0 * r), y = Math.round(y0 * r)
  return { x, y, w: Math.round(x1 * r) - x, h: Math.round(y1 * r) - y }
}

/** Fonts the signature needs, loaded before the synchronous capture (a WebGL frame must be copied in the task that drew it). */
export const signatureFonts = () => Promise.all([document.fonts.load('italic 500 40px "Cormorant Garamond"'), document.fonts.ready]).then(() => {}, () => {})

/** Copies `c` of `src` onto a mount of the page's linen, signed under the image's right edge like a print. */
export function postcardCanvas(src: CanvasImageSource, c: Rect): HTMLCanvasElement {
  const u = Math.min(c.w, c.h) / 100, m = Math.round(4 * u), mb = Math.round(9 * u)
  const out = Object.assign(document.createElement('canvas'), { width: c.w + 2 * m, height: c.h + m + mb }), x = out.getContext('2d')!
  x.fillStyle = getComputedStyle(document.body).backgroundColor // a transparent Study background prints as paper
  x.fillRect(0, 0, out.width, out.height)
  x.drawImage(src, c.x, c.y, c.w, c.h, m, m, c.w, c.h)
  sign(x, m, c.w, c.h + m + mb / 2, u)
  return out
}

export const toPng = (c: HTMLCanvasElement) => new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))

/** The seal 柾, centred on (cx, cy), s wide, turned by deg degrees. */
function seal(x: CanvasRenderingContext2D, cx: number, cy: number, s: number, deg: number) {
  x.save()
  x.translate(cx, cy); x.rotate(deg * Math.PI / 180)
  x.fillStyle = '#8A2F22'; x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, s * 0.16); x.fill()
  x.fillStyle = '#F9F4EB'; x.font = `${s * 0.6}px 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP', serif`
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('柾', 0, s * 0.03)
  x.restore()
}

/** On the mount's lower band (centre line y): the seal 柾 and "Masame" in the title face, right under the image's edge. */
function sign(x: CanvasRenderingContext2D, m: number, w: number, y: number, u: number) {
  const s = 2.9 * u, fs = 2.6 * u, right = m + w
  seal(x, right - s / 2, y, s, -4)
  x.fillStyle = '#2A2118'; x.textAlign = 'right'; x.textBaseline = 'middle'
  x.font = `italic 500 ${fs}px 'Cormorant Garamond', Georgia, serif`
  x.fillText('Masame', right - s - 1.2 * u, y)
}

/** Splits `text` into lines no wider than `w` in the context's current font. */
export function wrap(x: Pick<CanvasRenderingContext2D, 'measureText'>, text: string, w: number): string[] {
  const out: string[] = []
  for (const word of text.split(' ')) {
    const l = out.length ? `${out[out.length - 1]} ${word}` : word
    if (out.length && x.measureText(l).width <= w) out[out.length - 1] = l
    else out.push(word)
  }
  return out
}

/** "La lettre du mois" as a print: a sheet of paper on the linen mount, the month's title, its sentences, signed like the postcard. */
export function letterCanvas(title: string, side: string, lines: string[]): HTMLCanvasElement {
  const W = 1600, u = W / 100, m = 6 * u, pad = 8 * u, tw = W - 2 * m - 2 * pad
  const fs = 3.1 * u, lh = fs * 1.45, ts = 5.2 * u, gap = 1.1 * fs, body = `italic 400 ${fs}px 'Cormorant Garamond', Georgia, serif`
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = body
  const wrapped = lines.map(l => wrap(measure, l, tw))
  const textH = wrapped.reduce((s, ls) => s + ls.length * lh, 0) + gap * (lines.length - 1)
  const inner = pad + ts * 1.2 + 3.4 * u + textH + pad + 4 * u // the sheet's height: title, rule, sentences, signature
  const out = Object.assign(document.createElement('canvas'), { width: W, height: Math.round(inner + 2 * m) }), x = out.getContext('2d')!
  x.fillStyle = '#ECE4D6'; x.fillRect(0, 0, out.width, out.height) // Washi's linen, whatever the skin: a letter is paper
  x.fillStyle = 'rgba(60, 40, 15, .10)'; x.fillRect(m + 0.25 * u, m + 0.4 * u, W - 2 * m, inner) // the sheet's shadow on the mount
  x.fillStyle = '#F9F4EB'; x.fillRect(m, m, W - 2 * m, inner)
  x.strokeStyle = 'rgba(43, 29, 14, .16)'; x.lineWidth = Math.max(1, 0.08 * u); x.strokeRect(m + 0.6 * u, m + 0.6 * u, W - 2 * m - 1.2 * u, inner - 1.2 * u)
  const left = m + pad
  let y = m + pad + ts
  x.textBaseline = 'alphabetic'; x.textAlign = 'left'
  x.fillStyle = '#2A2118'; x.font = `italic 500 ${ts}px 'Cormorant Garamond', Georgia, serif`
  x.fillText(title, left, y)
  if (side) { const w = x.measureText(title).width; x.fillStyle = '#6E5F4D'; x.font = body; x.fillText(` · ${side}`, left + w, y) }
  y += 0.9 * u
  x.strokeStyle = '#8A2F22'; x.lineWidth = 0.18 * u; x.beginPath(); x.moveTo(left, y + 1.2 * u); x.lineTo(left + 8 * u, y + 1.2 * u); x.stroke()
  y += 2.5 * u
  x.fillStyle = '#2A2118'; x.font = body
  wrapped.forEach((ls, i) => { if (i) y += gap; for (const l of ls) { y += lh; x.fillText(l, left, y) } })
  sign(x, m, W - 2 * m - pad, m + inner - pad * 0.7, u * 1.6)
  return out
}
