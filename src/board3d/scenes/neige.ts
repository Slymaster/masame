// Nuit de neige: snow falling softly in the garden beyond the veranda (never over the board), the engawa's dark weathered
// planks under the board, and a narrow line of snow along the veranda's far edge.
import * as THREE from 'three'
import { particles, PARTICLES, skyDome, type ParticleLook } from '../fx'
import type { Scene } from '.'

const PLANK_MM = 720, PLANKS = 5 // one tile: five 144 mm planks, running side to side like an engawa's
/** The veranda's edge (mm, beyond the board): the snow line lies just past it, the falling snow further out. */
const EDGE_Z = -420
// the garden behind the room: the graded birchwood, pre-blurred (backdrop_2k.jpg), the birches on the far side
const GARDEN = /* glsl */`
uniform sampler2D uMap; uniform float uRot, uGain;
vec3 sky(vec3 d) {
  float a = atan(d.z, d.x) + uRot;
  return texture2D(uMap, vec2(fract(a / 6.28318 + 0.5), asin(clamp(d.y, -1.0, 1.0)) / 3.14159 + 0.5)).rgb * uGain;
}`
const SNOW: ParticleLook = { ...PARTICLES.snow, fall: 42, drift: [12, 5], sway: 20, size: 11, color: 0xdde6f6, opacity: 0.6 }

/** Weathered planks (colour and bump), drawn with whole cycles across the tile so it wraps. */
function plankMaps(seed = 7) {
  const S = 1024, px = S / PLANK_MM, col = document.createElement('canvas'), hgt = document.createElement('canvas')
  col.width = col.height = hgt.width = hgt.height = S
  let s = seed
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  const ci = col.getContext('2d')!.createImageData(S, S), hi = hgt.getContext('2d')!.createImageData(S, S)
  const ph = S / PLANKS, gap = 2.5 * px
  const planks = Array.from({ length: PLANKS }, () => ({
    l: 0.8 + 0.3 * r(), warm: r(), joint: Math.floor(r() * S), f: [1 + Math.floor(r() * 2), 2 + Math.floor(r() * 3)], p: [r() * 6.28, r() * 6.28, r() * 6.28], k: 6 + 6 * r(),
  }))
  const fibre = Array.from({ length: S }, () => r() - 0.5) // fine fibres: one value per row, so they run along the plank
  for (let y = 0; y < S; y++) {
    const pi = Math.floor(y / ph), P = planks[pi], v = (y - pi * ph) / ph
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4, u = (x / S) * 6.2832
      // grain: latewood lines along x, drifting slowly across the plank (whole cycles, so the tile wraps); weathering leaves them proud
      const drift = 0.5 * Math.sin(u * P.f[0] + P.p[0]) + 0.25 * Math.sin(u * P.f[1] + P.p[1])
      const ring = ((v * P.k + drift) % 1 + 1) % 1
      const late = Math.max(0, (ring - 0.78) / 0.22) ** 1.5
      const wear = 0.94 + 0.06 * Math.sin(u + P.p[2])
      const lum = P.l * wear * (1 - 0.16 * late) * (1 + 0.07 * fibre[y])
      // silver-grey weathered cedar with a little warmth left in some boards
      let c = [70 + 12 * P.warm, 61 + 6 * P.warm, 55], h = 0.5 + 0.3 * late
      const dy = Math.min(y - pi * ph, (pi + 1) * ph - y), dx = Math.abs(((x - P.joint + S * 1.5) % S) - S / 2)
      const edge = Math.min(dy / gap, (S / 2 - dx) / gap) // 0 in a gap
      if (edge < 1) { c = [14, 12, 11]; h = 0.05 } else { c = c.map(ch => ch * lum); if (edge < 2.2) { const e = (edge - 1) / 1.2; c = c.map(ch => ch * (0.7 + 0.3 * e)); h *= 0.6 + 0.4 * e } }
      ci.data[o] = c[0]; ci.data[o + 1] = c[1]; ci.data[o + 2] = c[2]; ci.data[o + 3] = 255
      hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = h * 255; hi.data[o + 3] = 255
    }
  }
  col.getContext('2d')!.putImageData(ci, 0, 0); hgt.getContext('2d')!.putImageData(hi, 0, 0)
  return [col, hgt] as const
}

