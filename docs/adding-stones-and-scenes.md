# Adding a stone set or a décor

Everything lives in `src/board3d/`. Adding a set or a décor means adding files plus one line in a list. You don't edit `Board3D.ts`.

## A stone set

1. **List it**: add `'<id>',` on its own line in `STONE_SETS` (`stoneSets.ts`).
2. **Data, no three.js**: `sets/<id>.ts` default-exports a `StoneData`. The 2D board and the app read this file, so it must never import three.

   ```ts
   import type { StoneData } from '../stoneSets'
   export default {
     rB: 11.1, rW: 10.95,           // radii (mm): 10.6–11.3
     shTop: 4.5, shBot: 4.5,        // dome height above / below the girdle (mm); (shTop + shBot) / 2 in 3.8–5.5
     expTop: 0.78, expBot: 0.78,    // profile exponents (lens()): smaller = fuller dome
     snd: { rate: 1, lowpass: 1, gain: 1 },   // multipliers on the stone sounds
     skin2d: { black: [[r, g, b], …], white: [[r, g, b], …], marks: { black: 'none', white: 'growth' } },
     rare: undefined,               // an Unlock id for the four earned sets (wave 3)
   } satisfies StoneData
   ```

   A single-convex stone (Chinese yunzi: flat underneath, domed on top) gets a small, nearly flat bottom, for example `shTop: 6.6, shBot: 0.8, expTop: 0.7, expBot: 0.25`. A small `expBot` gives a rounded rim around a flat base. Everything that touches the board uses the right half: the rest height (the girdle sits at `shBot`), the drop, picking, the contact shadow, the bowls and lids, the last-move ring and the counting tiles (both on the top).
3. **Materials**: `sets/<id>.gl.ts` default-exports `{ black, white } satisfies StoneGL`. Each one is `(ctx: { hc, R }) => THREE.MeshPhysicalMaterial`.
   - Use `stoneVS(shader)` from `stoneGlsl.ts` in `onBeforeCompile`. It gives you `vObj` (object-space position in mm) and `vSeed` (0..1 per stone), plus `vnoise`/`h21`. All per-stone variation comes from `vSeed`. There is no per-stone geometry, and a stone stays under about 2,000 triangles.
   - `ctx.hc` is the high-contrast uniform (0..1, live). `ctx.R` is that colour's radius.
   - Give each material its own `customProgramCacheKey` (for example `'<id>-black'`).
   - Clear coat: Board3D scales the material's own `clearcoat` per view (it is softer in Study and in high contrast). Set the value you want for Contemplation.
   - No `transmission` (it costs a second render). For translucency, use the shell's `lights_fragment_end` rim trick in `sets/japonaise.gl.ts`.
   - Everything else is derived automatically: the dying stone (`dimOf`), the hover ghost (`ghostOf`) and the mentor's stopped stone (`pendingOf`).
4. **Text**: `t.stoneSets` / `t.stoneHints` in `src/i18n/en.ts` and `fr.ts`, plus the gallery thumbnail (owned by the app and gallery stream).

A listed id without both files is **pending**: `isReadySet(id)` is false, `readySets()` leaves it out, and `STONES[id]` / `STONE_DATA[id]` are the Japanese set. Nothing crashes.

## A décor

1. **List it**: add `'<id>',` on its own line in `DECORS` (`decors.ts`).
2. **Look, no three.js**: `looks/<id>.ts` default-exports a `Look` (`import type { Look } from '../logic'`). The fields are documented on `Look` in `logic.ts`. The new optional ones:
   - `backdrop: { blur, intensity }`: the décor's HDRI shown behind the room in Contemplation (`backgroundBlurriness`).
   - `skin: 'washi' | 'laque' | 'byCamera'`: the UI card's skin. It defaults to Washi.
   - `tiltMax`: how high the seated camera may tilt, in radians from vertical. The default is 58°; outdoor décors can go up to about 80°.
   - `ambient`: a sound loop file under `assets/board3d/` (carried here; the ambience player reads it).
   - `shoji > 0` turns on the key's cookie spot: the shoji lattice, or the scene's cookie.
   - `lamp > 0` turns on the lamp.
