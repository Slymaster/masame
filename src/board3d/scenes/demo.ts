// Debug only (not in SCENES): proves the fx primitives in the demo page. In /board3d.html, Contemplation:
//   const m = await import('/src/board3d/scenes/demo.ts'); await view.debug.scene(m.default)          // snow + leaves + sky
//   await view.debug.scene(() => m.only('petals'))                                                    // one kind at a time
// The leaf cookie needs a décor whose Look has a shoji share (the Washitsu), or view.debug.look({ shoji: 0.4 }).
import { cookie, particles, skyDome, type ParticleKind } from '../fx'
import type { Scene } from '.'

/** Moving leaf shadows: two layers of soft blobs drifting at different speeds over the full light (white). */
export const leaves = (x: CanvasRenderingContext2D, t: number, S: number) => {
  x.fillStyle = '#fff'; x.fillRect(0, 0, S, S)
  for (const [n, k, a, sp] of [[26, 0.09, 0.35, 0.6], [16, 0.14, 0.25, 0.35]]) {
    x.filter = `blur(${(S * k * 0.25).toFixed(1)}px)`; x.fillStyle = `rgba(0,0,0,${a})`
    for (let i = 0; i < n; i++) {
      const ph = i * 2.399, cx = (0.5 + 0.45 * Math.sin(ph * 3.1)) * S + Math.sin(t * sp + ph) * S * 0.03, cy = (0.5 + 0.45 * Math.cos(ph * 1.7)) * S + Math.cos(t * sp * 0.8 + ph) * S * 0.02
      x.beginPath(); x.ellipse(cx, cy, S * k, S * k * 0.45, ph + 0.2 * Math.sin(t * sp + i), 0, Math.PI * 2); x.fill()
    }
  }
  x.filter = 'none'
}

export function only(kind: ParticleKind | 'all'): Scene {
  const parts: ReturnType<typeof particles>[] = []
  let sky: ReturnType<typeof skyDome> | null = null, leafy: ReturnType<typeof cookie> | null = null
  return {
    animated: true,
    build(ctx) {
      const kinds: ParticleKind[] = kind === 'all' ? ['snow'] : [kind]
      for (const k of kinds) {
        // far beyond the board (a garden past the veranda), and a few right over it that fade out 120 mm above the wood
        parts.push(particles(k, [-1400, -60, -2200, 1400, 900, -700], ctx.fx === 2 ? 1500 : 0), particles(k, [-260, 40, -260, 260, 420, 260], ctx.fx === 2 ? 120 : 0, 120, 2))
      }
      if (kind === 'smoke') parts.splice(0, parts.length, particles('smoke', [-330, 0, -120, -300, 360, -90], 60, 20, 3)) // an incense stick by the board
      for (const p of parts) ctx.root.add(p.mesh)
      if (kind === 'all') {
        sky = skyDome(); ctx.root.add(sky.mesh)
        leafy = cookie(leaves); ctx.setCookie(leafy.texture)
      }
    },
    update(_dt, t) { for (const p of parts) p.update(t); leafy?.update(t) },
    dispose() { for (const p of parts) p.dispose(); sky?.dispose(); leafy?.dispose() },
  }
}

export default () => only('all')
