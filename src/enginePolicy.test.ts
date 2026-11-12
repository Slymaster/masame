import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyze } from './katago'
import { Game } from './game'
import { analysisTicket, acceptAnalysis, ogsAnalysisBlocked, setAnalysisBlocked } from './enginePolicy'
const native = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => native)
afterEach(() => { setAnalysisBlocked(false); vi.unstubAllGlobals(); native.invoke.mockReset() })

describe('OGS analysis policy', () => {
  it('blocks all joining, unfinished, offline and resynchronizing positions', () => {
    expect(ogsAnalysisBlocked(true, undefined, false)).toBe(true)
    for (const phase of ['play', 'stone removal']) {
      expect(ogsAnalysisBlocked(false, phase, false)).toBe(true)
      expect(ogsAnalysisBlocked(false, phase, true)).toBe(true)
    }
    expect(ogsAnalysisBlocked(false, 'finished', true)).toBe(true)
    expect(ogsAnalysisBlocked(false, 'finished', false)).toBe(false)
    expect(ogsAnalysisBlocked(false, undefined, false)).toBe(false)
  })
  it('rejects a real engine request before invoking the native bridge', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    setAnalysisBlocked(true)
    await expect(analyze(new Game({ size: 9 }), {})).rejects.toMatchObject({ code: 'ogs_engine_blocked' })
    expect(native.invoke).not.toHaveBeenCalled()
  })
  it('rejects late results even after the OGS board has been left', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    let answer!: (v: unknown) => void
    native.invoke.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const pending = analyze(new Game({ size: 9 }), {})
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalled())
    setAnalysisBlocked(true); setAnalysisBlocked(false)
    answer({ rootInfo: { winrate: 0.5, scoreLead: 1 } })
    await expect(pending).rejects.toMatchObject({ code: 'ogs_engine_blocked' })
    const fresh = analysisTicket()
    expect(() => acceptAnalysis(fresh)).not.toThrow()
  })
})
