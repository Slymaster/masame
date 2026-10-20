// Amber and ebony materials (three.js): satin-lacquered ebony whose fine straight grain shows only in the highlight, and
// pale honey amber, lit from inside at the rim and against the light, with a few tiny bubbles per stone. No transmission.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built). grain: the ebony's grain in the highlight; glow: the amber's inner light. */
export const TUNE = {
  ebony: 0x161110, ebonyRough: 0.34, ebonyCoat: 0.45, ebonyCoatRough: 0.22, grain: 0.5,
  amber: 0xfae6ae, amberRough: 0.2, amberCoat: 0.55, amberCoatRough: 0.07, glow: 1.2, deep: 0.9, honey: 0.6, bubbles: 1,
}
const f = (x: number) => x.toFixed(3)
const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}

export function ebony({ hc }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.ebony, roughness: T.ebonyRough, metalness: 0, specularIntensity: 0.65, specularColor: new THREE.Color(0xffe6c8),
    clearcoat: T.ebonyCoat, clearcoatRoughness: T.ebonyCoatRough, // a satin lacquer, not a mirror
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, an = fract(sd * 0.173) * 3.1416;
        // straight grain at a random angle per stone
        vec2 gd = vec2(cos(an), sin(an)), q = vec2(dot(vObj.xz, vec2(-gd.y, gd.x)), dot(vObj.xz, gd));
        // fine streaks of uneven strength, about 0.3 to 0.6 mm wide, wandering a little; they run the whole stone
        float w = 1.2 * vnoise(vec2(q.x * 0.15, q.y * 0.03) + sd), gp = q.x * 2.8 + w;
        float grain = 0.6 * vnoise(vec2(gp, q.y * 0.025 + sd)) + 0.4 * vnoise(vec2(gp * 2.2 + 3.1, q.y * 0.04 - sd));
        grain = 0.5 + 1.4 * (grain - 0.5);
        grain = mix(grain, 0.5, min(1.0, smoothstep(0.25, 0.6, fwidth(gp)) + uHC));
        diffuseColor.rgb *= (0.9 + 0.2 * fract(sd * 0.31)) * (0.96 + 0.08 * grain);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (1.0 + ${f(T.grain)} * (grain - 0.5) * 1.6), 0.08, 1.0); // the pores break the highlight`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoatRoughness = clamp(material.clearcoatRoughness * (1.0 + ${f(T.grain)} * (grain - 0.5) * 1.2), 0.04, 1.0);`)
  }
  m.customProgramCacheKey = () => 'ambre-black'
  return m
}

export function amber({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.amber, roughness: T.amberRough, metalness: 0, ior: 1.54, specularIntensity: 0.8,
    clearcoat: T.amberCoat, clearcoatRoughness: T.amberCoatRough, // polished resin
    emissive: new THREE.Color(0.11, 0.08, 0.035), // light scattered inside comes back out, warm
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        { // paler where the resin is thick, a deeper honey towards the thin rim, a soft cloudy flow; a firm dark rim in high contrast
          float n = 0.6 * vnoise(vObj.xz * 0.3 + sd) + 0.4 * vnoise(vObj.xz * 0.8 - sd);
          n = mix(n, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 0.8)));
          diffuseColor.rgb *= (0.98 + 0.03 * fract(sd * 0.41)) * mix(vec3(1.0), vec3(1.0, 0.8, 0.46), ${f(T.deep)} * smoothstep(0.3, 1.0, rr) * (0.7 + 0.6 * n) * (1.0 - uHC));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.35, 0.29, 0.2), smoothstep(0.85, 1.0, rr) * uHC);
          // a few tiny bubbles caught in the resin, a different few in every stone: a faint disc, a darker rim, a glint
          float bub = 0.0, glint = 0.0;
          for (int i = 0; i < 6; i++) {
            float fi = float(i), k = h21(vec2(sd, fi * 7.1));
            if (k > 0.45 * ${f(T.bubbles)}) continue;
            float a = 6.2832 * h21(vec2(fi * 3.3, sd)), rp = ${R.toFixed(2)} * 0.75 * sqrt(h21(vec2(sd * 1.7, fi)));
            vec2 c = vec2(cos(a), sin(a)) * rp;
            float br = 0.15 + 0.4 * h21(vec2(fi, sd * 2.9)) * h21(vec2(sd, fi + 0.5)), d = length(vObj.xz - c) / br;
            bub += (1.0 - smoothstep(0.75, 1.0, d)) * 0.5 + smoothstep(0.6, 0.9, d) * (1.0 - smoothstep(0.9, 1.15, d));
            glint += 1.0 - smoothstep(0.0, 0.35, length(vObj.xz - c + vec2(0.3, 0.3) * br) / br);
          }
          float vis = (1.0 - smoothstep(0.2, 0.6, fwidth(vObj.x))) * (1.0 - uHC); // gone when the stone is a few pixels wide
          diffuseColor.rgb *= 1.0 - vec3(0.3, 0.38, 0.5) * min(bub, 1.0) * vis;
          diffuseColor.rgb += vec3(0.6, 0.55, 0.45) * min(glint, 1.0) * vis;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // fake translucency: light scattered in the resin glows honey at the thin rim, most against the light
          float thin = smoothstep(0.5, 1.0, rr) * (1.0 - uHC);
          vec3 H = vec3(1.0, 0.72, 0.32) * diffuseColor.rgb;
          // the shade never greys: light wandering in the resin fills it with a deeper honey
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(1.12, 0.86, 0.5), ${f(T.honey)} * (1.0 - uHC));
          reflectedLight.indirectDiffuse += H * (irradiance + iblIrradiance) * thin * ${f(T.glow * 0.25)};
          #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[0].direction; float nl = dot(normal, L);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          float back = pow(clamp(dot(-geometryViewDir, L), 0.0, 1.0), 2.0);
          reflectedLight.directDiffuse += directionalLights[0].color * H * (thin * (0.5 * wrap + 0.9 * back) + 0.12 * back) * ${f(T.glow)};
          #endif
        }`)
  }
  m.customProgramCacheKey = () => 'ambre-white'
  return m
}

export default { black: ebony, white: amber } satisfies StoneGL
