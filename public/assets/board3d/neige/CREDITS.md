# Nuit de neige: asset credits

All three files are derived from CC0 sources. Licences checked on each asset's own page on 2026-10-20.

## birchwood_night_1k.hdr, backdrop_2k.jpg

- Source: Poly Haven, "Birchwood" HDRI by Sergej Majboroda, https://polyhaven.com/a/birchwood
- Licence: CC0 (as listed on the asset page).
- Downloaded: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/birchwood_1k.hdr` and the 2K `.hdr` from the same path, 2026-10-20.
- Derived: graded to night, the same way for both sizes. Each pixel keeps 20 % of its colour and takes 80 % of its
  luminance tinted moon blue (×0.58, ×0.78, ×1.18); the sky darkens towards the zenith (to 35 % at 60° and above); the
  low sun is capped at a luminance of 3 so it makes no hot spot. `birchwood_night_1k.hdr` is the graded 1K HDRI (the
  lighting and reflections). `backdrop_2k.jpg` is the graded 2K HDRI ×0.6, sRGB, Gaussian blur σ 3 px, JPEG q82: the
  blurred garden behind the room. The 2K HDRI itself is not shipped.

## wind.mp3

- Source: Freesound 637566, "forest light wind through bare trees winter GREAT FOR FALLING SNOW" by kyles,
  https://freesound.org/people/kyles/sounds/637566/
- Licence: Creative Commons 0 (as listed on the sound's page).
- Downloaded: the HQ preview, `https://cdn.freesound.org/previews/637/637566_612689-hq.mp3`, 2026-10-20.
- Derived: mono 44.1 kHz, the 38 s from 4 s in, its first 4 s crossfaded (equal power) with the 4 s after the cut so the
  loop joins without a seam; high-pass 40 Hz, low-pass 12 kHz, +23.4 dB (about −30 LUFS, peak −8.8 dBFS); MP3 VBR q3.
