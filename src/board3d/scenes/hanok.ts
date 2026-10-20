// Hanok: a hanji-papered lattice door's soft light on the board (the shoji spot's cookie) and an oiled jangpan paper
// floor (laminated hanji, finished with soybean and perilla oil: a warm satin sheen). Both are canvas-made and still.
import * as THREE from 'three'
import type { Scene } from '.'
import { blurCanvas } from '../fx'

const COOKIE_MM = 3200 // the shoji spot's cookie spans 2 × SHOJI_R (Board3D) at its distance
const FLOOR_MM = 1200, TABLE_MM = 3200

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const canvas = (S: number) => Object.assign(document.createElement('canvas'), { width: S, height: S })

const FLOOR = { rgb: [204, 174, 126], rough: 0.4 } // honey: the floor's colour is ours (not sourced)

/**
 * The door's light (linear, white = full light): wooden bars leave light behind them (the hanji around them glows),
 * the paper softens every edge and adds its own faint cloudiness. Ttisal: fine vertical slats, a group of three
 * horizontal ones every ~780 mm (top, middle, bottom of a door); the stiles between door leaves darker. On the board a
 * bar darkens it by ≤ 25 % (measured, cookie vs open window, 99th percentile over the free intersections: 17–20 %).
 */
function latticeCookie(S = 1024) {
  const k = S / COOKIE_MM, cv = canvas(S), x = cv.getContext('2d')!, tmp = canvas(S), t = tmp.getContext('2d')!, r = rng(7)
  const BAR = 0.42, FRAME = 0.3, v = (a: number) => { const c = Math.round(255 * a); return `rgb(${c},${c},${c})` }
  t.fillStyle = '#fff'; t.fillRect(0, 0, S, S)
  const ox = S / 2 + 130 * k, oz = S / 2 - 90 * k, door = 860 * k, rail = 780 * k // a door's width and its slat groups' pitch (mm)
  t.fillStyle = v(BAR)
  const pitch = 48 * k, w = 14 * k
  for (let u = ox % pitch - pitch; u < S + pitch; u += pitch) t.fillRect(u - w / 2, 0, w, S)
  for (let g = oz % rail - rail; g < S + rail; g += rail) for (const d of [-40, 0, 40]) t.fillRect(0, g + d * k - w / 2, S, w)
  t.fillStyle = v(FRAME) // stiles between the door leaves
  for (let d = ox % door - door; d < S + door; d += door) t.fillRect(d - 36 * k, 0, 72 * k, S)
  // the paper's own light: faint clouds of thicker pulp
  t.globalCompositeOperation = 'multiply'
  for (let i = 0; i < 60; i++) {
    const cx = r() * S, cy = r() * S, rad = (80 + r() * 260) * k, g = t.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, `rgba(222,222,222,${0.25 + 0.3 * r()})`); g.addColorStop(1, 'rgba(255,255,255,0)')
    t.fillStyle = g; t.fillRect(cx - rad, cy - rad, 2 * rad, 2 * rad)
  }
  x.drawImage(tmp, 0, 0); blurCanvas(cv, 3 * k, 0) // the paper's 3 mm softening, by hand: WebKit ignores ctx.filter
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

/**
 * Jangpan: large hanji sheets laid in staggered rows, each overlapping its neighbours by ~18 mm (two layers of oiled
 * paper: a darker, richer band with a fine edge), each sheet a slightly different tone, soft clouds where the oil soaked
 * deeper, faint fibres. Drawn wrapped so it tiles (FLOOR_MM square). Returns colour + height canvases.
 */
