import { describe, expect, it } from 'vitest'
import { KAYA, WOODS, readyWoods, woodOf } from '../gobans'

const gl = import.meta.glob<{ default: { glsl: string } }>('./*.gl.ts', { eager: true })

describe('woods', () => {
  it('every listed wood has its file', () => expect(readyWoods()).toEqual([...WOODS]))
  it('grades stay in a sane range and the 2D colours are sRGB bytes, light over dark', () => {
    for (const w of WOODS.filter(w => w !== 'kaya')) {
      const d = woodOf(w)
      expect(d).not.toBe(KAYA)
      for (const v of d.tint!) expect(v).toBeGreaterThan(0.1), expect(v).toBeLessThan(1.5)
      for (const v of [d.contrast ?? 1, d.saturation ?? 1, d.roughness ?? 1]) expect(v).toBeGreaterThan(0.3), expect(v).toBeLessThan(1.6)
      for (const v of Object.values(d.snd!)) expect(v).toBeGreaterThan(0.75), expect(v).toBeLessThan(1.25)
      const { light, dark } = d.skin2d!
      light.forEach((v, i) => { expect(Number.isInteger(v) && v <= 255).toBe(true); expect(v).toBeGreaterThan(dark[i]) })
    }
  })
  it('each pattern defines both hooks', () => {
    expect(Object.keys(gl).sort()).toEqual(['./bambou.gl.ts', './katsura.gl.ts'])
    for (const { default: { glsl } } of Object.values(gl)) {
      expect(glsl).toMatch(/vec3 woodColor\(vec3 c, vec3 p, vec3 n\)/)
      expect(glsl).toMatch(/float woodRough\(float r, vec3 p, vec3 n\)/)
    }
  })
})
