# Board3D assets — credits

All third-party sources below are **CC0 1.0 (public domain)**. Licence pages checked on 2026-10-11.
Derived files were made with ffmpeg / Python (numpy, Pillow) from the originals; nothing here needs attribution,
but we keep the trail.

## Wood (board top, sides, bowls)
- **ambientCG — Wood095** (2K JPG: Color, NormalGL, Roughness) — https://ambientcg.com/view?id=Wood095
  Licence: CC0 1.0 (ambientCG states all its assets are CC0). Downloaded 2026-10-11.
  - `kaya_diff.jpg` (2048×1732): the clean straight-grain lower band of the scan, three strips stacked across the
    grain (horizontal rolls of the tileable scan, middle strip mirrored, 40 px feathered seams parallel to the
    fibres), graded to golden kaya (fibre contrast ×1.35, darker late wood slightly warmer).
  - `kaya_nor.jpg`: same stacking of the NormalGL map (mirrored strip has its X component flipped).
  - `kaya_rough.jpg` (1024×866): roughness derived from the fibre detail (the scan's own roughness is flat).
  - The bowls reuse `kaya_diff.jpg`, tinted to mulberry in the material.
  - The table in Contemplation reuses `kaya_diff.jpg` too, tiled and tinted to a dark walnut in the material.

## Lighting
- **Poly Haven — Studio Country Hall** (1K HDR) — https://polyhaven.com/a/studio_country_hall — CC0.
  `studio_country_hall_1k.hdr`, copied from the approved prototype (`design/atelier3d/assets/`). Décors Atelier and Lanterne.
- **Poly Haven — Empty Play Room** by Greg Zaal (photography) and Jarod Guest (processing) (1K HDR) — https://polyhaven.com/a/empty_play_room — CC0.
  `empty_play_room_1k.hdr`, copied unchanged from `design/atelier3d/assets/`. Décor Washitsu (window light).
- Décor Clair uses three.js's procedural `RoomEnvironment` (MIT, part of three); no file.

## Décor grounds
Tatami (igusa rushes, warp threads, heri borders) and washi paper are generated at runtime in a canvas
(`src/board3d/Board3D.ts`, `tatamiMaps` / `paperMap`): no files.

## Stone sounds (Freesound, all "Creative Commons 0" on the sound page; HQ previews used)
- **billhails2 — GoStoneSounds.ogg** — https://freesound.org/people/billhails2/sounds/588317/ — CC0. Downloaded 2026-10-11.
- **Hongsungbock — baduk2** — https://freesound.org/people/Hongsungbock/sounds/840425/ — CC0. Downloaded 2026-10-11.
- **MPooman — [ MPooman ] Play Go Sounds 2 (SE485) (High Quality)** — https://freesound.org/people/MPooman/sounds/668942/ — CC0. Downloaded 2026-10-11.

Derived files (mono 44.1 kHz MP3, LAME VBR q3), cut, faded and loudness-matched on the attack:
- `place.mp3`: 17 single placements in 0.5 s slots — 12 from Hongsungbock (crisp, short), 5 from billhails2 (fuller ring).
- `clicks.mp3`: 10 small stone-on-stone clicks from MPooman (46–68 s), 0.2 s slots; used to build the capture sound.
- `bowl.mp3`: 21.9 s of stones stirred in a bowl (MPooman 46.85–68.75 s), looped quietly while the AI thinks.
The capture ("stones onto the lid") is synthesised at runtime from these: a placement pitched down and low-passed
(the wooden lid) plus a few clicks.

## Code
three.js 0.186.1 (MIT), loaded from npm.
