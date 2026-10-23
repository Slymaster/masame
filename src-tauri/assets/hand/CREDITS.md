# Opponent's hand

`hand-v1.glb`: the 3D hand that plays the AI's moves in the Contemplation view, when the "Opponent's hand" option is
on in the Workshop.

It is built into the desktop app (`src-tauri/src/hand.rs`, which also checks its size and SHA-256 in a test); the
phone apps leave it out.

## The model

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

To regenerate it, see the header of `scripts/hand-makehuman.py` (an isolated Blender profile, MPFB installed from its
zip, the two CC0 packs loaded with MPFB's own loader). It writes `hand-v2.glb` next to this file by default, never over v1.
