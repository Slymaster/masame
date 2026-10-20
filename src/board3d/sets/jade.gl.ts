// Jade set's materials (three.js): warm "mutton-fat" white nephrite with soft cloudy veils and a fine fibrous grain, and
// dark spinach jade (near black on the board, green in the light and at the rim) with fine veins and rare black flecks.
// Both share a waxy, buttery polish and a translucent girdle (the shell's lights_fragment_end trick, no transmission).
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

// nephrite is a felt of fibres: a grain stretched along one direction per stone, under soft cloudy veils
const GLSL = /* glsl */`
uniform float uHC;
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 7.3) + 0.15 * vnoise(p * 4.3 - 3.1); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }`

// the look's knobs (variant A of design/screenshots/v06-jade-variants.png)
const P = {
  white: 0xf3eedc, veilTint: [0.88, 0.83, 0.68], veil: 1.1, cloud: 0.1, fibre: 0.04, glowW: 0.34,
  black: 0x0f1411, mottle: 0.38, vein: 1.6, glowB: 0.55,
}
const f = (v: number) => v.toFixed(3)
const v3 = (c: number[]) => `vec3(${c.map(f).join(', ')})`
const rim = (R: number) => `rr = length(vObj.xz) / ${R.toFixed(2)}`

export function nephriteMaterial({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: P.white, roughness: 0.38, metalness: 0, specularIntensity: 0.55,
    clearcoat: 0.2, clearcoatRoughness: 0.34, sheen: 0.45,
    sheenColor: new THREE.Color(0xfff3d8), sheenRoughness: 0.6,
    emissive: new THREE.Color(0.07, 0.066, 0.052), // light scattered back out of the stone
  })
  m.onBeforeCompile = sh => {
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL)
    stoneVS(sh) // its noise goes in front of GLSL
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, ${rim(R)}, lo = 1.0 - 0.7 * uHC;
        vec2 q = rot(vObj.xz + vec2(0.0, vObj.y), 6.2832 * fract(sd * 0.37)) + sd;
        // cloudy veils: creamier, more translucent drifts through a denser milky body
        float cl = fbm(q * 0.13 + 0.5 * vnoise(q * 0.4));
        float veil = smoothstep(0.45, 0.8, cl), milk = smoothstep(0.4, 0.15, cl);
        // the fibrous felt: fine, stretched, low contrast; fades out before it can alias
        float fib = vnoise(vec2(q.x * 0.3, q.y * 4.0)) + 0.5 * vnoise(vec2(q.x * 0.6, q.y * 9.0)) - 0.75;
        fib *= 1.0 - smoothstep(0.5, 1.4, fwidth(q.y * 9.0));
        diffuseColor.rgb *= 0.98 + 0.04 * fract(sd * 0.61); // each stone a slightly different white
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * ${v3(P.veilTint)}, veil * ${f(P.veil)} * lo);
        diffuseColor.rgb *= 1.0 + (milk * ${f(P.cloud)} + fib * ${f(P.fibre)}) * lo;
        // the girdle: thinner, so warmer and a little deeper (a firm rim in high contrast)
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.97, 0.9, 0.76), vec3(0.4, 0.37, 0.3), uHC), smoothstep(0.74 + 0.1 * uHC, 1.0, rr) * (0.5 + 0.5 * uHC));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor *= 1.0 + 0.15 * veil; // the waxy polish dulls a touch over the veils`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // translucency: the window's light glows warm through the thin girdle; the far side falls a little darker
          float rimT = smoothstep(0.5, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.6) / 1.6, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(1.0, 0.84, 0.56) * diffuseColor.rgb * wrap * rimT * ${f(P.glowW)} * lo;
          float away = rimT * smoothstep(0.15, -0.55, nl);
          reflectedLight.indirectDiffuse *= 1.0 - 0.4 * away;
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'jade-white'
  return m
}

export function spinachMaterial({ hc, R }: StoneCtx) {
  const m = new THREE.MeshPhysicalMaterial({
    color: P.black, roughness: 0.36, metalness: 0, specularIntensity: 0.5,
    clearcoat: 0.28, clearcoatRoughness: 0.36, sheen: 0.3,
    sheenColor: new THREE.Color(0x5f8a6c), sheenRoughness: 0.6,
  })
  m.onBeforeCompile = sh => {
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL)
    stoneVS(sh) // its noise goes in front of GLSL
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, ${rim(R)}, lo = 1.0 - 0.8 * uHC;
        vec2 q = rot(vObj.xz + vec2(0.0, vObj.y), 6.2832 * fract(sd * 0.41)) + sd;
        // fine veins: thin wavering lines, some darker, some a lighter green
        float w = fbm(q * 0.11) * 7.0 + q.x * 0.25;
        float vein = smoothstep(0.86, 1.0, abs(fract(w) - 0.5) * 2.0);
        vein *= smoothstep(0.25, 0.6, vnoise(q * 0.19 + 3.0)) * (1.0 - smoothstep(0.1, 0.35, fwidth(w)));
        float light = step(0.45, fract(floor(w + 0.5) * 0.618 + sd));
        // rare tiny black flecks (chromite)
        vec2 cell = floor(q * 1.4);
        float fleck = step(0.975, h21(cell + 11.0)) * (1.0 - smoothstep(0.1, 0.2, length(fract(q * 1.4) - 0.5)));
        diffuseColor.rgb *= 0.9 + 0.2 * fract(sd * 0.31);
        diffuseColor.rgb *= 1.0 + ${f(P.mottle)} * (fbm(q * 0.17) - 0.5) * 2.0 * lo; // mottled greens
        diffuseColor.rgb *= 1.0 + vein * mix(-0.45, 0.8, light) * ${f(P.vein)} * lo;
        diffuseColor.rgb *= 1.0 - 0.8 * fleck * lo;
        diffuseColor.rgb *= 1.0 - 0.3 * uHC; // high contrast: nearer black`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        { // translucency: the thin girdle glows deep green against the light
          float rimT = smoothstep(0.55, 1.0, rr), nl = dot(normal, directionalLights[0].direction);
          float wrap = clamp((nl + 0.6) / 1.6, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          reflectedLight.directDiffuse += directionalLights[0].color * vec3(0.05, 0.17, 0.08) * wrap * rimT * ${f(P.glowB)} * lo;
        }
        #endif`)
  }
  m.customProgramCacheKey = () => 'jade-black'
  return m
}

export default { black: spinachMaterial, white: nephriteMaterial } satisfies StoneGL
