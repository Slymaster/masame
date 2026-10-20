// Canvas Gaussian blur that also works in WebKit (WKWebView on macOS and iOS), which ignores CanvasRenderingContext2D.filter.
// No three.js here: the 2D board uses it.

let works: boolean | undefined
/** Whether ctx.filter = 'blur()' really blurs here (Chromium yes, WebKit no); tested once. */
export function filterBlurWorks() {
  if (works === undefined) {
    const x = Object.assign(document.createElement('canvas'), { width: 9, height: 9 }).getContext('2d')!
    x.filter = 'blur(2px)'; x.fillRect(4, 4, 1, 1)
    works = x.getImageData(4, 4, 1, 1).data[3] < 128 // unblurred, the dot stays fully opaque
  }
  return works
}

/** The fallback's plan: blur on a copy whose pixels are `p` source pixels wide (a power of two, at most σ), by `s` of its
 *  own pixels (≥ ~1, so the smooth upscale has nothing sharp left to show). The halvings (a box of p, variance (p²-1)/12)
 *  and the bilinear upscale (a tent of p, (p²-1)/6) already spread the image; that variance is taken off σ² here. */
export function blurPlan(sigma: number) {
  let p = 1
  while (p * 2 <= sigma) p *= 2
  return { p, s: Math.sqrt(Math.max(0, sigma * sigma - (p * p - 1) / 4)) / p }
}

/** Gaussian blur (σ in px) of RGBA pixels in place, in premultiplied alpha like the canvas filter; outside is transparent. */
export function gaussBlur(d: Uint8ClampedArray, w: number, h: number, sigma: number) {
  if (sigma <= 0) return
  const R = Math.ceil(sigma * 3), k = new Float32Array(2 * R + 1)
  let ks = 0
  for (let i = 0; i <= 2 * R; i++) ks += k[i] = Math.exp(-((i - R) ** 2) / (2 * sigma * sigma))
  for (let i = 0; i <= 2 * R; i++) k[i] /= ks
  const a = new Float32Array(w * h * 4), b = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h * 4; i += 4) { const al = d[i + 3] / 255; a[i] = d[i] * al; a[i + 1] = d[i + 1] * al; a[i + 2] = d[i + 2] * al; a[i + 3] = d[i + 3] }
  // blurs each row of a w×h image and writes it transposed: twice gives both axes, and every read runs along a row
  const pass = (src: Float32Array, dst: Float32Array, w: number, h: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, bl = 0, al = 0
      for (let j = Math.max(-R, -x), J = Math.min(R, w - 1 - x); j <= J; j++) {
        const o = (y * w + x + j) * 4, kk = k[j + R]
        r += kk * src[o]; g += kk * src[o + 1]; bl += kk * src[o + 2]; al += kk * src[o + 3]
      }
      const o = (x * h + y) * 4
      dst[o] = r; dst[o + 1] = g; dst[o + 2] = bl; dst[o + 3] = al
    }
  }
  pass(a, b, w, h); pass(b, a, h, w)
  for (let i = 0; i < w * h * 4; i += 4) {
    const al = a[i + 3], u = al > 0 ? 255 / al : 0
    d[i] = a[i] * u; d[i + 1] = a[i + 1] * u; d[i + 2] = a[i + 2] * u; d[i + 3] = al
  }
}

const mk = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h })

/** Draws `src` at (0, 0), blurred by σ px, with the context's current transform and compositing. Where the canvas filter
 *  works this is exactly `filter = blur(σpx)`; elsewhere a halved copy is blurred on the CPU and smoothly scaled back. */
export function drawBlurred(x: CanvasRenderingContext2D, src: HTMLCanvasElement, sigma: number) {
  if (filterBlurWorks()) {
    const f = x.filter
    x.filter = `blur(${sigma}px)`; x.drawImage(src, 0, 0); x.filter = f
    return
  }
  const { p, s } = blurPlan(sigma)
  let c = src
  for (let q = 1; q < p; q *= 2) { // each exact halving averages 2×2 pixels: no aliasing, unlike one big downscale
    const n = mk(Math.ceil(c.width / 2), Math.ceil(c.height / 2))
    n.getContext('2d')!.drawImage(c, 0, 0, c.width / 2, c.height / 2)
    c = n
  }
  const im = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
  gaussBlur(im.data, c.width, c.height, s)
  c = mk(c.width, c.height)
  c.getContext('2d')!.putImageData(im, 0, 0)
  const sm = x.imageSmoothingEnabled
  x.imageSmoothingEnabled = true; x.drawImage(c, 0, 0, c.width * p, c.height * p); x.imageSmoothingEnabled = sm
}
