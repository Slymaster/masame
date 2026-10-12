// In-app updates: the pure parts (stored settings, the once-a-day launch check). The Rust side checks, downloads,
// verifies the signature and installs; the webview only asks it to (update_check, update_install).

export const DAY = 24 * 60 * 60 * 1000

/** What update_check returns for a newer release: install is false where the app can't replace itself (.deb, .rpm). */
export interface UpdateInfo { version: string; install: boolean }

/** Stored update settings, coerced: checks are on unless turned off, the last check time is a finite number. */
export const updateSettings = (j: { autoUpdate?: unknown; updateChecked?: unknown }) => ({
  autoUpdate: j.autoUpdate !== false,
  updateChecked: typeof j.updateChecked === 'number' && Number.isFinite(j.updateChecked) ? j.updateChecked : 0,
})

/** A launch check is due a day after the last one; a clock set back counts as elapsed too. */
export const checkDue = (now: number, last: number) => Math.abs(now - last) >= DAY
