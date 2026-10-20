# Hanami: asset credits

Licence checked on the asset's own page on 2026-10-20, the day of download.

## bryanston_park_sunrise_1k.hdr, backdrop_2k.jpg

- Source: Poly Haven, "Bryanston Park Sunrise" HDRI by Dario Barresi, https://polyhaven.com/a/bryanston_park_sunrise
- Licence: CC0 (the page lists "CC0 1.0 Universal - public domain dedication").
- Downloaded: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/bryanston_park_sunrise_1k.hdr` and the 2K `.hdr` from
  the same path (`.../2k/bryanston_park_sunrise_2k.hdr`), 2026-10-20.
- `bryanston_park_sunrise_1k.hdr` is the 1K file, unchanged (1,646,618 bytes): it lights the décor and the stones'
  reflections. `skyAz` (0.80 rad) is its brightest texel's azimuth (the low sun, 5° up), measured on this file.
- `backdrop_2k.jpg` is the 2K HDRI ×0.6, luminance capped at 1.6 (the sun makes no hot spot), sRGB, Gaussian blur σ 4 px,
  JPEG q82: the blurred park behind the cherry trees when the eyes rise. The 2K HDRI itself is not shipped.

## Sound

The décor reuses the bamboo garden's loop, `bambous/forest.mp3` (Freesound 570492, see `../bambous/CREDITS.md`).

## Procedural (no files)

The light through the blossoming branches (the cookie), the cedar engawa (bambous' planks), the drifting and resting
petals and the cherry trees are drawn at runtime in `src/board3d/scenes/hanami.ts`.
