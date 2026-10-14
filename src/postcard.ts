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

/** On the mount's lower band (centre line y): the seal 柾 and "Masame" in the title face, right under the image's edge. */
function sign(x: CanvasRenderingContext2D, m: number, w: number, y: number, u: number) {
  const s = 2.9 * u, fs = 2.6 * u, right = m + w
  x.save()
  x.translate(right - s / 2, y); x.rotate(-4 * Math.PI / 180)
  x.fillStyle = '#8A2F22'; x.beginPath(); x.roundRect(-s / 2, -s / 2, s, s, s * 0.16); x.fill()
  x.fillStyle = '#F9F4EB'; x.font = `${s * 0.6}px 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif CJK JP', serif`
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('柾', 0, s * 0.03)
  x.restore()
  x.fillStyle = '#2A2118'; x.textAlign = 'right'; x.textBaseline = 'middle'
  x.font = `italic 500 ${fs}px 'Cormorant Garamond', Georgia, serif`
  x.fillText('Masame', right - s - 1.2 * u, y)
}
