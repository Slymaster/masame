// Heirloom set's materials: the Japanese slate and shell (japonaise.gl.ts), aged by ctx.patina (0 new … 1 after 300 games).
// The shell yellows to a warm ivory and its growth lines deepen; the slate polishes, most on the dome where fingers hold it.
// Every change is scaled by the patina, so at 0 the stones render exactly as the Japanese ones.
import { shellMaterial, slateMaterial } from './japonaise.gl'
import type { StoneCtx, StoneGL } from '../stones'

// full age: slate roughness × (1 − SLATE_POLISH − RUB·touch), clear coat × (1 + SLATE_COAT), its roughness × (1 − SLATE_COAT_SMOOTH);
// shell body × IVORY, lines darkened by LINES
const SLATE_POLISH = 0.3, RUB = 0.25, SLATE_COAT = 0.6, SLATE_COAT_SMOOTH = 0.4
const IVORY = 'vec3(1.0, 0.94, 0.81)', LINES = 'vec3(0.07, 0.09, 0.13)'

type M = ReturnType<typeof slateMaterial>
/** The material with its shader extended after the Japanese one (same order: the patina code reads its variables). */
function aged(m: M, key: string, { patina }: StoneCtx, edit: (fs: string) => string) {
  const base = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r)
    sh.uniforms.uPatina = patina
    sh.fragmentShader = edit(sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPatina;'))
  }
  m.customProgramCacheKey = () => key
  return m
}

export default {
  black: ctx => aged(slateMaterial(), 'famille-slate', ctx, fs => fs
    .replace('#include <metalnessmap_fragment>', `{ // the polish: everywhere a little, most where the fingers rub the dome (off centre, per stone)
        vec2 o = vec2(fract(vSeed * 41.3) - 0.5, fract(vSeed * 17.9) - 0.5) * 4.0;
        float touch = (1.0 - smoothstep(0.0, ${(ctx.R * 0.7).toFixed(2)}, length(vObj.xz - o))) * step(0.0, vObj.y);
        roughnessFactor *= 1.0 - uPatina * (${SLATE_POLISH.toFixed(3)} + ${RUB.toFixed(3)} * touch); }
      #include <metalnessmap_fragment>`)
    .replace('#include <lights_fragment_begin>', `#ifdef USE_CLEARCOAT
      material.clearcoat = min(1.0, material.clearcoat * (1.0 + ${SLATE_COAT.toFixed(3)} * uPatina));
      material.clearcoatRoughness *= 1.0 - ${SLATE_COAT_SMOOTH.toFixed(3)} * uPatina;
      #endif
      #include <lights_fragment_begin>`)),
  white: ctx => aged(shellMaterial(ctx), 'famille-shell', ctx, fs => fs
    .replace('#include <roughnessmap_fragment>', `{ // each stone ages a little differently; the girdle, handled most, a little more
        float age = uPatina * (0.85 + 0.3 * fract(sd * 0.43)) * (1.0 + 0.25 * smoothstep(0.7, 1.0, rr));
        diffuseColor.rgb *= mix(vec3(1.0), ${IVORY}, age);
        diffuseColor.rgb *= 1.0 - uPatina * (${LINES} * stripe + ${LINES} * 0.6 * band); }
      #include <roughnessmap_fragment>`)),
} satisfies StoneGL
