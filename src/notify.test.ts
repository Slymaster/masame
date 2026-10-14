import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ tauri: true, focused: false, granted: true, store: new Map<string, string>() }))
vi.mock('./katago', () => ({ inTauri: () => host.tauri }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => host.granted),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: vi.fn(),
}))
vi.stubGlobal('document', { hasFocus: () => host.focused })
vi.stubGlobal('localStorage', {
  getItem: (k: string) => host.store.get(k) ?? null,
  setItem: (k: string, v: string) => { host.store.set(k, v) },
})
const plugin = await import('@tauri-apps/plugin-notification')
const { notify } = await import('./notify')

describe('notify', () => {
  beforeEach(() => { host.tauri = true; host.focused = false; host.store.clear(); vi.mocked(plugin.sendNotification).mockClear() })
  it('sends once per key, in the background only', async () => {
    await notify('a', 'Your move', 'body')
    await notify('a', 'Your move', 'body')
    expect(plugin.sendNotification).toHaveBeenCalledTimes(1)
    expect(plugin.sendNotification).toHaveBeenCalledWith({ title: 'Your move', body: 'body' })
    host.focused = true
    await notify('b', 'Focused')
    host.focused = false
    await notify('b', 'Seen while focused') // remembered even when focused
    expect(plugin.sendNotification).toHaveBeenCalledTimes(1)
  })
  it('stays silent outside Tauri, keeps the last 200 keys, survives broken storage', async () => {
    host.tauri = false
    await notify('c', 'x')
    expect(plugin.sendNotification).not.toHaveBeenCalled()
    for (let i = 0; i < 250; i++) await notify(`k${i}`, 'x')
    expect(JSON.parse(host.store.get('masame.ogs.seen')!)).toHaveLength(200)
    host.tauri = true
    host.store.set('masame.ogs.seen', '{garbage')
    await notify('d', 'x')
    expect(plugin.sendNotification).toHaveBeenCalledTimes(1)
  })
})
