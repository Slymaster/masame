# Jardin de bambous — credits

Both sources are **CC0 1.0 (public domain)**. Licence pages checked on 2026-10-20, the day of download.

## Lighting
- **Poly Haven — Ninomaru Teien** by Greg Zaal — https://polyhaven.com/a/ninomaru_teien — page licence line: "CC0".
  `ninomaru_teien_1k.hdr` is the 1K .hdr downloaded from
  https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/ninomaru_teien_1k.hdr, unchanged (1,892,935 bytes).
  It lights the décor and, blurred by three.js (`backgroundBlurriness`), shows behind the veranda when the eyes rise.
  The sun's azimuth used for `skyAz` (0.62 rad) was measured on this file (its brightest texel, 19.5° up).
  No 2K backdrop JPEG is shipped: the backdrop is drawn from the same PMREM environment, so a sharper file would not show.

## Sound
- **Freesound 570492 — "Ambiance_Natural_Forest_Birds_Wind_Loop_Stereo.wav"** by Nox_Sound —
  https://freesound.org/people/Nox_Sound/sounds/570492/ — page licence line: "Creative Commons 0".
  `forest.mp3` is cut from the HQ preview (https://cdn.freesound.org/previews/570/570492_9250976-hq.mp3, 29.95 s, stereo):
  downmixed to mono at 44.1 kHz, the first 29.9 s kept, the last 2 s crossfaded (quarter-sine) into the first 2 s and
  placed at the end, so the 27.9 s loop joins without a step (end-to-start sample step 0.0003, below the median step);
  encoded with LAME VBR `-q:a 3` (292 KB).

## Procedural (no files)
The leaf light (komorebi cookie), the cedar engawa planks, the fallen leaves and the green culms are drawn at runtime
in `src/board3d/scenes/bambous.ts`.
