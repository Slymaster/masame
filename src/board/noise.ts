// Deterministic noise helpers: the wood grain and each stone's variation must look identical on every redraw.

export function hash(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, -2048144777)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable random stream per intersection, so a stone keeps its look across redraws. */
export const stoneRng = (x: number, y: number, salt: number) => rng(Math.floor(hash(x, y, salt) * 4294967296))

const T1 = new Float32Array(4096)
{
  const r = rng(7)
  for (let i = 0; i < 4096; i++) T1[i] = r()
}
/** 1D smooth value noise. */
export function n1(u: number): number {
  const i = Math.floor(u), f = u - i, a = T1[i & 4095], b = T1[(i + 1) & 4095]
  return a + (b - a) * f * f * (3 - 2 * f)
}
/** 2D smooth value noise. */
export function vn2(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s)
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const TAU = Math.PI * 2
export const sstep = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t) }
