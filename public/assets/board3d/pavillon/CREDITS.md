# Pavillon du lettré: asset credits

Both files are derived from one CC0 source. Licence checked on the asset's own page on 2026-10-20, the day of download.

## chinese_garden_1k.hdr, backdrop_2k.jpg

- Source: Poly Haven, "Chinese Garden" HDRI by Andreas Mischok, https://polyhaven.com/a/chinese_garden
- Licence: CC0 (the page's licence line: "CC0 1.0 Universal - public domain dedication").
- Downloaded: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/chinese_garden_1k.hdr` (md5 5e216fb65dce7564799c32e71baa3544)
  and the 2K `.hdr` from the same path (md5 e4c2abb3d679f68cdc5324a96d62704c), 2026-10-20.
- Derived:
  - `chinese_garden_1k.hdr`: the sun disc capped. In the original the disc holds 71 % of the map's energy (luminance up to
    68 000); every texel's luminance is capped at 3, colour kept. The key light carries the sun instead, so the shadows stay
    soft and the stones show no hard sun spot. Nothing else changed. The sun's azimuth (`skyAz` 0.635 rad, 30° up) was measured
    on the original 1K file (its brightest texel).
  - `backdrop_2k.jpg`: the garden seen past the pavilion when the eyes rise. The 2K HDRI, the same cap, exposure ×2.2,
    tone curve x / (1 + x), sRGB, Gaussian blur σ 3 px (wrapped across the seam), JPEG q82. The 2K HDRI itself is not shipped.

## Sound

None of its own: the décor plays `bambous/forest.mp3` (credited in `bambous/CREDITS.md`).

## Procedural (no files)

The huanghuali table, the inkstone, the brush rest and brush, the bronze censer and its incense smoke, and the pavilion's
columns and rail are drawn or modelled at runtime in `src/board3d/scenes/pavillon.ts`.
