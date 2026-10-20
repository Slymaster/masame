# Salle Honinbo: asset credits

## empty_play_room_night_1k.hdr

- Source: the shipped `empty_play_room_1k.hdr` (Poly Haven, "Empty Play Room" by Greg Zaal and Jarod Guest,
  https://polyhaven.com/a/empty_play_room, CC0; credited in `../CREDITS.md`). Nothing new was downloaded.
- Derived 2026-10-20, graded to a lamp-lit night room: a soft roll-off of luminance, L' = 0.5 L / (0.5 + L), so the windows,
  the sun patches on the floor and the ceiling lights sink to the room's own level without a seam; then 40 % of the colour kept
  and 60 % of the luminance tinted warm (×1.18, ×0.96, ×0.72), times 5. It only fills the reflections and the shade; the
  andon (the lamp) is the light.

## Sound

None of its own: the décor plays `hanok/room.mp3` (credited in `hanok/CREDITS.md`).

## Procedural (no files)

The andon, its paper and glow, the tokonoma, its post and lacquered edge, and the hanging scroll (abstract ink marks and a
plain seal, no real writing) are drawn or modelled at runtime in `src/board3d/scenes/honinbo.ts`. The room's layout is ours:
how a Honinbo go room was arranged is not documented.
