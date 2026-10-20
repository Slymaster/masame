// River pebble materials (three.js): matte dark shale with a fine mineral grain and soft water-polished patches, and a
// pale cream-grey sandstone, finely speckled with a few darker grains. Every stone gets its own irregular outline and a
// slightly uneven, lopsided top in the vertex shader (from aSeed), at most 0.8 mm off the lens of galets.ts, so picking,
// placing and the last-move ring stay true. The shadow pass keeps the plain lens (the difference is under its blur).
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/**
 * Tunables (read when the materials are built). Shape, in mm at the rim (oval + tri + lop + wob ≤ 0.8): oval an elliptic
 * squash, tri a three-lobed outline, lop one side fuller, wob a faint five-lobed wobble; tilt and bump the top's slope and
 * swell, as shares of its height, kept off the centre where the last-move ring lies.
 */
export const TUNE = {
  oval: 0.42, tri: 0.24, lop: 0.08, wob: 0.06, tilt: 0.17, bump: 0.11,
  black: 0x202020, blackRough: 0.8, blackPolish: 0.5, blackCoat: 0.04, grainB: 0.26, bumpB: 0.055, fleck: 0.35,
  white: 0xe2ddd0, whiteRough: 0.88, grainW: 0.085, cloudW: 0.07, speck: 0.5, speckCount: 1.3, grains: 1.5, bumpW: 0.075,
}

/** Fragment helpers: grit() a fine granular bump on the surface (mm), speck() dark dots on a jittered grid, both faded where they would alias. */
const GRIT = /* glsl */`
float gritH(vec2 p, float sd) { return vnoise(p * 3.1 + sd) * 0.6 + vnoise(p * 7.7 - sd) * 0.4; }
vec3 grit(vec3 N, vec2 p, float sd, float amp) {
  float h = gritH(p, sd) * amp * (1.0 - smoothstep(0.25, 0.9, fwidth(p.x * 7.7)));
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1); vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - g);
}
vec2 gph2(float a) { return vec2(cos(a), sin(a)); }
float speck(vec2 p, float freq, float dens, float size, float sd) {
  vec2 c = p * freq, ci = floor(c), cf = fract(c) - 0.5, o = vec2(h21(ci + sd), h21(ci - sd + 3.1)) - 0.5;
  float on = step(1.0 - dens, h21(ci * 1.7 + sd)), r = size * (0.5 + h21(ci + 9.3));
  float w = fwidth(c.x), d = length(cf - o * (0.9 - 2.0 * size));
  return on * (1.0 - smoothstep(r - w, r + w, d)) * (1.0 - smoothstep(0.35, 0.9, w));
}`

/** The per-stone warp, in the vertex shader: an outline from a few low complex modes, a lopsided top. */
function warpVS(sh: THREE.WebGLProgramParametersWithUniforms, R: number) {
  const T = TUNE, k = (mm: number) => (mm / R).toFixed(5), f = (x: number) => x.toFixed(4)
  sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
    vec2 gcm(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
    vec2 gph(float a) { return vec2(cos(a), sin(a)); }
    vec3 galetWarp(vec3 p, float seed) {
      float s = seed * 97.0;
      vec2 z = p.xz / ${R.toFixed(3)}, c = vec2(z.x, -z.y), c2 = gcm(c, c);
      float a = 0.55 + 0.45 * fract(s * 0.37), b = 0.4 + 0.6 * fract(s * 0.53), l = fract(s * 0.71), w = fract(s * 0.19);
      vec2 q = z + ${k(T.oval)} * a * gcm(c, gph(s * 1.3)) + ${k(T.tri)} * b * gcm(c2, gph(s * 2.1))
        + ${k(T.lop)} * l * gcm(gcm(z, z), gph(s * 0.7)) + ${k(T.wob)} * w * gcm(gcm(c2, c2), gph(s * 3.7));
      float r = length(z);
      float h = (${f(T.tilt)} * (0.4 + 0.6 * fract(s * 0.23)) * dot(z, gph(s * 1.9))
        + ${f(T.bump)} * sin(z.x * 2.3 + s) * sin(z.y * 1.9 + s * 0.6)) * smoothstep(0.22, 0.6, r);
      return vec3(q.x * ${R.toFixed(3)}, p.y + max(p.y, 0.0) * h, q.y * ${R.toFixed(3)});
    }`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
    { // the warp's Jacobian by central differences carries the lens's normal onto the uneven stone
      const float e = 0.02;
      mat3 J = mat3(galetWarp(position + vec3(e, 0, 0), aSeed) - galetWarp(position - vec3(e, 0, 0), aSeed),
                    galetWarp(position + vec3(0, e, 0), aSeed) - galetWarp(position - vec3(0, e, 0), aSeed),
                    galetWarp(position + vec3(0, 0, e), aSeed) - galetWarp(position - vec3(0, 0, e), aSeed)) / (2.0 * e);
      objectNormal = normalize(transpose(inverse(J)) * objectNormal);
    }`)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = galetWarp(position, aSeed);')
}

