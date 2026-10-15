// The one platform check in the UI: macOS uses ⌘ shortcuts and has a native menu bar; Windows/Linux use Ctrl.
/** The iOS or Android webview: no updater, menu bar or keyboard shortcuts. */
export const isMobile = /iPhone|iPad|iPod|Android/.test(globalThis.navigator?.userAgent || '')
export const isMac = !isMobile && /Mac/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '')

/** A Cmd/Ctrl shortcut as shown in hints and tooltips: ⌘Z on macOS, Ctrl+Z elsewhere. */
export const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`)
