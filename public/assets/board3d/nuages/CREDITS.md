# Au-dessus des nuages: asset credits

Both files derive from one CC0 source. Licence checked on the asset's own page on 2026-10-20.

## kloppenheim_06_puresky_1k.hdr, backdrop_2k.jpg

- Source: Poly Haven, "Kloppenheim 06 (Pure Sky)" HDRI by Greg Zaal (original) and Jarod Guest (sky edits),
  https://polyhaven.com/a/kloppenheim_06_puresky
- Licence: CC0 (as listed on the asset page).
- Downloaded: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_puresky_1k.hdr` (shipped unchanged,
  md5 995d68b1656f26452572645c0ffe898b) and the 2K `.hdr` from the same path, 2026-10-20.
- Derived: `backdrop_2k.jpg` is the 2K HDRI's upper half plus 5.625° below the horizon (2048 × 544), ×0.55, its
  luminance capped at 0.7 so the sun makes no hot spot, sRGB, Gaussian blur σ 2 px with the image wrapped left to right
  (no seam), JPEG q82: the dawn sky behind the terrace. The 2K HDRI itself is not shipped.

The cloud sea, the ridges and the drifting wisps are procedural (shaders in `src/board3d/scenes/nuages.ts`). The wind
loop is the Nuit de neige's `neige/wind.mp3` (see `../neige/CREDITS.md`).
