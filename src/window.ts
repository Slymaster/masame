import { useEffect, useState } from 'react'
import { inTauri } from './katago'

// Loaded on demand, like the rest of the Tauri API (src/katago.ts, src/files.ts).
const win = async () => (await import('@tauri-apps/api/window')).getCurrentWindow()

/** Full screen (F11 on Windows and Linux, the menu on macOS): the window's state, re-read after resizes, and a setter. */
export function useFullscreen() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!inTauri()) return
    const read = () => { win().then(w => w.isFullscreen()).then(setOn, console.error) }
    // one IPC call once a resize settles, not one per resize event
    let timer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => { clearTimeout(timer); timer = setTimeout(read, 150) }
    read()
    addEventListener('resize', onResize)
    return () => { clearTimeout(timer); removeEventListener('resize', onResize) }
  }, [])
  const set = (v: boolean) => { if (inTauri()) win().then(w => w.setFullscreen(v)).catch(console.error) }
  return [on, set] as const
}

/** The native frame follows the card's skin: a dark title bar on Windows 11 with the Laque card, not a white one. */
export function useWindowTheme(skin: 'washi' | 'laque') {
  useEffect(() => { if (inTauri()) win().then(w => w.setTheme(skin === 'laque' ? 'dark' : 'light')).catch(console.error) }, [skin])
}