export default (): Scene => {
  let snow: ReturnType<typeof particles>[] = [] // none at fx 1 (still)
  const owned: { dispose(): void }[] = []
  return {
    animated: true,
    async build(ctx) {
      const tex = await new THREE.TextureLoader().loadAsync(`${ctx.base}neige/backdrop_2k.jpg`)
      tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter // pre-blurred, and no mip seam at the wrap
      const garden = skyDome(GARDEN, { uMap: { value: tex }, uRot: { value: 1.57 }, uGain: { value: 2.4 } })
      ctx.root.add(garden.mesh); owned.push(garden, tex)
      const [c, h] = plankMaps(), plane = 3200, aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
      const tile = (cv: HTMLCanvasElement, srgb: boolean) => {
        const t = new THREE.CanvasTexture(cv)
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(plane / PLANK_MM, plane / PLANK_MM); t.anisotropy = aniso
        if (srgb) t.colorSpace = THREE.SRGBColorSpace
        return t
      }
      ctx.setGround({ map: tile(c, true), bumpMap: tile(h, false), roughness: 0.78, tint: 1 })
      // the garden's snow: from the veranda's edge on (fading into the backdrop's own snow) and all around the planks, plus a
      // narrow drift along the edge, its top softly rounded
      const fadeCv = document.createElement('canvas'); fadeCv.width = 4; fadeCv.height = 64
      const fx2 = fadeCv.getContext('2d')!, grad = fx2.createLinearGradient(0, 0, 0, 64)
      grad.addColorStop(0, '#000'); grad.addColorStop(0.55, '#fff'); fx2.fillStyle = grad; fx2.fillRect(0, 0, 4, 64)
      const fade = new THREE.CanvasTexture(fadeCv)
      const mat = new THREE.MeshStandardMaterial({ color: 0x404858, roughness: 0.95, emissive: 0x34425e }) // mostly its own cool glow: the night sky's light, barely warmed by the lamp
      const fieldMat = mat.clone(); Object.assign(fieldMat, { alphaMap: fade, transparent: true, depthWrite: false })
      const geo = new THREE.CylinderGeometry(1, 1, 8000, 24, 1, true, 0, Math.PI)
      geo.rotateZ(Math.PI / 2); geo.scale(1, 26, 80).translate(0, -60, EDGE_Z)
      const field = new THREE.PlaneGeometry(8000, 2400).rotateX(-Math.PI / 2).translate(0, -59, EDGE_Z - 1200)
      const around = new THREE.PlaneGeometry(9000, 4000).rotateX(-Math.PI / 2).translate(0, -64, EDGE_Z + 2000) // beside the veranda, under the planks
      const meshes = [new THREE.Mesh(geo, mat), new THREE.Mesh(field, fieldMat), new THREE.Mesh(around, mat)]
      for (const m of meshes) { m.receiveShadow = true; ctx.root.add(m) }
      owned.push(geo, field, around, mat, fieldMat, fade)
      // the snowfall: the garden beyond the edge, and a few flakes the wind carries in beside the board (never over it), gone above the planks
      const side = ctx.board.BW / 2 + 200
      if (ctx.fx === 2) snow = [particles(SNOW, [-2200, -60, -2800, 2200, 1300, EDGE_Z - 60], 3000, 40),
        particles(SNOW, [-side - 300, 120, -450, -side, 520, 300], 50, 170, 2), particles(SNOW, [side, 120, -450, side + 300, 520, 300], 50, 170, 3)]
      for (const p of snow) ctx.root.add(p.mesh)
    },
    update(_dt, t) { for (const p of snow) p.update(t) },
    dispose() { for (const p of snow) p.dispose(); for (const o of owned) o.dispose() },
  }
}
