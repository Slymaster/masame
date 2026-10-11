// Dev only (main.tsx imports it under import.meta.env.DEV, so builds never contain it): a stand-in for the Tauri
// bridge for UI previews in a plain browser, driven by declarative JSON — nothing from sessionStorage is executed.
//
//   sessionStorage.setItem('baduk.devMock', JSON.stringify({ commands: {
//     networks_state: { ok: { installed: [], active: null, activeKey: null, downloading: [], human: 'b18c384nbt-humanv0' } },
//     engine_analyze: [{ ok: analysis }, { ok: analysis }, { err: { code: 'engine_stopped' } }], // per call, last repeats
//     networks_catalog: { ok: { entries: [], error: null }, delay: 800 },
//   } })); location.reload()
//
// Unlisted commands reject with { code: 'unmocked', detail: <command> }. From the console:
// window.__badukMock.emit('network-progress', {...}) fires an event; window.__badukMock.calls lists every invoke.

type Reply = { ok?: unknown; err?: { code: string; detail?: string }; delay?: number }
type Spec = { commands?: Record<string, Reply | Reply[]> }

const spec: Spec = JSON.parse(sessionStorage.getItem('baduk.devMock') ?? '{}')
const calls: { cmd: string; args: unknown }[] = []
const count: Record<string, number> = {}
const callbacks = new Map<number, (e: unknown) => void>()
const listeners: { event: string; id: number }[] = []
let nextId = 1

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  calls.push({ cmd, args })
  if (cmd === 'plugin:event|listen') {
    listeners.push({ event: args.event as string, id: args.handler as number })
    return args.handler
  }
  if (cmd.startsWith('plugin:event|')) return null
  const r = spec.commands?.[cmd]
  if (!r) throw { code: 'unmocked', detail: cmd }
  const n = (count[cmd] = (count[cmd] ?? 0) + 1)
  const reply = Array.isArray(r) ? r[Math.min(n, r.length) - 1] : r
  if (reply.delay) await new Promise(res => setTimeout(res, reply.delay))
  if (reply.err) throw reply.err
  return reply.ok ?? null
}

function emit(event: string, payload: unknown) {
  for (const l of listeners) if (l.event === event) callbacks.get(l.id)?.({ event, id: l.id, payload })
}

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke,
    transformCallback: (cb: (e: unknown) => void) => { const id = nextId++; callbacks.set(id, cb); return id },
    unregisterCallback: (id: number) => callbacks.delete(id),
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: {
    unregisterListener: (_event: string, id: number) => { const i = listeners.findIndex(l => l.id === id); if (i >= 0) listeners.splice(i, 1) },
  },
  __badukMock: { emit, calls },
})

export {} // a module, so main.tsx can import() it