3. **Scene (optional)**: `scenes/<id>.ts` default-exports a factory `(): Scene`. It is found by file name and loaded lazily when the décor is chosen.

   ```ts
   import type { Scene } from '.'
   import { cookie, particles, skyDome } from '../fx'
   export default (): Scene => {
     let snow: ReturnType<typeof particles>
     return {
       animated: true,
       build(ctx) { snow = particles('snow', [-1400, -60, -2200, 1400, 900, -700], ctx.fx === 2 ? 1500 : 0); ctx.root.add(snow.mesh) },
       update(dt, t) { snow.update(t) },
       dispose() { snow.dispose() },
     }
   }
   ```

   **`SceneCtx`**:
   - `root`: add everything here. It shows only in Contemplation at fx ≥ 1.
   - `renderer`, `key` (the window light), `base` (the asset folder), `board: { BW, BD }` (mm, the top at y = 0).
   - `fx`: `1 | 2`, the quality level when the scene is built. Make no particles at 1. The scene is rebuilt when the level changes.
   - `setCookie(tex | null)`: a light cookie on the shoji spot (needs `Look.shoji > 0`).
   - `setGround({ map, bumpMap?, roughness?, tint? } | null)`: the scene's own table surface, with the same fade and shadows as a Look's ground, in both cameras. Board3D frees these textures with the scene; don't dispose them yourself.
   - `lamp`: the lamp spotlight (needs `Look.lamp > 0`; its intensity comes from the Look, its position from the key's bearing).
   - `setLampColor(color | null)`: an andon's warm paper, a red lantern. `null` uses the hour's colour temperature.

   **`Scene`**:
   - `build(ctx)` may be async (it is awaited before the crossfade, and shaders compile under it).
   - `update(dt, t)`: seconds; `t` runs only while animated.
   - `dispose()` frees what `build()` made.
   - `animated`: false keeps rendering on demand.

   **When the animation runs**: at most 30 fps, at fx 2 (the two best quality levels), in Contemplation, with the window visible and focused, motion not reduced, and nothing else moving. The governor never samples these frames.
4. **Text**: `t.decors` / `t.decorHints`, plus the thumbnail.

A listed id without `looks/<id>.ts` is **pending**: `isReadyDecor(id)` is false, `readyDecors()` leaves it out, and `LOOKS[id]` is the Atelier's.

## Effects (`fx.ts`, Contemplation only)

- `particles(kind | look, box, count, fadeY = box floor, seed)`
  - `kind`: `'snow' | 'petals' | 'rain' | 'smoke' | 'dust'`; the presets are in `PARTICLES`, and you can pass your own `ParticleLook`.
  - `box`: `[x0, y0, z0, x1, y1, z1]` in world mm.
  - Everything moves on the GPU; `update(t)` only sets a uniform. Particles fade out by `fadeY`, so they never land on the board.
  - Returns `{ mesh, material, update, dispose }`.
- `cookie(paint(ctx2d, t, S), size = 256, fps = 15)`: an animated light cookie, linear (white = full light). Pass its `texture` to `ctx.setCookie`, and call `update(t)` in the scene's update.
- `skyDome(glsl?, uniforms?)`: a sky behind everything, for décors without an HDRI. `glsl` defines `vec3 sky(vec3 dir)` (linear colour; `uT` is available). The default is a gradient.
- The blurred HDRI backdrop is `Look.backdrop`. No code is needed.

Keep readability: in Study nothing from the scene shows. In Contemplation, a leaf cookie never darkens the board by more than 25 %, and no particle covers an intersection.

## Trying things in the demo page

Run `pnpm dev`, open `http://localhost:1420/board3d.html`; `view` is on `window`.

- `view.setOptions({ stones: '<id>', decor: '<id>', camera: 'contemplation', time: 'afternoon' })`.
- `view.debug.look({ … })` changes the current décor's Look live (for example `{ backdrop: { blur: 0.25, intensity: 0.6 }, shoji: 0.4 }`).
- `const m = await import('/src/board3d/scenes/demo.ts'); await view.debug.scene(m.default)` mounts any scene factory on the current décor (`m.only('petals')`…). `view.debug.scene(null)` goes back to the décor's own scene.
- `view.debug.setQuality(0..4)` sets the level (fx 2, 2, 1, 1, 0). `view.debug.ambient` reports `{ on, t, scene }`. `view.debug.bench(60)` gives ms per frame.
- `view.debug.closeUp([x, z], dist, tilt)` gives a stone macro; `view.debug.sample(points)` renders everything settled and reads pixels.
- **App frame**: `view.resize(1280, 860, { left: 44.8, top: 44, width: 803.2, height: 788 })`.
- **Saving PNGs**: call `view.debug.sample([[0, 0]])`, then `view.renderer.domElement.toDataURL('image/png')` in the same task, and POST it to a small receiver on 127.0.0.1.
- The ambient animation needs the page focused (`document.hasFocus()`). A hidden preview pane is never focused.

## Checking the default is unchanged

Capture the four first décors in Study and Contemplation at morning, afternoon and evening, plus a full 19×19 (counting, Ombre with ghost and coordinates). Do this before and after your change at quality 0 after a fresh load, then compare with `magick compare -metric AE`. Two runs of the same build differ by 0 px, so any difference is real.
