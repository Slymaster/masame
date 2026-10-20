// Nebula materials (three.js): deep space under a clear glossy dome, tiny stars at three depths that shift with the view
// (parallax in object space) and faint violet-blue wisps; and a pale lavender nebula, soft clouds under the dome and a few
// faint stars. Stars never alias: each keeps its light but spreads to a pixel, and the finest fade when the stone is small.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'
import { viewVS } from './braise.gl'

/** Tunables (read when the materials are built). stars: share of the star cells lit; wisps / clouds: the nebula's strength. */
export const TUNE = {
  space: 0x060609, stars: 0.45, starGlow: 2.6, wisps: 2, wispHue: [0.42, 0.2, 0.75],
  pale: 0xe8e6fa, clouds: 1.4, glowW: 1, starsW: 0.08,
}
const f = (x: number) => x.toFixed(3)
const v3 = (c: number[]) => `vec3(${c.map(f).join(', ')})`

const SPACE = /* glsl */`
uniform float uHC;
// one layer of stars on a jittered grid (dens cells per mm, radius size mm); light kept, spread to a pixel, faded when finer than one
float starLayer(vec2 p, float dens, float size, float lit, float seed) {
  vec2 c = p * dens + seed, ci = floor(c), cf = fract(c) - 0.5, o = (vec2(h21(ci + 0.37), h21(ci + 5.1)) - 0.5) * 0.5;
  float b = h21(ci * 1.3 + 2.7), w = fwidth(c.x), r = size * dens, re = max(r, 0.6 * w), d = length(cf - o);
  return step(1.0 - lit, h21(ci * 1.7 + 9.2)) * (0.15 + 0.85 * b * b * b) * exp(-d * d / (re * re)) * (r * r) / (re * re)
    * (1.0 - smoothstep(0.25, 0.7, w));
}
float fbm3(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.15 * vnoise(p * 4.3 - 1.9); }
// a point under the surface at depth dk (mm) along the bent view ray
vec2 under(vec3 V, float dk) { return (vObj + V * dk / max(-V.y, 0.3)).xz; }`

export function space(ctx: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.space, roughness: 0.4, metalness: 0, specularIntensity: 0.3,
    clearcoat: 1, clearcoatRoughness: 0.03, // the clear dome over the inner space
  })
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + SPACE) // stoneVS's noise goes above it
    stoneVS(sh)
    viewVS(sh)
    sh.uniforms.uHC = ctx.hc
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float sd = vSeed * 97.0;
          vec3 V = normalize(vView); V = normalize(vec3(V.x * 0.67, V.y, V.z * 0.67)); // bent by the dome (ior ≈ 1.5)
          float s1 = starLayer(under(V, 0.5), 1.4, 0.035, ${f(T.stars)}, sd);
          float s2 = starLayer(under(V, 1.6), 0.8, 0.05, ${f(T.stars)}, sd * 1.7);
          float s3 = starLayer(under(V, 3.0), 0.45, 0.07, ${f(T.stars * 0.8)}, sd * 2.3);
          vec2 q = under(V, 2.4);
          float neb = fbm3(q * 0.14 + sd), lane = fbm3(q * 0.5 - sd);
          float wisp = smoothstep(0.35, 0.8, neb) * (0.3 + 0.7 * lane);
          vec3 hue = mix(${v3(T.wispHue)}, vec3(0.14, 0.2, 0.62), vnoise(q * 0.09 + sd * 3.0));
          vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.78), h21(floor(q * 0.7) + sd));
          float mute = (1.0 - 0.8 * uHC) * mix(1.0, 0.3, smoothstep(0.02, 0.06, diffuse.g)); // high contrast, dying stone
          totalEmissiveRadiance += (sc * (s1 + 1.2 * s2 + 1.5 * s3) * (1.0 + wisp) * ${f(T.starGlow)} + hue * wisp * wisp * ${f(T.wisps * 0.1)}) * mute;
        }`)
  }
  m.customProgramCacheKey = () => 'nebuleuse-black'
  return m
}

export function pale(ctx: StoneCtx) {
  const T = TUNE, R = ctx.R
  const m = new THREE.MeshPhysicalMaterial({
    color: T.pale, roughness: 0.3, metalness: 0, specularIntensity: 0.8,
    clearcoat: 0.9, clearcoatRoughness: 0.04, // the same clear dome
    emissive: new THREE.Color(0.07, 0.066, 0.1), // the nebula's own soft glow
  })
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + SPACE) // stoneVS's noise goes above it
    stoneVS(sh)
    viewVS(sh)
    sh.uniforms.uHC = ctx.hc
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        vec3 V = normalize(vView); V = normalize(vec3(V.x * 0.67, V.y, V.z * 0.67));
        // soft clouds a little under the dome: brighter billows, faint lavender lanes between them; still clearly the white
        vec2 q = under(V, 1.2);
        float cl = fbm3(q * 0.16 + sd), fine = fbm3(q * 0.55 - sd);
        cl = smoothstep(0.32, 0.68, mix(cl, 0.5, smoothstep(0.3, 0.9, fwidth(q.x * 0.55))) * (0.8 + 0.4 * fine));
        float hc1 = 1.0 - uHC;
        diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.82, 0.79, 0.97), vec3(0.8, 0.86, 1.0), vnoise(q * 0.08 + sd * 2.0)), ${f(T.clouds)} * (1.0 - cl) * hc1);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.36, 0.34, 0.4), smoothstep(0.85, 1.0, rr) * uHC);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float st = starLayer(under(V, 1.5), 0.5, 0.05, ${f(T.starsW)}, sd);
          totalEmissiveRadiance *= ${f(T.glowW)} * (0.6 + 0.8 * cl) * hc1 + uHC;
          totalEmissiveRadiance += vec3(0.9, 0.92, 1.0) * st * 1.6 * hc1; }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // the nebula glows lavender through the thin rim, most against the light
          float thin = smoothstep(0.55, 1.0, rr) * hc1;
          vec3 H = vec3(0.86, 0.78, 1.0) * diffuseColor.rgb;
          reflectedLight.indirectDiffuse += H * (irradiance + iblIrradiance) * thin * 0.12;
          #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[0].direction; float nl = dot(normal, L);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          float back = pow(clamp(dot(-geometryViewDir, L), 0.0, 1.0), 2.0);
          reflectedLight.directDiffuse += directionalLights[0].color * H * thin * (0.35 + 0.6 * back) * wrap;
          #endif
        }`)
  }
  m.customProgramCacheKey = () => 'nebuleuse-white'
  return m
}

export default { black: space, white: pale } satisfies StoneGL
