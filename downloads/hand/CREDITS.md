# Opponent's hand

`hand-v1.glb`: the 3D hand that plays the AI's moves in the Contemplation view, when the "Opponent's hand" option is
on in the Workshop.

It is not bundled with Masame. The desktop app downloads it once from this folder
(`https://raw.githubusercontent.com/Slymaster/masame/main/downloads/hand/hand-v1.glb`) when the option is turned on,
checks its size and SHA-256 against the values pinned in `src-tauri/src/hand.rs`, and keeps it in the app's data folder
(`hand/`). Changing this file means re-pinning those values, or the app refuses it.

For now it is a stand-in: `src/board3d/hand/right-smooth.glb`, the right hand of the "generic-hand" profile of
`@webxr-input-profiles/assets` 1.0.20 ([immersive-web/webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles)),
subdivided once in Blender. Licence: MIT. The final hand (MakeHuman) will replace it.
