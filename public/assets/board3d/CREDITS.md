# Board3D assets — credits

All third-party sources below are **CC0 1.0 (public domain)**. Licence pages checked on 2026-10-11.
Derived files were made with ffmpeg / Python (numpy, Pillow) from the originals; nothing here needs attribution,
but we keep the trail.

## Wood (board top, sides, bowls)
- **ambientCG — Wood095** (2K and 4K JPG: Color, NormalGL, Roughness) — https://ambientcg.com/view?id=Wood095
  Licence: CC0 1.0 (ambientCG states all its assets are CC0). Downloaded 2026-10-11 (2K) and 2026-10-13 (4K).
  All the files below are made by `scripts/kaya-textures.py` (2K scan → `kaya_*.jpg`, 4K scan → `kaya_*_4k.jpg`).
  - `kaya_diff.jpg` (2048×1732): the clean straight-grain lower band of the scan, three strips stacked across the
    grain (horizontal rolls of the tileable scan, middle strip mirrored, 40 px feathered seams parallel to the
    fibres), graded to golden kaya (fibre contrast ×1.35, darker late wood slightly warmer).
  - `kaya_nor.jpg`: same stacking of the NormalGL map (mirrored strip has its X component flipped).
  - `kaya_rough.jpg` (1024×866): roughness derived from the fibre detail (the scan's own roughness is flat).
  - `kaya_diff_4k.jpg`, `kaya_nor_4k.jpg` (4096×3464), `kaya_rough_4k.jpg` (2048×1732): the same, from the 4K scan
    (crop, rolls and feather scaled ×2); loaded instead of the 2K set on the top quality levels.
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

## Décors and stone sounds added in 0.6
Each folder keeps its own `CREDITS.md` with the full trail (URLs, sizes, checksums, every derivation step); the summary
below follows it. All sources are CC0, licence lines checked on each asset's own page on 2026-10-20, the day of download.

- **[bambous](bambous/CREDITS.md)** (Jardin de bambous): Poly Haven **Ninomaru Teien** by Greg Zaal —
  https://polyhaven.com/a/ninomaru_teien — "CC0". `ninomaru_teien_1k.hdr` shipped unchanged (light, and the blurred
  backdrop through three.js). Freesound 570492 **Ambiance_Natural_Forest_Birds_Wind_Loop_Stereo.wav** by Nox_Sound —
  https://freesound.org/people/Nox_Sound/sounds/570492/ — "Creative Commons 0". `forest.mp3`: the HQ preview downmixed
  to mono, cut to 29.9 s and crossfaded into a 27.9 s seamless loop, LAME VBR q3.
- **[galets](galets/CREDITS.md)** (Galets stones): Freesound 704379 **small round pebbles on hardwood floor** by
  ellie.vanderlip — https://freesound.org/people/ellie.vanderlip/sounds/704379/ — "Creative Commons 0". `place.mp3`:
  12 single strikes cut before their first bounce, faded, peak-normalised and filtered, one per 0.5 s slot.
- **[hanami](hanami/CREDITS.md)** (Hanami): Poly Haven **Bryanston Park Sunrise** by Dario Barresi —
  https://polyhaven.com/a/bryanston_park_sunrise — "CC0 1.0 Universal - public domain dedication".
  `bryanston_park_sunrise_1k.hdr` unchanged; `backdrop_2k.jpg` from the 2K HDRI, luminance capped, blurred, JPEG q82.
  Sound: `bambous/forest.mp3`.
- **[hanok](hanok/CREDITS.md)** (Hanok): Poly Haven **Pine Attic** by Sergej Majboroda —
  https://polyhaven.com/a/pine_attic — CC0. `pine_attic_1k.hdr` unchanged (light and reflections only). Freesound 744447
  **Soft Room Tone** by callmethefoo — https://freesound.org/people/callmethefoo/sounds/744447/ — "Creative Commons 0".
  `room.mp3`: 30 s from 0:34 of the HQ preview, crossfaded into a seamless loop, mono, raised 14 dB, MP3 VBR q3.
- **[honinbo](honinbo/CREDITS.md)** (Salle Honinbo): nothing new downloaded. `empty_play_room_night_1k.hdr` is the
  shipped Empty Play Room HDRI (Greg Zaal and Jarod Guest, above) graded to a lamp-lit night room (soft luminance
  roll-off, warm tint). Sound: `hanok/room.mp3`.
- **[neige](neige/CREDITS.md)** (Nuit de neige): Poly Haven **Birchwood** by Sergej Majboroda —
  https://polyhaven.com/a/birchwood — CC0. `birchwood_night_1k.hdr` and `backdrop_2k.jpg` graded to night (moon-blue
  tint, darker zenith, capped sun; the backdrop blurred, JPEG q82). Freesound 637566 **forest light wind through bare
  trees winter GREAT FOR FALLING SNOW** by kyles — https://freesound.org/people/kyles/sounds/637566/ — "Creative
  Commons 0". `wind.mp3`: 38 s of the HQ preview, crossfaded into a seamless loop, mono, filtered, raised, MP3 VBR q3.
- **[nuages](nuages/CREDITS.md)** (Au-dessus des nuages): Poly Haven **Kloppenheim 06 (Pure Sky)** by Greg Zaal and
  Jarod Guest — https://polyhaven.com/a/kloppenheim_06_puresky — CC0. `kloppenheim_06_puresky_1k.hdr` unchanged;
  `backdrop_2k.jpg` the 2K HDRI's sky band, capped, blurred with wrap, JPEG q82. Sound: `neige/wind.mp3`.
- **[pavillon](pavillon/CREDITS.md)** (Pavillon du lettré): Poly Haven **Chinese Garden** by Andreas Mischok —
  https://polyhaven.com/a/chinese_garden — "CC0 1.0 Universal - public domain dedication". `chinese_garden_1k.hdr` with
  the sun disc capped at luminance 3 (the key light carries the sun); `backdrop_2k.jpg` from the 2K HDRI, capped,
  tone-mapped, blurred, JPEG q82. Sound: `bambous/forest.mp3`.
- **[pluie](pluie/CREDITS.md)** (Pluie sur la véranda): light from `bambous/ninomaru_teien_1k.hdr`. `backdrop_2k.jpg`
  from the 2K Ninomaru Teien HDRI (Greg Zaal, CC0) graded to a wet overcast day, blurred, JPEG q82. Freesound 232731
  **Rain Indoor Cabin (loop)** by PhilllChabbb — https://freesound.org/people/PhilllChabbb/sounds/232731/ — "Creative
  Commons 0". `rain.mp3`: 14.4 s of the HQ preview, crossfaded into a seamless loop, mono, filtered, MP3 VBR q3.
- **[verre](verre/CREDITS.md)** (Verre soufflé, Pierre de lune et obsidienne stones): Freesound 238886
  **FX_MARBLES_BAG_DROP_ON_WOOD.wav** by Olichite — https://freesound.org/people/Olichite/sounds/238886/ — "Creative
  Commons 0". `place.mp3`: 11 single glass clicks, each cut before the next marble touches, faded, filtered and
  loudness-matched, one per 0.5 s slot.

## Procedural (no files)
The stone sets (shapes and materials), the Cosmos décor, and the gobans' shapes (table, legged, folding), woods and
bamboo are made at runtime in code; no files. The scenes' own procedural parts are listed in each folder's `CREDITS.md`.

## Code
three.js 0.186.1 (MIT), loaded from npm.
