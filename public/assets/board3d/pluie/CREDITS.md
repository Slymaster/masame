# Pluie sur la véranda: asset credits

Licences checked on each asset's own page on 2026-10-20, the day of download.

## Lighting

The décor reuses the bamboo garden's HDRI, `bambous/ninomaru_teien_1k.hdr` (see `../bambous/CREDITS.md`), with a low,
very soft key for an overcast day. No new HDRI is shipped.

## backdrop_2k.jpg

- Source: Poly Haven, "Ninomaru Teien" HDRI by Greg Zaal, https://polyhaven.com/a/ninomaru_teien
- Licence: CC0 (as listed on the asset page).
- Downloaded: the 2K `.hdr`, `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/ninomaru_teien_2k.hdr`, 2026-10-20.
- Derived: graded to a wet overcast day: each pixel keeps 45 % of its colour and takes 55 % of its luminance (half
  desaturated), ×(0.90, 0.97, 1.08) cooler, the bright sky compressed (c / (1 + 1.2 L)), a 25 % grey haze (0.16) mixed in,
  luminance capped at 0.5; sRGB, Gaussian blur σ 6 px, JPEG q82: the blurred wet garden when the eyes rise. The 2K HDRI
  itself is not shipped.

## rain.mp3

- Source: Freesound 232731, "Rain Indoor Cabin (loop)" by PhilllChabbb, https://freesound.org/people/PhilllChabbb/sounds/232731/
- Licence: Creative Commons 0 (as listed on the sound's page).
- Downloaded: the HQ preview, `https://cdn.freesound.org/previews/232/232731_4205952-hq.mp3` (16.3 s, stereo), 2026-10-20.
- Derived: mono 44.1 kHz, the 14.4 s from 0.2 s in, its first 1.6 s crossfaded (equal power) with the 1.6 s after the
  cut so the loop joins without a seam (end-to-start step 5.5e-4, median sample step 4.6e-4); high-pass 60 Hz, low-pass
  12 kHz, +3 dB (RMS −41 dBFS, peak −25.8 dBFS, the level of the other décors' loops); MP3 VBR q3 (153 KB).

## Procedural (no files)

The rain, the eaves' drips, the rings on the wet gravel, the wet outer planks and the cedar engawa (bambous' planks) are
drawn at runtime in `src/board3d/scenes/pluie.ts`.
