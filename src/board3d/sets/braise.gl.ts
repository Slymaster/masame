// Ember and ice materials (three.js): rough basalt with a few thin cracks whose glow breathes very slowly with the ambient
// clock (still when it is still), and blue-white ice with bright fracture planes deep inside and a frosty rim. No transmission.
import * as THREE from 'three'
import { stoneVS } from '../stoneGlsl'
import type { StoneCtx, StoneGL } from '../stones'

/**
 * Tunables (read when the materials are built). cell: crack cells per mm; cracks: share of the cell edges that are cracks;
 * glow: the cracks' emissive strength; breath: its slow swing (± share) over period s; planes: the ice's fracture planes.
 */
export const TUNE = {
  basalt: 0x151413, basaltRough: 0.62, cell: 0.12, cracks: 0.3, width: 0.06, glow: 2.6, halo: 0.15, breath: 0.2, period: 8,
  ice: 0xd4e4f6, iceRough: 0.16, iceCoat: 0.5, planes: 2, lines: 0.6, iceCracks: 0.3, shine: 1.2, frost: 0.5, depth: 1.2, cool: 0.5,
}
const f = (x: number) => x.toFixed(3)
const uniforms = (sh: THREE.WebGLProgramParametersWithUniforms, { hc, time }: StoneCtx) => {
  sh.uniforms.uHC = hc; sh.uniforms.uTime = time
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uHC, uTime;')
}

