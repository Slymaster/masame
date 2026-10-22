# Hand model

`right.glb`: the right hand of the "generic-hand" profile, version 1.0.20 of `@webxr-input-profiles/assets`.

- Source: https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles/generic-hand/right.glb
- Project: [immersive-web/webxr-input-profiles](https://github.com/immersive-web/webxr-input-profiles)
- Licence: MIT ("Assets are available under MIT license", packages/assets README)

`right-smooth.glb` (what the prototype loads): the same hand after one level of Catmull–Clark subdivision, skin
weights kept, made by `scripts/hand-smooth.py` in Blender (headless). Same licence.

Used only by the dev prototype `src/board3d/hand.ts` (the opponent's hand on board3d.html); not part of the app build.
