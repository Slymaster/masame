// The small { v: 1, … } stores in localStorage (counting, classics, tsumego, today): a newer Masame's store is never
// overwritten, and an unreadable one is kept under `${key}.bad` before the fresh start, like the journal and the decks.
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
const newer = (j: unknown) => Number.isFinite((j as { v?: number } | null)?.v) && (j as { v: number }).v > 1

/** The stored v1 value when `ok` accepts it; null when absent, newer or unreadable (that one is kept aside). */
export function readV1<T>(key: string, ok: (j: { v: 1 } & Record<string, unknown>) => boolean, st: Storage): T | null {
  let raw: string | null
  try { raw = st.getItem(key) } catch { return null } // storage disabled
  if (raw === null) return null
  try {
    const j = JSON.parse(raw)
    if (newer(j)) return null
    if (j?.v === 1 && ok(j)) return j as T
  } catch { /* garbage: below */ }
  try { st.setItem(`${key}.bad`, raw) } catch { /* full: the fresh start still beats a crash */ }
  return null
}

/** Writes the value unless a newer Masame wrote this key. */
export function writeV1(key: string, value: unknown, st: Storage) {
  try { if (newer(JSON.parse(st.getItem(key) ?? 'null'))) return } catch { /* garbage: already kept aside by readV1 */ }
  try { st.setItem(key, JSON.stringify(value)) } catch { /* private mode or full: this session only */ }
}