/** vView: the object-space ray from the camera to the fragment (mm), for things seen deep inside a stone (nebuleuse.gl.ts too). */
export function viewVS(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vView;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      vView = position - (inverse(modelMatrix * instanceMatrix) * vec4(cameraPosition, 1.0)).xyz;
      #else
      vView = position - (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      #endif`)
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vView;')
}

/** A height h (mm) bumped onto the normal N, scaled in world mm like galets.gl.ts. */
export const BUMP = /* glsl */`
vec3 bumpMm(vec3 N, float h) {
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, N), r2 = cross(N, sx);
  float det = dot(sx, r1); vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * N - g);
}`

const CRACKS = /* glsl */`
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// x: distance (cell units) to the nearest edge between two Voronoi cells, approximated by (F2 - F1) / 2;
// y: a random value per edge (the same on both sides), to open only some edges as cracks
vec2 vorEdge(vec3 x) {
  vec3 i = floor(x), fr = fract(x), c1 = vec3(0.0), c2 = vec3(0.0); float d1 = 8.0, d2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int l = -1; l <= 1; l++) {
    vec3 g = vec3(float(l), float(j), float(k)), r = g + h33(i + g) - fr; float d = dot(r, r);
    if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = i + g; } else if (d < d2) { d2 = d; c2 = i + g; }
  }
  return vec2(0.5 * (sqrt(d2) - sqrt(d1)), fract(h33(c1 + c2).x + h33(abs(c1 - c2) + 3.1).y));
}
// coverage of a line of half-width w at distance e, kept to its true share of the pixel when it is thinner than one
float lineCov(float e, float w) { float fe = max(fwidth(e), 1e-4), ww = max(w, fe); return (1.0 - smoothstep(ww - fe, ww + fe, e)) * (w / ww); }`

export function basalt(ctx: StoneCtx) {
  const T = TUNE
  const m = new THREE.MeshPhysicalMaterial({
    color: T.basalt, roughness: T.basaltRough, metalness: 0, specularIntensity: 0.5,
    clearcoat: 0.08, clearcoatRoughness: 0.5, // worn, not polished
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    uniforms(sh, ctx)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CRACKS + BUMP)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0;
        // the cracks: edges of large jagged cells, only some of them open (a few per stone)
        vec3 P = vObj + 1.1 * vec3(vnoise(vObj.xz * 0.5 + sd) - 0.5, vnoise(vObj.xy * 0.5 - sd) - 0.5, vnoise(vObj.zy * 0.5 + sd * 1.3) - 0.5);
        vec2 ve = vorEdge(P * ${f(T.cell)} + sd);
        float e = ve.x / ${f(T.cell)}, open = step(${f(1 - T.cracks)}, ve.y); // mm; a share of the edges are open
        float wv = ${f(T.width)} * (0.6 + 0.8 * vnoise(P.xz * 0.9 + sd)) * open; // the crack narrows and widens
        float core = lineCov(e, wv) * open, halo = exp(-e / 0.28) * open;
        // vesicular basalt: an uneven grey-black, small gas pits
        float n1 = vnoise(vObj.xz * 1.6 + sd), n2 = vnoise(vObj.xz * 4.3 - sd);
        float grit = mix(0.6 * n1 + 0.4 * n2, 0.5, smoothstep(0.3, 0.9, fwidth(vObj.x * 4.3)));
        vec2 pc = vObj.xz * 1.3 + sd, pi = floor(pc), po = fract(pc) - 0.5 - 0.5 * (vec2(h21(pi), h21(pi + 7.1)) - 0.5);
        float pr = 0.08 + 0.1 * h21(pi + 3.3), pw = fwidth(pc.x);
        float pit = step(0.93, h21(pi * 1.7 + sd)) * (1.0 - smoothstep(pr * 0.2, pr + pw, length(po))) * (1.0 - smoothstep(0.3, 0.8, pw));
        diffuseColor.rgb *= (0.9 + 0.2 * fract(sd * 0.31)) * (0.82 + 0.36 * grit) * (1.0 - 0.25 * pit) * (1.0 - 0.7 * core);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor * (0.8 + 0.4 * grit) + 0.25 * pit, 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { float fade = 1.0 - smoothstep(0.25, 0.9, fwidth(vObj.x * 4.3));
          normal = bumpMm(normal, fade * (0.025 * grit - 0.025 * pit - 0.05 * core)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { // the glow breathes very slowly, out of step from stone to stone, with hotter spots drifting along the cracks;
          // muted in high contrast and on a dying stone (dimOf greys the base colour)
          float breath = 1.0 + ${f(T.breath)} * sin(6.2832 * uTime / ${f(T.period)} + sd * 3.7);
          float hot = 0.6 + 0.8 * vnoise(P.xz * 0.35 + vec2(uTime * 0.025, sd));
          float mute = (1.0 - 0.75 * uHC) * mix(1.0, 0.25, smoothstep(0.02, 0.06, diffuse.g));
          totalEmissiveRadiance += (vec3(1.0, 0.36, 0.08) * core + vec3(0.8, 0.12, 0.02) * ${f(T.halo)} * halo * halo)
            * ${f(T.glow)} * breath * hot * mute;
        }`)
  }
  m.customProgramCacheKey = () => 'braise-black'
  return m
}

export function ice(ctx: StoneCtx) {
  const T = TUNE, R = ctx.R
  const m = new THREE.MeshPhysicalMaterial({
    color: T.ice, roughness: T.iceRough, metalness: 0, ior: 1.31, specularIntensity: 0.8,
    clearcoat: T.iceCoat, clearcoatRoughness: 0.08, // a wet, polished face
    emissive: new THREE.Color(0.06, 0.08, 0.11), // light scattered in the ice comes back out, cool
  })
  m.onBeforeCompile = sh => {
    stoneVS(sh)
    viewVS(sh)
    uniforms(sh, ctx)
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CRACKS)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float sd = vSeed * 97.0, rr = length(vObj.xz) / ${R.toFixed(2)};
        vec3 V = normalize(vView); V = normalize(vec3(V.x * 0.76, V.y, V.z * 0.76)); // bent at the surface (ice's ior)
        // a few fracture planes deep in the ice: where the ray meets one inside the stone, a bright feathered sheet
        float sheet = 0.0, frEdge = 0.0;
        for (int i = 0; i < ${T.planes}; i++) {
          float fi = float(i);
          vec3 n = normalize(h21(vec2(sd, fi)) < 0.5 ? vec3(h21(vec2(fi, sd)) - 0.5, 0.35 + h21(vec2(sd, fi + 3.0)), h21(vec2(fi + 1.0, sd)) - 0.5)
                                                     : vec3(h21(vec2(fi, sd)) - 0.5, 0.1 * h21(vec2(sd, fi + 3.0)), h21(vec2(fi + 1.0, sd)) - 0.5));
          vec3 c = vec3(h21(vec2(sd * 1.3, fi)) - 0.5, (h21(vec2(fi, sd * 0.7)) - 0.5) * 0.5, h21(vec2(sd * 0.9, fi + 2.0)) - 0.5) * ${f(R)};
          // no early exit: fwidth below needs every fragment to run the same path
          float dv = dot(n, V), t = dot(n, c - vObj) / (dv < 0.0 ? min(dv, -0.02) : max(dv, 0.02));
          vec3 q = vObj + V * clamp(t, 0.0, 30.0);
          float ok = step(0.15, t) * step(t, 30.0) * step(length(q.xz), ${f(R * 0.92)}) * step(abs(q.y), 3.6);
          vec3 u = normalize(cross(n, vec3(0.3, 1.0, 0.2))), w = cross(n, u);
          vec2 s = vec2(dot(q - c, u), dot(q - c, w));
          float ex = (4.0 + 3.0 * h21(vec2(fi, sd * 2.1))) * (0.75 + 0.5 * vnoise(s * 0.5 + fi * 3.1 + sd));
          float inside = ok * (1.0 - smoothstep(ex * 0.75, ex, length(s)));
          // feathered: fine parallel ripples across the sheet, faded where they would alias
          float rp = s.x * 2.2 + 1.5 * vnoise(s * 0.6 + sd), ra = 1.0 - smoothstep(0.3, 0.8, fwidth(rp));
          float rip = mix(0.8, 0.65 + 0.35 * smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(rp)), ra);
          sheet += inside * rip * (0.4 + 0.6 * pow(1.0 - abs(dv), 2.0)) * exp(-t * 0.08);
          frEdge += ok * (1.0 - smoothstep(0.0, 0.25 + fwidth(length(s)), abs(length(s) - ex * 0.85))) * pow(1.0 - abs(dv), 2.0);
        }
        sheet = min(sheet, 1.4) * (1.0 - uHC);
        // crackled ice: fine fracture lines at two depths, seen edge-on, shifting with the view
        float crk = 0.0, shade = 0.0;
        for (int i = 0; i < 2; i++) {
          float fi = float(i), dk = 0.7 + 1.6 * fi;
          vec3 q = vObj + V * dk / max(-V.y, 0.3);
          q += 0.8 * vec3(vnoise(q.xz * 0.6 + sd) - 0.5, 0.0, vnoise(q.zx * 0.6 - sd) - 0.5);
          vec2 ve = vorEdge(q * ${f(T.cell * 1.6)} + sd + fi * 5.3);
          float e = ve.x / ${f(T.cell * 1.6)}, open = step(${f(1 - T.iceCracks)}, ve.y);
          float k = open * (1.0 - 0.45 * fi) * (1.0 - smoothstep(0.75, 0.97, rr)), wl = ${f(T.width * 0.5)} * (0.4 + 1.2 * vnoise(q.xz * 1.3 + fi));
          crk += lineCov(e, wl) * k;
          shade += lineCov(e, wl * 5.0) * k;
        }
        crk *= ${f(T.lines)} * (1.0 - uHC); shade = min(shade, 1.0) * ${f(T.lines)} * (1.0 - uHC);
        diffuseColor.rgb *= 1.0 - vec3(0.16, 0.1, 0.04) * shade; // the fracture's cold blue shadow beside its bright edge
        // deep blue where the ice is thick, a frosty white rim; a firm grey rim in high contrast
        float cl = 0.6 * vnoise(vObj.xz * 0.35 + sd) + 0.4 * vnoise(vObj.xz * 1.1 - sd);
        diffuseColor.rgb *= (0.98 + 0.03 * fract(sd * 0.41)) * mix(vec3(1.0), vec3(0.8, 0.88, 0.98), ${f(T.depth)} * (1.0 - smoothstep(0.2, 0.85, rr)) * (0.6 + 0.8 * cl) * (1.0 - uHC));
        float frost = smoothstep(0.7, 1.0, rr) * (0.6 + 0.4 * vnoise(vObj.xz * 2.7 + sd)) * (1.0 - uHC);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.98, 1.0), ${f(T.frost)} * frost);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.36, 0.38, 0.42), smoothstep(0.85, 1.0, rr) * uHC);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + 0.5 * frost * ${f(T.frost)}, 0.05, 1.0); // the frost breaks the polish`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { // fake translucency: the shade fills with a cool blue, the thin rim glows against the light; the sheets catch the light
          float thin = smoothstep(0.55, 1.0, rr) * (1.0 - uHC);
          vec3 B = vec3(0.72, 0.86, 1.0) * diffuseColor.rgb;
          reflectedLight.indirectDiffuse *= mix(vec3(1.0), vec3(0.9, 0.97, 1.1), ${f(T.cool)} * (1.0 - uHC));
          reflectedLight.indirectDiffuse += B * (irradiance + iblIrradiance) * thin * 0.15;
          vec3 lit = irradiance + iblIrradiance;
          #if NUM_DIR_LIGHTS > 0
          vec3 L = directionalLights[0].direction; float nl = dot(normal, L);
          float wrap = clamp((nl + 0.5) / 1.5, 0.0, 1.0) * (1.0 - clamp(nl, 0.0, 1.0));
          float back = pow(clamp(dot(-geometryViewDir, L), 0.0, 1.0), 2.0);
          reflectedLight.directDiffuse += directionalLights[0].color * B * thin * (0.4 * wrap + 0.7 * back);
          lit += directionalLights[0].color * (0.35 + 0.65 * clamp(nl, 0.0, 1.0));
          #endif
          reflectedLight.indirectSpecular += vec3(0.86, 0.94, 1.0) * lit * (sheet * ${f(T.shine * 0.12)} + crk * 0.8);
          reflectedLight.indirectSpecular += vec3(0.9, 0.96, 1.0) * lit * min(frEdge, 1.0) * (1.0 - uHC) * ${f(T.shine * 0.1)};
        }`)
  }
  m.customProgramCacheKey = () => 'braise-white'
  return m
}

export default { black: basalt, white: ice, animated: true } satisfies StoneGL
