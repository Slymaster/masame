// A décor's scenery and life (leaves, snow, smoke…), one file per décor: scenes/<décor>.ts default-exports a factory
// `(): Scene`. Board3D mounts it with the décor, shows it only in Contemplation (fx ≥ 1), animates it only at fx 2, and
// disposes it when the décor changes. See docs/adding-stones-and-scenes.md.

import type * as THREE from 'three'
import type { Decor } from '../decors'

export interface SceneCtx {
  /** Add everything here: shown in Contemplation at fx ≥ 1 only (Study never sees it). */
  root: THREE.Group
  renderer: THREE.WebGLRenderer
  /** The window's light (Board3D sets its direction, colour and intensity each frame from the Look and the hour). */
  key: THREE.DirectionalLight
  /** Asset folder (`${BASE_URL}assets/board3d/`). */
  base: string
  /** Quality's fx level when the scene is built: 2 = animated, 1 = still. Size particle counts with it. */
  fx: 1 | 2
  /** The board top (mm), centred on the origin at y = 0. */
  board: { BW: number; BD: number }
  /** A light cookie on the shoji spot (the décor's Look.shoji share of the key, Contemplation); null = the shoji lattice. */
  setCookie(tex: THREE.Texture | null): void
}

export interface Scene {
  /** Builds into ctx.root; may load assets (awaited before the décor fades in, shaders compiled under the crossfade). */
  build(ctx: SceneCtx): void | Promise<void>
  /** One ambient step: dt and t in seconds (t only runs while the animation runs). At most AMBIENT_FPS a second. */
  update(dt: number, t: number): void
  /** Frees what build() made (geometries, materials, textures); the root group itself is Board3D's. */
  dispose(): void
  /** true if update() moves anything: the view then renders continuously (≤ 30 fps) when allowed, otherwise on demand. */
  readonly animated: boolean
}

/** One line per décor that has a scene. Décors without one (the first four) render exactly as before. */
export const SCENES: Partial<Record<Decor, () => Promise<{ default: () => Scene }>>> = {
}
