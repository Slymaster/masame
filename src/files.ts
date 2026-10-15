import { t } from './i18n'

// SGF (and postcard PNG) file I/O: native dialogs + fs plugin inside Tauri, file picker / download fallback in a plain browser.

const isTauri = () => '__TAURI_INTERNALS__' in window
const filters = () => [{ name: t.sgfFilter, extensions: ['sgf'] }]

/** Returns the file text, or null if the user cancelled. */
export async function openSgfFile(): Promise<string | null> {
  if (isTauri()) {
    const [{ open }, { readTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    const path = await open({ title: t.openTitle, filters: filters(), multiple: false, directory: false })
    return path ? readTextFile(path) : null
  }
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.sgf' })
  return new Promise(resolve => {
    input.onchange = () => resolve(input.files?.[0]?.text() ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Returns false if the user cancelled. `ext` 'json' saves other data (joseki progress) through the same dialog. */
export async function saveSgfFile(text: string, defaultName: string, ext: 'sgf' | 'json' = 'sgf'): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    const path = await save({ title: ext === 'sgf' ? t.saveTitle : t.exportTitle, filters: ext === 'sgf' ? filters() : [{ name: 'JSON', extensions: ['json'] }], defaultPath: defaultName })
    if (!path) return false
    await writeTextFile(path, text)
    return true
  }
  const url = URL.createObjectURL(new Blob([text], { type: ext === 'sgf' ? 'application/x-go-sgf' : 'application/json' }))
  Object.assign(document.createElement('a'), { href: url, download: defaultName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** A PNG (the postcard, the kifu); returns false if the user cancelled. */
export async function savePngFile(png: Blob, defaultName: string, title = t.postcardTitle): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    const path = await save({ title, filters: [{ name: 'PNG', extensions: ['png'] }], defaultPath: defaultName })
    if (!path) return false
    await writeFile(path, new Uint8Array(await png.arrayBuffer()))
    return true
  }
  const url = URL.createObjectURL(png)
  Object.assign(document.createElement('a'), { href: url, download: defaultName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** A yes/no question before something that can't be taken back; true = go ahead. */
export async function askFirst(msg: string, okLabel: string): Promise<boolean> {
  if (isTauri()) return (await import('@tauri-apps/plugin-dialog')).ask(msg, { title: 'Masame', kind: 'warning', okLabel, cancelLabel: t.cancel })
  return window.confirm(msg)
}

/** Asks before discarding unsaved moves. */
export const confirmDiscard = () => askFirst(t.discardAsk, t.discard)
