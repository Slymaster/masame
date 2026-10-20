// Japanese set's materials (three.js): matte Nachiguro slate, Hyuga clamshell with growth lines and a translucent girdle.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

// shell growth bands: pitch = BAND_PITCH + BAND_PITCH_VAR·fract per stone, in cycles/mm (2.5–4 mm periods); a raised
// cosine^BAND_SHARP (soft edges), cooler than the body; the fine lines run through them, stronger inside a band
const BAND_PITCH = 0.25, BAND_PITCH_VAR = 0.15, BAND_SHARP = 2, BAND_DARK = 0.13, BAND_WARP = 0.15
const FINE_STRIPES = 0.7, FINE_OUTSIDE = 0.5, STRIPE_ROUGH = 0.12

export function slateMaterial() {
  const m = new THREE.MeshPhysicalMaterial({ color: 0x18181b, roughness: 0.42, metalness: 0, specularIntensity: 0.7, clearcoat: 0.3, clearcoatRoughness: 0.42 })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0;
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sd * 0.31);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { float n = 0.6 * vnoise(vObj.xz * 1.3 + sd) + 0.4 * vnoise(vObj.xz * 3.7 - sd);
          n = mix(n, 0.5, smoothstep(0.4, 1.2, fwidth(vObj.x * 3.7)));
          roughnessFactor = clamp(roughnessFactor * (0.78 + 0.44 * n), 0.08, 1.0); }`)
  }
  m.customProgramCacheKey = () => 'slate'
  return m
}

export function shellMaterial({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xfdfbf6, roughness: 0.3, metalness: 0, specularIntensity: 0.8,
    clearcoat: 0.5, clearcoatRoughness: 0.14, sheen: 0.3,
    // nacre-free but pearly: a whisper of thin-film colour in the highlight
    iridescence: 0.14, iridescenceIOR: 1.45, iridescenceThicknessRange: [220, 420],
    emissive: new THREE.Color(0.075, 0.072, 0.066), // a little light comes back out of the shell
    sheenColor: new THREE.Color(0xfff1dc), sheenRoughness: 0.55,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        // Hyuga growth lines: concentric arcs around a far centre => parallel, slightly curved, uneven; pitch and depth vary per stone
        vec2 C = vec2(8.0 * (fract(sd * 0.53) - 0.5), -(45.0 + 80.0 * fract(sd * 0.137)));
        float d = length(vObj.xz - C), pitch = 1.0 + 0.6 * fract(sd * 0.29);
        float ph = d * pitch + 1.7 * sin(d * 0.21 + sd) + 0.8 * sin(d * 0.67 + sd * 1.7);
        float tri = 1.0 - abs(fract(ph) - 0.5) * 2.0;
        float aa = 1.0 - smoothstep(0.25, 0.65, fwidth(ph));
        float shellEnv = (0.35 + 0.65 * smoothstep(-0.3, 0.8, sin(d * 0.39 + sd * 2.3))) * (1.0 - 0.6 * uHC);
        // translucent growth bands on the same arcs, regular (barely warped), coarse enough to survive the Study scale
        float pb = ${BAND_PITCH.toFixed(3)} + ${BAND_PITCH_VAR.toFixed(3)} * fract(sd * 0.29);
        float phb = d * pb + ${BAND_WARP.toFixed(3)} * sin(d * 0.21 + sd);
        float band = pow(0.5 + 0.5 * cos(6.2832 * phb), ${BAND_SHARP.toFixed(2)})
          * (1.0 - smoothstep(0.3, 0.55, fwidth(phb))) * shellEnv * (0.7 + 0.3 * fract(sd * 0.71));
        float stripe = smoothstep(0.6, 1.0, tri) * shellEnv * aa * mix(${FINE_OUTSIDE.toFixed(3)}, 1.0, band);
        float broad = 0.5 + 0.5 * sin(d * 1.1 + sd * 3.1 + 1.3 * sin(d * 0.3));
        float depth = 0.55 + 0.45 * fract(sd * 0.71);
        diffuseColor.rgb *= 1.0 - (vec3(0.075, 0.095, 0.13) * ${FINE_STRIPES.toFixed(3)} * stripe + vec3(0.025, 0.032, 0.045) * broad) * depth
          - vec3(1.06, 1.0, 0.94) * ${BAND_DARK.toFixed(3)} * band; // cooler, greyer than the warm white body
        // the girdle: warmer and deeper where the shell is thin (a firm dark rim in high contrast)
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.9, 0.85, 0.76), vec3(0.35, 0.31, 0.27), uHC), smoothstep(0.72 + 0.12 * uHC, 1.0, rr) * (0.55 + 0.45 * uHC));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + ${STRIPE_ROUGH.toFixed(3)} * stripe; // the polish is uniform: the lines are inside the shell`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // cheap translucency: the window's light wraps warm through the thin girdle; the far side of the girdle falls darker
          float rim = smoothstep(0.62, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.45) / 1.45, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.78, 0.55) * diffuseColor.rgb * wrap * rim * 0.16;
          float away = rim * smoothstep(0.15, -0.55, nl);
          reflectedLight.indirectDiffuse *= 1.0 - 0.5 * away;
          reflectedLight.indirectSpecular *= 1.0 - 0.35 * away;
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'shell'
  return m
}

export default { black: slateMaterial, white: shellMaterial } satisfies StoneGL
