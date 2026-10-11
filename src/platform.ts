// The one platform check in the UI: macOS uses ⌘ shortcuts and has a native menu bar; Windows/Linux use Ctrl.
export const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '')

/** A Cmd/Ctrl shortcut as shown in hints and tooltips: ⌘Z on macOS, Ctrl+Z elsewhere. */
export const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`)