function jangpanMaps(f = FLOOR, S = 2048) {
  const k = S / FLOOR_MM, r = rng(23), col = canvas(S), hgt = canvas(S), c = col.getContext('2d')!, h = hgt.getContext('2d')!
  const wrapped = (draw: (ox: number, oy: number) => void) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) draw(ox, oy) }
  const rgb = (m: number, a = 1) => `rgba(${f.rgb.map(v => Math.round(Math.min(255, v * m))).join(',')},${a})`
  c.fillStyle = rgb(1); c.fillRect(0, 0, S, S); h.fillStyle = '#808080'; h.fillRect(0, 0, S, S)
  const rows = 3, sw = S / 2, sh = S / rows, lap = 18 * k
  for (let j = 0; j < rows; j++) for (let i = 0; i < 2; i++) {
    const x0 = i * sw + (j % 2) * sw / 2 + (r() - 0.5) * 6 * k, y0 = j * sh + (r() - 0.5) * 6 * k, tone = 0.9 + 0.14 * r()
    wrapped((ox, oy) => {
      // the sheet over its left and upper neighbours: their double layer shows as a deeper band, its cut edge a fine line
      c.fillStyle = rgb(tone); c.fillRect(x0 + ox - lap, y0 + oy - lap, sw + lap, sh + lap)
      const band = (bx: number, by: number, bw: number, bh: number, gx: number, gy: number) => {
        const g = c.createLinearGradient(bx, by, bx + gx, by + gy)
        g.addColorStop(0, rgb(0.72 * tone, 0.8)); g.addColorStop(1, rgb(0.9 * tone, 0))
        c.fillStyle = g; c.fillRect(bx, by, bw, bh)
      }
      band(x0 + ox - lap, y0 + oy - lap, lap * 1.8, sh + lap, lap * 1.8, 0)
      band(x0 + ox - lap, y0 + oy - lap, sw + lap, lap * 1.8, 0, lap * 1.8)
      c.fillStyle = rgb(0.5 * tone, 0.8); c.fillRect(x0 + ox - lap, y0 + oy - lap, 2, sh + lap); c.fillRect(x0 + ox - lap, y0 + oy - lap, sw + lap, 2)
      h.fillStyle = '#909090'; h.fillRect(x0 + ox - lap, y0 + oy - lap, sw + lap, sh + lap)
      h.fillStyle = '#9c9c9c'; h.fillRect(x0 + ox - lap, y0 + oy - lap, lap, sh + lap); h.fillRect(x0 + ox - lap, y0 + oy - lap, sw + lap, lap)
    })
  }
  for (let n = 0; n < 70; n++) { // where the oil soaked deeper, or the paper is thinner
    const cx = r() * S, cy = r() * S, rad = (60 + r() * 240) * k, dark = r() < 0.6
    wrapped((ox, oy) => {
      const g = c.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, rad)
      g.addColorStop(0, dark ? rgb(0.82, 0.12) : rgb(1.08, 0.1)); g.addColorStop(1, rgb(1, 0))
      c.fillStyle = g; c.fillRect(cx + ox - rad, cy + oy - rad, 2 * rad, 2 * rad)
    })
  }
  c.lineCap = 'round'
  for (let n = 0; n < 2600; n++) { // mulberry fibres under the oil
    const x0 = r() * S, y0 = r() * S, a = r() * Math.PI * 2, len = (14 + r() * 60) * k, bend = (r() - 0.5) * len * 0.6
    const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len, mx = (x0 + x1) / 2 - Math.sin(a) * bend, my = (y0 + y1) / 2 + Math.cos(a) * bend
    c.strokeStyle = r() < 0.5 ? rgb(1.12, 0.18 + r() * 0.14) : rgb(0.78, 0.1 + r() * 0.08); c.lineWidth = 0.7 + r() * 1.3
    wrapped((ox, oy) => { c.beginPath(); c.moveTo(x0 + ox, y0 + oy); c.quadraticCurveTo(mx + ox, my + oy, x1 + ox, y1 + oy); c.stroke() })
  }
  // the paper's grain: fine pulp noise in colour and height (it catches the oiled sheen)
  for (const [cx, amp] of [[c, 7], [h, 26]] as const) {
    const im = cx.getImageData(0, 0, S, S), d = im.data
    for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n }
    cx.putImageData(im, 0, 0)
  }
  return [col, hgt]
}

export default (): Scene => {
  let light: THREE.Texture | null = null
  return {
    animated: false,
    build(ctx) {
      light = latticeCookie(); ctx.setCookie(light)
      const [c, hm] = jangpanMaps(), an = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
      const tile = (t: THREE.Texture, srgb: boolean) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(TABLE_MM / FLOOR_MM, TABLE_MM / FLOOR_MM); t.anisotropy = an
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        return t
      }
      ctx.setGround({ map: tile(new THREE.CanvasTexture(c), true), bumpMap: tile(new THREE.CanvasTexture(hm), false), roughness: FLOOR.rough })
    },
    update() {},
    dispose() { light?.dispose(); light = null },
  }
}
