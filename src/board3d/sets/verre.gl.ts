// Blown glass materials (three.js). Smoked glass: dark grey-brown under a glass polish, lit brown through its thin rim,
// with a few tiny air bubbles trapped at different depths (they shift a little as the eye moves). Opal glass: milky
// white with soft swirls where the milk is denser, as it was stirred into the melt. No transmission.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built; variant C of design/screenshots/v06-verre-variants.png). bubbles: how many (0..1); swirl: the opal's swirl contrast. */
export const TUNE = {
  smoked: 0x15110e, smoke: 0.5, bubbles: 0.85, bubbleSize: 2.3,
  opal: 0xf0efe9, swirl: 0.42, swirlScale: 0.8, glow: 0.22,
}
const f = (x: number) => x.toFixed(3)
const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}

export function smokedGlass({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.smoked, roughness: 0.06, metalness: 0, ior: 1.52, specularIntensity: 0.75,
    clearcoat: 1, clearcoatRoughness: 0.035,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.92 + 0.16 * fract(sd * 0.41);
        float bub = 0.0, glint = 0.0;
        {
          // the eye's direction in the stone (world ≈ object here), to set each bubble at its depth
          vec3 Vw = transpose(mat3(viewMatrix)) * normalize(vViewPosition);
          vec2 par = -Vw.xz / max(Vw.y, 0.3);
          for (int i = 0; i < 8; i++) {
            float fi = float(i), k = h21(vec2(sd, fi * 7.1));
            if (k > ${f(T.bubbles)}) continue;
            float a = 6.2832 * h21(vec2(fi * 3.3, sd)), rp = ${R.toFixed(2)} * 0.72 * sqrt(h21(vec2(sd * 1.7, fi)));
            float depth = 0.8 + 2.5 * h21(vec2(fi + 2.0, sd));
            vec2 c = vec2(cos(a), sin(a)) * rp + par * depth * 0.5;
            float br = ${f(T.bubbleSize)} * (0.1 + 0.25 * h21(vec2(fi, sd * 2.9))), d = length(vObj.xz - c) / br;
            // a bubble in dark glass: a thin bright ring where the light is turned back at its wall, a glint on top
            bub += smoothstep(0.6, 0.9, d) * (1.0 - smoothstep(0.9, 1.1, d));
            glint += 1.0 - smoothstep(0.0, 0.3, length(vObj.xz - c + vec2(0.3, 0.3) * br) / br);
          }
          float vis = (1.0 - smoothstep(0.2, 0.6, fwidth(vObj.x))) * (1.0 - uHC); // gone when the stone is a few pixels wide
          diffuseColor.rgb += (vec3(0.22, 0.2, 0.17) * min(bub, 1.0) + vec3(0.6, 0.56, 0.5) * min(glint, 1.0)) * vis;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.25, min(bub, 1.0) * 0.5);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // smoked glass is translucent: thin at the girdle, the light comes through it grey-brown
          float thin = smoothstep(0.62, 1.0, rr) * (1.0 - uHC);
          vec3 S = vec3(0.42, 0.3, 0.2) * ${f(T.smoke)};
          reflectedLight.indirectDiffuse += S * (irradiance + iblIrradiance) * thin * 0.12;
          #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[0].direction; float nl = dot(normal, L);
          float back = smoothstep(0.1, -0.5, nl), wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * S * thin * (0.6 * back + 0.25 * wrap);
          #endif
        }
        reflectedLight.indirectSpecular *= mix(0.85, 0.55, uHC);`)
  }
  m.customProgramCacheKey = () => 'verre-black'
  return m
}

export function opalGlass({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.opal, roughness: 0.09, metalness: 0, ior: 1.52, specularIntensity: 0.7,
    clearcoat: 1, clearcoatRoughness: 0.035,
    emissive: new THREE.Color(0.05, 0.05, 0.048), // opal glass: light scattered inside comes back out
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)}, an = 6.2832 * fract(sd * 0.37);
        float milk;
        { // swirls: streaks of denser milk folded through clearer, cooler glass, a different stir in every stone
          vec2 q = mat2(cos(an), -sin(an), sin(an), cos(an)) * vObj.xz * vec2(0.06, 0.13) / ${f(T.swirlScale)} + sd;
          vec2 w = q + 1.4 * vec2(vnoise(q * 1.1), vnoise(q * 1.1 + 5.2)) + 0.5 * vec2(vnoise(q * 2.7 - 3.0), vnoise(q * 2.7 + 9.0));
          float ph = w.y * 1.3 + 0.6 * vnoise(w * 1.7 - sd);
          // thin milky wisps (a raised sine, sharpened) over a soft cloud, fading out before they could alias
          float wisp = pow(0.5 + 0.5 * sin(6.2832 * ph), 3.0) * (0.4 + 0.6 * vnoise(w * 0.9 + 4.0));
          float aa = (1.0 - smoothstep(0.12, 0.35, fwidth(ph))) * (1.0 - uHC);
          milk = (0.75 * wisp + 0.25 * vnoise(q * 1.6 + 2.0)) * aa;
          diffuseColor.rgb *= 0.985 + 0.03 * fract(sd * 0.61);
          // between the wisps the glass is a little clearer, so a touch greyer and cooler; the wisps a denser white
          diffuseColor.rgb *= mix(vec3(1.0 - ${f(T.swirl)} * 0.8, 1.0 - ${f(T.swirl)} * 0.65, 1.0 - ${f(T.swirl)} * 0.4), vec3(1.0 + ${f(T.swirl)} * 0.3), milk);
        }
        // in high contrast a firm grey girdle outlines the stone on the light board
        diffuseColor.rgb *= mix(1.0, 0.45, smoothstep(0.8, 1.0, rr) * uHC);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= 0.6 + 0.8 * milk; // the dense milk glows, the clear glass between lets light through`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // the light wraps through the thin rim and glows softly in the milk
          float rim = smoothstep(0.55, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.95, 0.88) * diffuseColor.rgb * wrap * rim * ${f(T.glow)} * (0.7 + 0.6 * milk) * (1.0 - uHC);
          reflectedLight.indirectDiffuse *= 1.0 - 0.3 * rim * smoothstep(0.15, -0.55, nl);
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'verre-white'
  return m
}

export default { black: smokedGlass, white: opalGlass } satisfies StoneGL
