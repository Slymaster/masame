// Agate materials (three.js): a deep black onyx whose very fine concentric bands only show in the light, under a high
// polish, and a milky chalcedony with faint blue-grey bands and a waxy glow at its thin rim. Each stone is cut from its own
// piece: the bands' centre, ellipse, angle and pitch come from vSeed, in the stone's own coordinates.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built). bands: how much the layers show; tint: the white bands' colour. */
export const TUNE = {
  black: 0x060607, blackRough: 0.14, blackCoatRough: 0.07, blackBands: 0.011,
  white: 0xe9ecef, whiteRough: 0.26, whiteCoat: 0.6, whiteCoatRough: 0.14, whiteBands: 0.07, tint: [1.0, 0.75, 0.42], wax: 0.2,
}
const v3 = (c: number[]) => `vec3(${c.map(x => x.toFixed(3)).join(', ')})`

const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}

// concentric layers around an off-centre core, wavy, fine and coarse; `band` 0..1, faded out where they would alias
const BANDS = (R: number) => `
  float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
  float band;
  { float a = 6.2832 * fract(sd * 0.173), ca = cos(a), sa = sin(a);
    vec2 q = vObj.xz - ${(R * 0.45).toFixed(2)} * vec2(fract(sd * 0.37) - 0.5, fract(sd * 0.61) - 0.5) * 2.0;
    q = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y) * vec2(1.0, 1.25 + 0.5 * fract(sd * 0.29));
    float d = length(q) + 0.3 * vObj.y + 1.6 * vnoise(vObj.xz * 0.11 + sd) + 0.3 * vnoise(vObj.xz * 0.37 - sd);
    float ph = d * (0.45 + 0.35 * fract(sd * 0.83)), aa = 1.0 - smoothstep(0.3, 0.6, fwidth(ph));
    // layers of uneven strength (one per period, continuous where each fades out), a finer line through each
    float soft = pow(0.5 + 0.5 * cos(6.2832 * ph), 1.5) * (0.25 + 0.75 * h21(vec2(floor(ph + 0.5), sd)));
    float fine = pow(0.5 + 0.5 * cos(6.2832 * ph * 3.0), 6.0) * (1.0 - smoothstep(0.3, 0.6, fwidth(ph * 3.0)));
    float coarse = smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(d * 0.3 + sd)); // broad zones, denser and paler
    band = (soft * (0.8 + 0.4 * coarse) + 0.3 * fine * soft) * aa; }`

export function agateBlack({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.black, roughness: T.blackRough, metalness: 0, specularIntensity: 0.7,
    clearcoat: 1, clearcoatRoughness: T.blackCoatRough, // agate takes a mirror polish; the stone under it stays stone
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${BANDS(R)}
        diffuseColor.rgb *= 0.92 + 0.16 * fract(sd * 0.31);
        diffuseColor.rgb += vec3(0.95, 0.97, 1.0) * ${T.blackBands.toFixed(4)} * band * (1.0 - uHC); // dark grey layers, never grey stone`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + 0.5 * band; // the layers take the polish a hair differently`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // the broad environment held down: reflections stay a mirror on black, never a grey veil
        reflectedLight.indirectSpecular *= mix(0.85, 0.55, uHC);`)
  }
  m.customProgramCacheKey = () => 'agate-black'
  return m
}

export function agateWhite({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.white, roughness: T.whiteRough, metalness: 0, specularIntensity: 0.7,
    clearcoat: T.whiteCoat, clearcoatRoughness: T.whiteCoatRough,
    sheen: 0.25, sheenColor: new THREE.Color(0xf2f6ff), sheenRoughness: 0.5, // the waxy lustre of chalcedony
    emissive: new THREE.Color(0.05, 0.052, 0.056), // light scattered inside comes back out
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${BANDS(R)}
        diffuseColor.rgb *= 0.985 + 0.03 * fract(sd * 0.53);
        diffuseColor.rgb *= 1.0 - ${v3(T.tint)} * ${T.whiteBands.toFixed(3)} * band * (1.0 - 0.7 * uHC); // soft blue-grey layers
        // the thin girdle a shade greyer, where the stone turns translucent (a firm grey rim in high contrast)
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.9, 0.92, 0.95), vec3(0.42, 0.42, 0.44), uHC), smoothstep(0.75 + 0.1 * uHC, 1.0, rr) * (0.5 + 0.5 * uHC));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // waxy translucency: the window's light wraps through the thin rim, a little cool; the far rim falls a shade darker
          float rim = smoothstep(0.55, 1.0, rr) * (1.0 - uHC), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(0.94, 0.97, 1.0) * diffuseColor.rgb * wrap * rim * ${T.wax.toFixed(3)};
          reflectedLight.indirectDiffuse *= 1.0 - 0.3 * rim * smoothstep(0.15, -0.55, nl);
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'agate-white'
  return m
}

export default { black: agateBlack, white: agateWhite } satisfies StoneGL
