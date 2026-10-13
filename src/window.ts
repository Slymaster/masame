import { useEffect, useState } from 'react'
import { inTauri } from './katago'

// Loaded on demand, like the rest of the Tauri API (src/katago.ts, src/files.ts).
const win = async () => (await import('@tauri-apps/api/window')).getCurrentWindow()

/** Full screen (F11 on Windows and Linux, the menu on macOS): the window's state, re-read on every resize, and a setter. */
export function useFullscreen() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!inTauri()) return
    const read = () => { win().then(w => w.isFullscreen()).then(setOn, console.error) }
    read()
    addEventListener('resize', read)
    return () => removeEventListener('resize', read)
  }, [])
  const set = (v: boolean) => { if (inTauri()) win().then(w => w.setFullscreen(v)).catch(console.error) }
  return [on, set] as const
}

/** The native frame follows the card's skin: a dark title bar on Windows 11 with the Laque card, not a white one. */
export function useWindowTheme(skin: 'washi' | 'laque') {
  useEffect(() => { if (inTauri()) win().then(w => w.setTheme(skin === 'laque' ? 'dark' : 'light')).catch(console.error) }, [skin])
}
