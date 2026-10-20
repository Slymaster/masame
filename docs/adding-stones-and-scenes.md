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
     snd: { rate: 1, lowpass: 1, gain: 1 },   // multipliers on the stone sounds; optional place: '<id>/place.mp3' (below)
     skin2d: { black: [[r, g, b], …], white: [[r, g, b], …], marks: { black: 'none', white: 'growth' } },
     rare: undefined,               // an Unlock id for the four earned sets (wave 3)
   } satisfies StoneData
   ```

   **The 2D board** (the only board on phones) draws `skin2d`: a radial gradient through the colours (centre → rim), then the colour's mark clipped to the stone, then an optional rim glow and the highlight. Marks: `'none'`, `'growth'` (the Hyuga shell's lines), `'veins'` (jade, marble), `'bands'` (agate), `'bubbles'` (glass, amber), `'speckles'` (pebbles, granite), `'stars'` (nebula), `'cracks'` (ember, glowing), `'sheen'` (a brushed band, metal). The optional `finish: { black?, white? }` tunes each colour:

   ```ts
   finish: {
     black: { rim: { color: [90, 180, 120], strength: 0.4, width: 0.35 },   // a glow inside the rim: translucent stones
              highlight: { strength: 0.45, size: 0.3, color: [255, 220, 170] }, // the specular spot (glass, metal: smaller, stronger)
              mark: { color: [140, 200, 160], amount: 1, scale: 1, count: 1 },  // the mark's colour, opacity, size, number
              stops: [0, 0.3, 0.8, 1] },                                         // gradient stop positions (default: the Japanese spacing for 4 colours)
   },
   ```

   Without `finish` a set draws with the Japanese stones' highlight and edge. `snd` also scales the 2D board's synthesized clack (rate: pitch and length, lowpass: a cutoff of 12 kHz × the value when below 1, gain).

   **Its own placement sound** (optional): `snd.place` is a path under `assets/board3d/`, for example `'<id>/place.mp3'`. The file is laid out like the shared `place.mp3`: a mono MP3 of single placements, one per fixed **0.5 s slot** (slot k starts at k × 0.5 s; the hit is found by scanning each slot, so a little lead-in silence is fine; keep each hit and its ring under 0.45 s). Both boards load it lazily for that set, play a random slot instead of the shared sample, and still scale it by rate, lowpass and gain. The 2D board's first clack while it loads is the synthesized one. A missing or broken file falls back silently to the shared sound (3D: `place.mp3`, 2D: the synthesized clack). Captures keep their own sound.

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
   - `ambient`: a sound loop file under `assets/board3d/`. The ambience player (`ambience.ts`) plays it in 3D when the Atelier's ambient sound switch and the app's sound are on: very quiet (gain 0.1), looped without the MP3 padding gap, crossfaded over 1.5 s when the décor changes, asleep while the window is hidden.
   - `shoji > 0` turns on the key's cookie spot: the shoji lattice, or the scene's cookie. Set `ownCookie: true` when the
     share is meant for your scene's cookie: at fx 0 (no scene) the window then stays open instead of showing the Japanese lattice.
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
   - `renderer`, `key` (the window light), `base` (the asset folder), `board: { BW, BD, groundY }` (mm, the top at y = 0; `groundY` is the table or floor everything rests on, see "A goban shape").
   - `fx`: `1 | 2`, the quality level when the scene is built. Make no particles at 1. The scene is rebuilt when the level changes.
   - `setCookie(tex | null)`: a light cookie on the shoji spot (needs `Look.shoji > 0`).
   - `setGround({ map, bumpMap?, roughness?, tint? } | null)`: the scene's own table surface, with the same fade and shadows as a Look's ground, in both cameras. Board3D frees these textures with the scene; don't dispose them yourself.
   - `lamp`: the lamp spotlight (needs `Look.lamp > 0`; its intensity comes from the Look, its position from the key's bearing).
   - `setLampColor(color | null)`: an andon's warm paper, a red lantern. `null` uses the hour's colour temperature.
   - `setEnvironment(tex | null)`: your scene's own sky for reflections and `Look.backdrop` (an equirectangular texture you made, e.g. a starfield or a cloud sea); Board3D PMREMs and frees the PMREM, you dispose your texture. `null` = the Look's sky.
   - `setLampPose(pos | null, target?)`: where the lamp stands and what it lights (mm, the board top's centre is the origin), for a lamp you also model, such as an andon on the floor beside the board; its shadow camera follows. `null` hangs it on the key's bearing like the Lanterne's. Change the lamp only through these two calls.

   **`Scene`**:
   - `build(ctx)` may be async (it is awaited before the crossfade, and shaders compile under it).
   - `update(dt, t)`: seconds; `t` runs only while animated.
   - `dispose()` frees what `build()` made.
   - `animated`: false keeps rendering on demand.

   **When the animation runs**: at most 30 fps when nothing else moves (every frame while something does), at fx 2 (the two best quality levels), in Contemplation, with the window visible and focused and motion not reduced. It keeps running while stones fall or the camera glides, and pauses only during a crossfade; the governor's samples of busy frames include its small cost.
4. **Text**: `t.decors` / `t.decorHints`, plus the thumbnail.

A listed id without `looks/<id>.ts` is **pending**: `isReadyDecor(id)` is false, `readyDecors()` leaves it out, and `LOOKS[id]` is the Atelier's.

## A goban shape

1. **List it**: `'<id>',` in `GOBAN_SHAPES` (`gobans.ts`).
2. **Data, no three.js**: `gobans/<id>.ts` default-exports a `ShapeData` (mm). The playing surface is always the board top at y = 0, sized by `dims()`; a shape only says what lies under it.

   ```ts
   import type { ShapeData } from '../gobans'
   export default {
     thickness: 145,                   // the block
     round: 1.6,                       // edge rounding (the table board's 2.2)
     legs: {                           // optional: four turned legs standing on the ground
       height: 120,
       profile: [[0, 0], [24, 0], …],  // [radius, height] from the floor up to the block
       inset: [64, 68],                // each leg's axis from the block's sides (across, along); closer in on small boards (legInset)
       ridges: 6, depth: 0.12, sharp: true, // optional lobes round the leg (a gardenia fruit), relief as a share of the radius, crested
     },
     fold: { gap: 0.35 },              // optional: a folding board's seam across the middle (z = 0)
   } satisfies ShapeData
   ```

   The ground is at `groundY(shape) = -(thickness + legs.height)`: the table, or the floor under a legged goban. Board3D puts the bowls, their lids, the prisoners, the shadow catcher, the contact shadow under the board and the décor's table or floor there, and widens the shadow camera for the drop. The legs are merged into the board's mesh (one draw call, the board's material); a seam (`fold`) is drawn in the board's shader (`GOBAN_FOLD`), only for that shape. The seated camera does not move: it frames the board top, as before.
3. **Scenes**: everything a décor rests on the table or the floor uses `ctx.board.groundY` (never a fixed height); the scene is rebuilt when the shape changes, under the same crossfade as the board. Things placed relative to the board top (motes over it, petals beside it) keep their heights.

`view.setOptions({ goban: '<id>' })` in the demo page. A listed id without its file is pending: the table board.

## A wood

1. **List it**: `'<id>',` in `WOODS` (`gobans.ts`).
2. **Data, no three.js**: `woods/<id>.ts` default-exports a `WoodData`: a grading of the kaya scan (the 2D board and the app read this file). Every field is optional; kaya is `{}`.

   ```ts
   import type { WoodData } from '../gobans'
   export default {
     tint: [0.47, 0.442, 0.395],        // linear multipliers on the scan (kaya's)
     contrast: 1, saturation: 1,        // the grain's contrast around the wood's mean, its colour saturation (1 = the scan's)
     grain: { scale: 1, rotate: 0 },    // figure width (2 = twice as wide) and its turn on the top (rad)
     roughness: 1,                      // multiplier on the scan's roughness
     normal: 1,                         // scale of the scan's normal map (bamboo: ~0.15, so kaya's rings leave its reflections)
     clearcoat: 0.18, clearcoatRoughness: 0.4,
     snd: { rate: 1, lowpass: 1, gain: 1 },             // the stone-on-board knock, multiplied into the set's voice (3D and 2D)
     skin2d: { light: [224, 180, 110], dark: [176, 120, 58] }, // the 2D board's grain colours (sRGB); BoardView.setWood(id)
   } satisfies WoodData
   ```

   Contrast or saturation other than 1 compiles the grading in (`WOOD_GRADE`); kaya's shader is untouched.
3. **A pattern of its own (optional)**: `woods/<id>.gl.ts` default-exports `{ glsl }`, read by Board3D only. It defines two functions, compiled in under `WOOD_GL` with the program key `wood-<id>`:

   ```ts
   export default { glsl: /* glsl */`
     // c: the graded scan colour (linear); p: the board's object-space position (mm, the block centred on y = 0, the top at
     // y = thickness / 2, x across, z from player to player); n: the object-space normal (top: y > 0.6)
     vec3 woodColor(vec3 c, vec3 p, vec3 n) { return c; }
     float woodRough(float r, vec3 p, vec3 n) { return r; }` }
   ```

   Bamboo strips, for example: `woodColor` returns strips along `p.z` with a node every so often, ignoring most of the scan. The ink grid, the patina and the seam are applied after it.

`view.setOptions({ wood: '<id>' })` in the demo page. The bowls (mulberry) and the Atelier's walnut table keep their own look whatever the wood.

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

## Stone materials that move or age

- A set's material factories get `ctx = { hc, R, time, patina }`. `time` (s, shared) advances only while ambient animation may run (Contemplation, fx 2, focused, motion allowed, nothing else moving); set `animated: true` on the set's `StoneGL` export so the view renders continuously (≤ 30 fps) when that is allowed, otherwise the stones stay still at their last time.
- `patina` (0 … 1, shared) comes from `Board3DOptions.patina`: the Heirloom stones read it to age (the app computes it from the games in Mes parties).

## Earned sets

A set whose data has `rare: 'games10' | 'streak7' | 'review' | 'tsumego'` is earned (`src/stonesEarned.ts`, from the library, the ritual's streak and the exercises deck). Until then the gallery shows it with its condition and it can't be chosen; once earned it is announced once and stays earned (`masame.stones`). For captures, `localStorage.setItem('masame.unlockAll', '1')` (or `?unlock=1` in the URL) opens every set without announcing or remembering anything; the demo bench never locks a set.
