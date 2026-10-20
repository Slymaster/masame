// Bronze and silver materials (three.js): dark bronze under a soft olive-brown patina that differs per stone, warm in its
// highlights, and satin hand-polished silver. A metal shows its room, so the silver is kept the white stone everywhere:
// a little under fully metallic over a light base (part of it lit like a pale stone), a satin polish that averages the room
// instead of mirroring a dark corner, and a faint floor of its own light. The bronze stays clearly darker.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built). */
export const TUNE = {
  bronze: 0x52422a, bronzeMetal: 0.9, bronzeRough: 0.2, patina: 0x262616, patinaAmt: 0.6,
  silver: 0xf8f9fb, silverMetal: 0.78, silverRough: 0.17, satin: 0.2, satinFreq: 16, lift: 0.24, avg: 3,
}
const f = (x: number) => x.toFixed(3)
const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}
const vec = (c: number) => { const k = new THREE.Color(c); return `vec3(${f(k.r)}, ${f(k.g)}, ${f(k.b)})` } // linear

export function bronze({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.bronze, metalness: T.bronzeMetal, roughness: T.bronzeRough,
    specularColor: new THREE.Color(0xffd8a8), specularIntensity: 0.6,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        // a soft patina in clouds, more on some stones than others, gathering a little towards the girdle
        float pn = 0.6 * vnoise(vObj.xz * 0.16 + sd) + 0.4 * vnoise(vObj.xz * 0.45 - sd);
        pn = mix(pn, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 0.45)));
        float pat = clamp(${f(T.patinaAmt)} * (0.35 + 0.9 * fract(sd * 0.37)) * smoothstep(0.25, 0.8, pn + 0.25 * rr), 0.0, 1.0);
        diffuseColor.rgb *= 0.92 + 0.16 * fract(sd * 0.31); // castings differ by a hair
        diffuseColor.rgb = mix(diffuseColor.rgb, ${vec(T.patina)}, pat);
        diffuseColor.rgb *= 1.0 - 0.45 * uHC; // high contrast: darker still`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.22 * pat, 0.08, 1.0); // the patina is duller than the metal`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= 1.0 - 0.35 * pat;`)
  }
  m.customProgramCacheKey = () => 'bronze-black'
  return m
}

export function silver({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.silver, metalness: T.silverMetal, roughness: T.silverRough,
    emissive: new THREE.Color(T.lift, T.lift, T.lift * 1.04), // the silver never sinks below a pale grey
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.985 + 0.03 * fract(sd * 0.41);
        diffuseColor.rgb *= mix(1.0, 0.4, smoothstep(0.84, 1.0, rr) * uHC); // a firm dark rim in high contrast`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { // hand polishing: fine criss-cross satin marks, a broad uneven sheen; they fade before they alias
          float an = fract(sd * 0.173) * 3.1416; vec2 d1 = vec2(cos(an), sin(an)), d2 = vec2(-d1.y, d1.x);
          float s1 = vnoise(vec2(dot(vObj.xz, d1) * ${f(T.satinFreq)}, dot(vObj.xz, d2) * 0.4) + sd);
          float s2 = vnoise(vec2(dot(vObj.xz, d2) * ${f(T.satinFreq * 1.17)}, dot(vObj.xz, d1) * 0.5) - sd);
          float fine = mix(0.5 * (s1 + s2), 0.5, smoothstep(0.15, 0.5, fwidth(vObj.x * ${f(T.satinFreq)})));
          float broad = vnoise(vObj.xz * 0.2 + sd * 1.3);
          roughnessFactor = clamp(roughnessFactor * (1.0 + ${f(T.satin)} * (fine - 0.5) * 2.0 + 0.25 * (broad - 0.5)), 0.08, 1.0);
        }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.3, uHC); // high contrast: a plain pale stone`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // satin: the reflection never falls below an average of the room around it, so a dark corner never blackens the silver
        reflectedLight.indirectSpecular = max(reflectedLight.indirectSpecular, material.specularColor * iblIrradiance * RECIPROCAL_PI * ${f(T.avg)});`)
  }
  m.customProgramCacheKey = () => 'bronze-white'
  return m
}

export default { black: bronze, white: silver } satisfies StoneGL
