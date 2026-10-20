// Moonstone and obsidian materials (three.js). Obsidian: black volcanic glass under a mirror polish, the reflection
// gently rippled (a conchoidal waviness, different in every stone) and a faint smoky brown where the rim thins against
// the light. Moonstone: milky and a little translucent, with adularescence: a soft blue glow from its flat inner layers
// that floats across the stone as the light and the eye move, strongest near the reflection. No transmission.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/** Tunables (read when the materials are built; variant B of design/screenshots/v06-lune-variants.png). wave: obsidian
 *  ripple depth (mm); adul: the blue sheen's strength, adulColor its tint at full strength; layer: how flat the glowing
 *  layers lie (0 = follow the dome, 1 = flat); sharp: the sheen's tightness; room: its share of the room's light. */
export const TUNE = {
  obsidian: 0x070707, wave: 0.05, smoke: 0.14,
  moon: 0xe0e3e8, adul: 2.5, adulColor: [0.42, 0.64, 1.2], layer: 0.35, sharp: 12, cloud: 0.9, glow: 0.2, room: 0.1,
}
const f = (x: number) => x.toFixed(3)
const hcUniform = (sh: THREE.WebGLProgramParametersWithUniforms, hc: StoneCtx['hc']) => {
  sh.uniforms.uHC = hc
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;')
}

// a height field (mm) over the stone, tipped into the shading normal: exact for any size on screen (the bump-map
// perturbation of Mikkelsen with the height's analytic screen derivatives)
const WAVY = /* glsl */`
float waveH(vec2 p, float sd) { return 0.6 * vnoise(p * 0.22 + sd) + 0.4 * vnoise(p * 0.55 - sd * 1.3); }
vec3 wavyN(vec3 n, float sd, float amp, float face) {
  const float e = 0.05;
  vec2 p = vObj.xz;
  vec3 g = amp * vec3(waveH(p + vec2(e, 0.0), sd) - waveH(p - vec2(e, 0.0), sd), 0.0, waveH(p + vec2(0.0, e), sd) - waveH(p - vec2(0.0, e), sd)) / (2.0 * e);
  vec2 dH = vec2(dot(g, dFdx(vObj)), dot(g, dFdy(vObj)));
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  return normalize(abs(det) * n - sign(det) * (dH.x * r1 + dH.y * r2));
}`

export function obsidian({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.obsidian, roughness: 0.06, metalness: 0, ior: 1.49, specularIntensity: 0.8,
    clearcoat: 1, clearcoatRoughness: 0.03, // a mirror
  })
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + WAVY)
    stoneVS(sh) // its noise goes in front of WAVY
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sd * 0.31);
        float amp = ${f(T.wave)} * (0.6 + 0.8 * fract(sd * 0.53)) * (1.0 - uHC); // some stones flatter than others`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = wavyN(normal, sd, amp, faceDirection);`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        clearcoatNormal = wavyN(clearcoatNormal, sd, amp, faceDirection);
        #endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // where the glass thins at the girdle, the window light comes through a faint smoky brown
          float nl = dot(normal, directionalLights[0].direction);
          float back = smoothstep(0.78, 1.0, rr) * smoothstep(0.1, -0.5, nl);
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(0.34, 0.2, 0.11) * back * ${f(T.smoke)} * (1.0 - uHC);
        }
        #endif
        // the mirror stays black: the broad environment held down, the window's reflection stays bright
        reflectedLight.indirectSpecular *= mix(0.85, 0.55, uHC);`)
  }
  m.customProgramCacheKey = () => 'lune-black'
  return m
}

export function moonstone({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.moon, roughness: 0.14, metalness: 0, ior: 1.52, specularIntensity: 0.75,
    clearcoat: 0.8, clearcoatRoughness: 0.05, // polished cabochon
    emissive: new THREE.Color(0.055, 0.058, 0.064), // milky: light scattered inside comes back out
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    hcUniform(sh, hc)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        // the glow of the inner layers towards the eye for a light from L: a soft lobe around the half vector
        float adulLobe(vec3 Nl, vec3 L, vec3 V) { return pow(max(dot(Nl, normalize(L + V)), 0.0), ${f(T.sharp)}); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        diffuseColor.rgb *= 0.985 + 0.03 * fract(sd * 0.53);
        // a soft milky cloud inside, a little denser here and there
        float cloud = 0.6 * vnoise(vObj.xz * 0.16 + sd) + 0.4 * vnoise(vObj.xz * 0.4 - sd);
        diffuseColor.rgb *= 1.0 + 0.03 * (cloud - 0.5) * (1.0 - uHC);
        // in high contrast a firm grey girdle outlines the stone on the light board
        diffuseColor.rgb *= mix(1.0, 0.45, smoothstep(0.8, 1.0, rr) * uHC);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // the layers lie nearly flat in the stone, tipped a little differently in each one
          vec3 tip = normalize(vec3(0.5 * (fract(sd * 0.71) - 0.5), 1.0, 0.5 * (fract(sd * 0.37) - 0.5)));
          vec3 Nl = normalize(mix(normal, normalize((viewMatrix * vec4(tip, 0.0)).xyz), ${f(T.layer)}));
          vec3 V = geometryViewDir;
          // the glow is billowy, not a disc: a slow cloud modulates it
          float bil = mix(1.0, 0.25 + 1.5 * cloud, ${f(T.cloud)}) * (1.0 - uHC);
          vec3 adul = vec3(0.0); // how much light the layers send to the eye
          #if NUM_DIR_LIGHTS > 0
          adul += directionalLights[0].color * adulLobe(Nl, directionalLights[0].direction, V);
          { // translucency: the light wraps through the thin rim, a little cool
            float rim = smoothstep(0.55, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
            float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
            reflectedLight.directDiffuse += directionalLights[0].color * vec3(0.93, 0.96, 1.0) * diffuseColor.rgb * wrap * rim * ${f(T.glow)} * (1.0 - uHC);
            reflectedLight.indirectDiffuse *= 1.0 - 0.3 * rim * smoothstep(0.15, -0.55, nl);
          }
          #endif
          #if NUM_SPOT_LIGHTS > 0
          for (int i = 0; i < NUM_SPOT_LIGHTS; i++) { // the lamp's light glows in it too
            vec3 lv = spotLights[i].position - geometryPosition; float d = length(lv); lv /= d;
            float a = getSpotAttenuation(spotLights[i].coneCos, spotLights[i].penumbraCos, dot(lv, spotLights[i].direction))
              * getDistanceAttenuation(d, spotLights[i].distance, spotLights[i].decay);
            adul += spotLights[i].color * a * adulLobe(Nl, lv, V);
          }
          #endif
          // a little of the room's light too, seen straight down into the layers
          adul += iblIrradiance * ${f(T.room)} * pow(max(dot(Nl, V), 0.0), 3.0);
          // the milky body turns blue where the layers glow: a hue shift that lifts blue, so the stone stays white at a glance
          float g = clamp(dot(adul, vec3(0.2126, 0.7152, 0.0722)) / 3.0 * ${f(T.adul)} * bil, 0.0, 1.0);
          vec3 shift = mix(vec3(1.0), vec3(${T.adulColor.map(f).join(', ')}), g);
          reflectedLight.directDiffuse *= shift;
          reflectedLight.indirectDiffuse *= shift;
        }`)
  }
  m.customProgramCacheKey = () => 'lune-white'
  return m
}

export default { black: obsidian, white: moonstone } satisfies StoneGL
