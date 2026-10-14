// System notifications for OGS events, each told once (across launches) and only while the window is in the background.
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { inTauri } from './katago'

const SEEN = 'masame.ogs.seen'
let allowed: Promise<boolean> | null = null // asked once per run

function firstTime(key: string) {
  let seen: string[] = []
  try { seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]') } catch { /* private mode or garbage */ }
  if (!Array.isArray(seen)) seen = []
  if (seen.includes(key)) return false
  try { localStorage.setItem(SEEN, JSON.stringify([...seen, key].slice(-200))) } catch { /* private mode */ }
  return true
}

export async function notify(key: string, title: string, body?: string) {
  if (!firstTime(key) || !inTauri() || document.hasFocus()) return
  allowed ??= isPermissionGranted().then(ok => ok || requestPermission().then(p => p === 'granted')).catch(() => false)
  if (await allowed) sendNotification(body ? { title, body } : { title })
}
