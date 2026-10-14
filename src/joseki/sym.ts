// Joseki geometry shared by the app and the Node generator (scripts/joseki), hence no imports.
// Vertices are [x, y] from the top-left; moves are 2-letter SGF-style codes ('pd' = Q16).

export type Pt = [number, number]
export const N = 19

/** The 8 board symmetries: bit 2 transposes, then bit 0 flips x, bit 1 flips y. */
export function sym(k: number, [x, y]: Pt): Pt {
  let a = x, b = y
  if (k & 4) [a, b] = [b, a]
  return [k & 1 ? N - 1 - a : a, k & 2 ? N - 1 - b : b]
}
const probe: Pt[] = [[1, 2], [5, 3]]
const find = (f: (v: Pt) => Pt) => [0, 1, 2, 3, 4, 5, 6, 7].find(k => probe.every(v => sym(k, v).join() === f(v).join()))!
/** compose(a, b) applies b, then a. */
export const compose = (a: number, b: number) => find(v => sym(a, sym(b, v)))
export const invert = (k: number) => find(v => sym(k, sym(k, sym(k, v)))) // every k has order 1, 2 or 4, so k³ = k⁻¹

/** The top-right corner's own reflection, (x, y) → (18−y, 18−x): it merges the 3-4 and 4-3 lines. */
export const MIRROR = 7
/** Where joseki moves are looked for: the top-right quadrant and a margin. Closed under MIRROR. */
export const REGION = ([x, y]: Pt) => x >= 7 && y <= 11

export const code = ([x, y]: Pt) => String.fromCharCode(97 + x, 97 + y)
export const point = (s: string): Pt => [s.charCodeAt(0) - 97, s.charCodeAt(1) - 97]

/** Whole-board context, alternating from Black: B D16, W D4, B Q4. White's root stone comes next, then Black plays. */
export const CONTEXT = ['dd', 'dp', 'pp']
export const ROOTS = [
  { name: '4-4', m: 'pd' }, { name: '3-4', m: 'qd' }, { name: '3-3', m: 'qc' }, { name: '5-3', m: 'qe' }, { name: '5-4', m: 'pe' },
]

/** Stones (signMap[y][x], 1 = Black) seen through symmetry k, as a 361-character string. */
export function stones(signMap: number[][], k = 0): string {
  const inv = invert(k)
  let s = ''
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [a, b] = sym(inv, [x, y]); s += 'o.x'[signMap[b][a] + 1] }
  return s
}
/** The smaller of the position and its MIRROR image; mirrored = the image was taken. */
export function canonical(signMap: number[][]) {
  const a = stones(signMap), b = stones(signMap, MIRROR)
  return b < a ? { s: b, mirrored: true } : { s: a, mirrored: false }
}
function fnv32(s: string, reverse = false) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(reverse ? s.length - 1 - i : i), 0x01000193)
  return h >>> 0
}
export const fnv = (s: string) => fnv32(s).toString(16).padStart(8, '0')
/** 64 bits in base 36: FNV-1a forward and backward, so thousands of keys stay far from a collision. */
export const hash64 = (s: string) => (BigInt(fnv32(s)) << 32n | BigInt(fnv32(s, true))).toString(36)
export const nodeKey = (ply: number, stones: string) => hash64(`${ply}|${ply % 2 ? 'B' : 'W'}|${stones}`)
/**
 * Key of a position `ply` moves after the context (odd = Black to play); transpositions and mirror images share it.
 * shortcut: the ko ban is not part of the key, so a position with and without a pending ko merge; add it if ko-heavy lines ever matter.
 */
export const positionKey = (signMap: number[][], ply: number) => nodeKey(ply, canonical(signMap).s)
