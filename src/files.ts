import { t } from './i18n'

// SGF file I/O: native dialogs + fs plugin inside Tauri, file picker / download fallback in a plain browser.

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

/** Returns false if the user cancelled. */
export async function saveSgfFile(text: string, defaultName: string): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    const path = await save({ title: t.saveTitle, filters: filters(), defaultPath: defaultName })
    if (!path) return false
    await writeTextFile(path, text)
    return true
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-go-sgf' }))
  Object.assign(document.createElement('a'), { href: url, download: defaultName }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/** Asks before discarding unsaved moves; true = go ahead. */
export async function confirmDiscard(): Promise<boolean> {
  const msg = t.discardAsk
  if (isTauri()) return (await import('@tauri-apps/plugin-dialog')).ask(msg, { title: 'Masame', kind: 'warning', okLabel: t.discard, cancelLabel: t.cancel })
  return window.confirm(msg)
}
