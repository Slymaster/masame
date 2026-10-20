// Shader helpers any stone set's materials may reuse (sets/<id>.gl.ts).
import type * as THREE from 'three'

export const GLSL_NOISE = /* glsl */`
varying vec3 vObj; varying float vSeed;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`
type Shader = THREE.WebGLProgramParametersWithUniforms
/** vObj (object-space position, mm) and vSeed (per stone, 0..1) for the fragment shader, plus GLSL_NOISE. */
export function stoneVS(sh: Shader) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSeed;\nvarying vec3 vObj; varying float vSeed;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position; vSeed = aSeed;')
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_NOISE)
}

