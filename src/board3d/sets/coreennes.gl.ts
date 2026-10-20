// Korean glass's materials (three.js): deep opaque black glass and milky opal white glass, both under a near-mirror polish.
// No transmission: the white's glow and the black's faint bottle-green edge are faked in lights_fragment_end.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

const ROUGH = 0.07, COAT_ROUGH = 0.035 // the polish: crisp window reflections, the décor seen in every stone
const B_EDGE = 0.05 // the black's green edge against the light
const W_GLOW = 0.22 // the white's light through its thin rim

const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}

export function blackGlass({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x050607, roughness: ROUGH, metalness: 0, ior: 1.52, specularIntensity: 0.75,
    clearcoat: 1, clearcoatRoughness: COAT_ROUGH,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.92 + 0.16 * fract(vSeed * 41.3); // batches of glass differ by a hair`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // where the glass thins at the girdle, the window light shows a faint bottle green through it
          float nl = dot(normal, directionalLights[0].direction);
          float back = smoothstep(0.78, 1.0, rr) * smoothstep(0.1, -0.5, nl);
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(0.10, 0.32, 0.24) * back * ${B_EDGE.toFixed(3)} * (1.0 - uHC);
        }
        #endif
        // reflections stay a mirror on black, never a grey veil: the broad environment is held down, the window stays bright
        reflectedLight.indirectSpecular *= mix(0.85, 0.55, uHC);`)
  }
  m.customProgramCacheKey = () => 'coreennes-black'
  return m
}

export function whiteGlass({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xf1f0ea, roughness: ROUGH + 0.03, metalness: 0, ior: 1.52, specularIntensity: 0.7,
    clearcoat: 1, clearcoatRoughness: COAT_ROUGH,
    emissive: new THREE.Color(0.06, 0.06, 0.058), // opal glass: light scattered inside comes back out
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.985 + 0.03 * fract(vSeed * 53.7);
        // in high contrast a firm grey girdle outlines the stone on the light board
        diffuseColor.rgb *= mix(1.0, 0.45, smoothstep(0.8, 1.0, rr) * uHC);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // opal translucency: the light wraps through the thin rim and glows softly, a little warm
          float rim = smoothstep(0.55, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.93, 0.84) * diffuseColor.rgb * wrap * rim * ${W_GLOW.toFixed(3)} * (1.0 - uHC);
          float away = rim * smoothstep(0.15, -0.55, nl);
          reflectedLight.indirectDiffuse *= 1.0 - 0.3 * away;
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'coreennes-white'
  return m
}

export default { black: blackGlass, white: whiteGlass } satisfies StoneGL