export function galetBlack({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.black, roughness: T.blackRough, metalness: 0, specularIntensity: 0.5,
    clearcoat: T.blackCoat, clearcoatRoughness: 0.5,
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh) // vObj stays the unwarped lens point: the grain is fixed to the stone
    warpVS(sh, R)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;').replace('void main() {', GRIT + '\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0;
        { // dark shale or basalt: a tone per stone, broad cloudy patches, a fine mineral grain with a few pale flecks
          float n = vnoise(vObj.xz * 0.28 + sd), g = gritH(vObj.xz, sd);
          g = mix(g, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 7.7)));
          float fl = speck(vObj.xz, 3.0, 0.22, 0.09, sd) * (1.0 - uHC);
          diffuseColor.rgb *= (0.84 + 0.26 * fract(sd * 0.31)) * (0.92 + 0.16 * n) * (1.0 + ${T.grainB.toFixed(3)} * (g - 0.5) * 2.0 * (1.0 - uHC));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.03, 1.0, 0.96), fract(sd * 0.67)); // some warmer, some cooler
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.105, 0.1), fl * ${T.fleck.toFixed(3)});
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        { // the river polished some places smoother: soft patches of sheen in the matte stone, plus the grain's tooth
          float p = smoothstep(0.4, 0.85, vnoise(vObj.xz * 0.22 - sd * 1.3));
          float g = gritH(vObj.xz, sd); g = mix(g, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 7.7)));
          roughnessFactor = clamp(mix(roughnessFactor, ${T.blackPolish.toFixed(3)}, p) * (0.85 + 0.3 * g), 0.2, 1.0); }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = grit(normal, vObj.xz, sd, ${T.bumpB.toFixed(3)} * (1.0 - 0.7 * uHC));`)
  }
  const key = 'galets-black' + JSON.stringify(T) // TUNE is baked into the shader
  m.customProgramCacheKey = () => key
  return m
}

export function galetWhite({ hc, R }: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.white, roughness: T.whiteRough, metalness: 0, specularIntensity: 0.4,
    sheen: 0.25, sheenColor: new THREE.Color(0xf4efe4), sheenRoughness: 0.8, // the dry, dusty bloom of sandstone
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    warpVS(sh, R)
    sh.uniforms.uHC = hc
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC;').replace('void main() {', GRIT + '\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        { // pale sandstone: a tone per stone, soft layered clouding, fine speckles and a few darker grains (none in high contrast)
          float n = vnoise(vec2(dot(vObj.xz, gph2(sd)) * 0.5, 0.0) + vec2(0.0, sd)) * 0.5 + vnoise(vObj.xz * 0.6 - sd) * 0.5;
          float g = gritH(vObj.xz, sd); g = mix(g, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 7.7)));
          float fine = speck(vObj.xz, 4.2 * ${T.speckCount.toFixed(3)}, 0.4, 0.13, sd) + 0.7 * speck(vObj.xz + 31.0, 2.6 * ${T.speckCount.toFixed(3)}, 0.25, 0.12, sd);
          float big = speck(vObj.xz - 17.0, 0.7, 0.18 * ${T.grains.toFixed(3)}, 0.13, sd);
          float mute = 1.0 - uHC;
          diffuseColor.rgb *= (0.96 + 0.06 * fract(sd * 0.41)) * (1.0 - (${T.cloudW.toFixed(3)} * n + ${T.grainW.toFixed(3)} * g) * mute);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.985, 0.95), fract(sd * 0.83) * mute); // some warmer, some greyer
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.41, 0.36), ${T.speck.toFixed(3)} * min(fine, 1.0) * mute);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.27, 0.24, 0.21), 0.75 * big * mute);
          // a greyer, deeper edge (a firm dark rim in high contrast)
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.92, 0.91, 0.88), vec3(0.35, 0.31, 0.27), uHC), smoothstep(0.75 + 0.1 * uHC, 1.0, rr) * (0.5 + 0.5 * uHC));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.92 + 0.16 * vnoise(vObj.xz * 3.0 + sd)), 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = grit(normal, vObj.xz, sd, ${T.bumpW.toFixed(3)} * (1.0 - 0.7 * uHC));`)
  }
  const key = 'galets-white' + JSON.stringify(T)
  m.customProgramCacheKey = () => key
  return m
}

export default { black: galetBlack, white: galetWhite } satisfies StoneGL
