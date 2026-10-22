# Hand models

## `hand-mh.glb` (what the prototype loads)

The right hand, wrist and the end of the forearm of a MakeHuman character (a young adult East Asian man), skinned on
MakeHuman's `game_engine` rig, the skin baked onto the hand's own UVs (1024² JPEG). Made headless in Blender 5.2 by
`scripts/hand-makehuman.py` with MPFB 2.0.18, the MakeHuman extension for Blender.

- MakeHuman base mesh, macro targets and `game_engine` rig and weights: CC0 (MakeHuman's assets, as shipped with MPFB)
- Skin `young_asian_male` (texture `young_lightskinned_male_diffuse3.png`): `makehuman_system_assets` pack, CC0
- Hand targets `mindfront_hand_fingers_correction`, `mindfront_hand_thenar_eminence`, `mindfront_hand_hypothenar`
  (Mindfront) and `jujube_knobby_knuckles` (jujube): `hands01` pack, CC0
- Tool: [MPFB](https://extensions.blender.org/add-ons/mpfb/) 2.0.18, GPL-3.0. It only made the model: no MPFB code is
  shipped, and MakeHuman states that what it outputs from its CC0 assets is CC0.
- Project: [MakeHuman](https://static.makehumancommunity.org/)

To regenerate it, see the header of `scripts/hand-makehuman.py` (an isolated Blender profile, MPFB installed from its zip,
the two CC0 packs loaded with MPFB's own loader).

## `right.glb`, `right-smooth.glb` (the earlier hand, kept for before/after comparisons)

`right.glb`: the right hand of the "generic-hand" profile, version 1.0.20 of `@webxr-input-profiles/assets`.

- Source: https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles/generic-hand/right.glb
- Project: [immersive-web/webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles)
- Licence: MIT ("Assets are available under MIT license", packages/assets README)

`right-smooth.glb`: the same hand after one level of Catmull–Clark subdivision, skin weights kept, made by
`scripts/hand-smooth.py` in Blender (headless). Same licence. Loaded with `?handModel=webxr` on board3d.html or
`hand.model('webxr')` in the console.

Used only by the dev prototype `src/board3d/hand.ts` (the opponent's hand on board3d.html); not part of the app build.
