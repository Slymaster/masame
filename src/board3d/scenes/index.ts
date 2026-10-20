// A décor's scenery and life (leaves, snow, smoke…), one file per décor: scenes/<décor>.ts default-exports a factory
// `(): Scene`, found by file name (no table to edit). Board3D mounts it with the décor, shows it only in Contemplation (fx ≥ 1), animates it only at fx 2, and
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
  /**
   * The scene's own ground on the table (engawa planks, a stone terrace…; canvas-made like tatamiMaps/paperMap), with the
   * same fade and shadows as a Look's ground, in both cameras; null = back to the Look's ground. Board3D frees its
   * textures with the scene (or when replaced): don't dispose them in dispose().
   */
  setGround(g: SceneGround | null): void
  /** The Lanterne's lamp, on when Look.lamp > 0 (intensity from it, position on the key's bearing, set by Board3D).
   *  Change it only through setLampColor and setLampPose: Board3D owns its other settings. */
  lamp: THREE.SpotLight
  /** The lamp's colour (an andon's warm paper, a red lantern); null = the hour's colour temperature. */
  setLampColor(c: THREE.Color | null): void
  /** Where the lamp stands and what it lights (mm, the board top's centre is the origin), e.g. an andon on the floor beside
   *  the board, its shadow camera fitted to that distance; null = hanging on the key's bearing like the Lanterne's. */
  setLampPose(pos: THREE.Vector3 | null, target?: THREE.Vector3): void
  /** The scene's own environment: an equirectangular texture it made (a starfield, a cloud sea), PMREM'd and freed by
   *  Board3D; it replaces the Look's sky in reflections and in Look.backdrop while the scene is mounted. null = the Look's.
   *  The texture you pass stays yours: dispose it in dispose(). */
  setEnvironment(tex: THREE.Texture | null): void
}

/** A ground for the table: tile it yourself (wrap, repeat over the 3200 mm table, colour space). tint multiplies its colour (default 1). */
export interface SceneGround { map: THREE.Texture; bumpMap?: THREE.Texture | null; roughness?: number; tint?: number }

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

/** Every scenes/<décor>.ts, loaded when its décor is chosen. Décors without one (the first four) render exactly as before. */
const FILES = import.meta.glob<{ default: () => Scene }>(['./*.ts', '!./index.ts', '!./demo.ts', '!./*.test.ts'])
export const SCENES = Object.fromEntries(Object.entries(FILES).map(([f, load]) => [f.slice(2, -3), load])) as Partial<Record<Decor, () => Promise<{ default: () => Scene }>>>
