// Yunzi materials (three.js): a matte, lightly oiled green-black whose thin rim glows dark emerald against the light, and
// a soft eggshell white, slightly translucent at the rim, with no growth lines.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built). glow: the black's rim light; wrap: the white's light through its rim. */
export const TUNE = {
  black: 0x141917, blackRough: 0.5, blackCoat: 0.12, blackCoatRough: 0.5, glow: 0.55, glowTint: [0.03, 0.3, 0.22],
  white: 0xf5f1e3, whiteRough: 0.4, whiteCoat: 0.16, whiteCoatRough: 0.45, wrap: 0.14, whiteGlow: 0.05,
}
const v3 = (c: number[]) => `vec3(${c.map(x => x.toFixed(3)).join(', ')})`

export function yunziBlack({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.black, roughness: T.blackRough, metalness: 0, specularIntensity: 0.6,
    clearcoat: T.blackCoat, clearcoatRoughness: T.blackCoatRough, // a light oiling, never a polish
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sd * 0.31);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { float n = vnoise(vObj.xz * 0.9 + sd); n = mix(n, 0.5, smoothstep(0.4, 1.2, fwidth(vObj.x * 0.9)));
          roughnessFactor = clamp(roughnessFactor * (0.88 + 0.24 * n), 0.08, 1.0); }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // fake translucency: light passing through the thin rim comes out dark emerald, most against the light
          float thin = smoothstep(0.6, 1.0, rr) * (1.0 - 0.75 * uHC);
          vec3 G = ${v3(T.glowTint)} * ${T.glow.toFixed(3)};
          reflectedLight.indirectDiffuse += G * (irradiance + iblIrradiance) * thin * thin * 0.08;
          #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[0].direction; float nl = dot(normal, L);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          float back = pow(clamp(dot(-geometryViewDir, L), 0.0, 1.0), 2.0);
          reflectedLight.directDiffuse += directionalLights[0].color * G * thin * (0.05 * wrap + 0.12 * back);
          #endif
        }`)
  }
  m.customProgramCacheKey = () => 'yunzi-black'
  return m
}

export function yunziWhite({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.white, roughness: T.whiteRough, metalness: 0, specularIntensity: 0.7,
    clearcoat: T.whiteCoat, clearcoatRoughness: T.whiteCoatRough,
    sheen: 0.35, sheenColor: new THREE.Color(0xfff4e0), sheenRoughness: 0.6, // the eggshell's soft bloom
    emissive: new THREE.Color(T.whiteGlow, T.whiteGlow * 0.97, T.whiteGlow * 0.9), // a little light comes back out
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        { // a faint cloudy density, no lines; the thin rim a shade warmer and deeper (a firm dark rim in high contrast)
          float n = 0.6 * vnoise(vObj.xz * 0.35 + sd) + 0.4 * vnoise(vObj.xz * 0.9 - sd);
          n = mix(n, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 0.9)));
          diffuseColor.rgb *= (0.985 + 0.02 * fract(sd * 0.41)) * (1.0 - 0.035 * n * (1.0 - uHC));
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.93, 0.9, 0.82), vec3(0.35, 0.31, 0.27), uHC), smoothstep(0.75 + 0.1 * uHC, 1.0, rr) * (0.5 + 0.5 * uHC));
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // the window's light wraps warm through the thin rim
          float rim = smoothstep(0.6, 1.0, rr) * (1.0 - uHC), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.45) / 1.45, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.86, 0.66) * diffuseColor.rgb * wrap * rim * ${T.wrap.toFixed(3)};
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'yunzi-white'
  return m
}

export default { black: yunziBlack, white: yunziWhite } satisfies StoneGL
