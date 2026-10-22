// PROTOTYPE (dev page only, imported by demo.ts alone): the AI opponent's right hand, in a dark silk sleeve, takes a
// stone from his bowl and places it. The seated camera never shows his face, so he is a hand, a sleeve and, as an option,
// the shadow of his body (an invisible stand-in that only the lamp's shadow pass sees).
// Hand: MakeHuman (CC0, made with MPFB by scripts/hand-makehuman.py), or for comparison the WebXR Input Profiles
// "generic-hand" (MIT, smoothed by scripts/hand-smooth.py); see hand/CREDITS.md. Units mm, y up, board top ≈ 0, he sits at −z.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Vertex } from '@sabaki/go-board'
import type { Board3D } from './Board3D'
import { DROP_MS, dropPose } from './logic'
import { stoneLayer } from './stones'
import mhUrl from './hand/hand-mh.glb?url'
import webxrUrl from './hand/right-smooth.glb?url'

export type V3 = [number, number, number]
/** Upper arm and forearm (shoulder → elbow → wrist), mm; the arm never straightens past this share of its length. */
export const L1 = 300, L2 = 255, REACH = 0.92
const LEAN_MAX = 350

const v3 = (a: V3) => new THREE.Vector3(...a)
const arr = (v: THREE.Vector3): V3 => [v.x, v.y, v.z]

/** Analytic two-bone IK: the elbow in the plane of shoulder, target and pole; the reach capped at REACH·(l1 + l2). */
export function solveArm(S: V3, T: V3, l1: number, l2: number, pole: V3) {
  const s = v3(S), d = v3(T).sub(s), dist = d.length(), dir = d.clone().divideScalar(dist || 1)
  const r = Math.min(Math.max(dist, Math.abs(l1 - l2) + 1), REACH * (l1 + l2))
  const a = (l1 * l1 + r * r - l2 * l2) / (2 * r), h = Math.sqrt(Math.max(0, l1 * l1 - a * a))
  const p = v3(pole), pp = p.sub(dir.clone().multiplyScalar(p.dot(dir)))
  if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0).sub(dir.clone().multiplyScalar(-dir.y)) // pole along the arm: down
  pp.normalize()
  const elbow = s.clone().addScaledVector(dir, a).addScaledVector(pp, h), wrist = s.clone().addScaledVector(dir, r)
  return { elbow: arr(elbow), wrist: arr(wrist), capped: dist > r + 1e-6 }
}

/** The torso leans about the hips toward T, just enough (≤ LEAN_MAX mm at the shoulder) for the arm to reach it. */
export function lean(hip: V3, S0: V3, T: V3, cap: number) {
  const h = v3(hip), u = v3(S0).sub(h), len = u.length(), q = new THREE.Quaternion()
  const to = v3(T).sub(h), axis = new THREE.Vector3().crossVectors(u, to)
  if (axis.lengthSq() < 1e-6) return { shoulder: S0, q }
  axis.normalize()
  let ang = 0
  for (let k = 0; k < 4; k++) { // the shoulder also drops as it leans: settle the angle in a few steps
    const S = u.clone().applyAxisAngle(axis, ang).add(h), need = S.distanceTo(v3(T)) - cap + 10
    ang = Math.min(Math.max(0, ang + Math.asin(Math.min(1, Math.max(-1, need / len)))), 2 * Math.asin(LEAN_MAX / 2 / len)) // the shoulder's chord ≤ LEAN_MAX
  }
  q.setFromAxisAngle(axis, ang)
  return { shoulder: arr(u.applyQuaternion(q).add(h)), q }
}

/* ---------- fingers ---------- */

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const
type Finger = (typeof FINGERS)[number] | 'thumb'
/** The code speaks WebXR joint names; MakeHuman's game_engine rig names the same joints (no finger metacarpals). */
export const mhName = (n: string) => {
  if (n === 'wrist') return 'hand_r'
  const [f, ...j] = n.replace('-finger', '').split('-'), joint = j.join('-')
  const k: Record<string, string> = f === 'thumb' ? { metacarpal: '01', 'phalanx-proximal': '02', 'phalanx-distal': '03', tip: 'tip' } : { 'phalanx-proximal': '01', 'phalanx-intermediate': '02', 'phalanx-distal': '03', tip: 'tip' }
  return `${f}_${k[joint]}_r`
}
export type HandModel = 'mh' | 'webxr'
/** Degrees. Fingers: [MCP flex, PIP flex, DIP flex, spread (+ toward the pinky)]; thumb: [CMC flex, CMC abduction, MCP flex, IP flex]. */
type Pose = Record<Finger, [number, number, number, number]>
type Poses = Record<'rest' | 'reach' | 'grip' | 'press' | 'release', Pose>
/** The WebXR hand's poses (its rest pose is flat), kept for the before/after comparison. */
const POSES_WEBXR: Poses = {
  rest: { thumb: [10, 10, 10, 10], 'index-finger': [18, 22, 10, 0], 'middle-finger': [22, 28, 12, 0], 'ring-finger': [28, 34, 14, 0], 'pinky-finger': [32, 38, 15, 0] },
  reach: { thumb: [15, 15, 12, 10], 'index-finger': [6, 8, 4, 5], 'middle-finger': [4, 6, 3, -3], 'ring-finger': [35, 50, 25, 0], 'pinky-finger': [42, 58, 28, 0] },
  grip: { thumb: [25, 5, 20, 15], 'index-finger': [16, 6, 0, 1], 'middle-finger': [0, 6, 38, -1], 'ring-finger': [70, 90, 50, 0], 'pinky-finger': [78, 95, 55, 0] },
  press: { thumb: [25, 5, 20, 15], 'index-finger': [16, 6, 0, 1], 'middle-finger': [0, 6, 48, -1], 'ring-finger': [70, 90, 50, 0], 'pinky-finger': [78, 95, 55, 0] },
  release: { thumb: [20, 10, 15, 12], 'index-finger': [40, 45, 20, 1], 'middle-finger': [0, 4, 30, -1], 'ring-finger': [62, 80, 44, 0], 'pinky-finger': [70, 86, 48, 0] },
}
const HOLD_WEBXR = { along: 1.7, up: 8, side: 9 }
/** The MakeHuman hand's poses, counted from flat, parallel fingers (see `zero`). */
export const POSES: Poses = {
  rest: { thumb: [10, 10, 10, 10], 'index-finger': [18, 22, 10, 0], 'middle-finger': [22, 28, 12, 0], 'ring-finger': [28, 34, 14, 0], 'pinky-finger': [32, 38, 15, 0] },
  reach: { thumb: [15, 15, 12, 10], 'index-finger': [6, 8, 4, 5], 'middle-finger': [4, 6, 3, -3], 'ring-finger': [35, 50, 25, 0], 'pinky-finger': [42, 58, 28, 0] },
  // index and middle side by side, nearly flat; the stone in front of their tips, on the index's nail, the middle's
  // pad on its back half (see HOLD); at the pose the middle's last joint presses it flat, then the index slides back
  grip: { thumb: [25, 5, 20, 15], 'index-finger': [2, 3, 0, 1], 'middle-finger': [-20, 6, 42, -14], 'ring-finger': [70, 90, 50, 0], 'pinky-finger': [78, 95, 55, 0] },
  press: { thumb: [25, 5, 20, 15], 'index-finger': [2, 3, 0, 1], 'middle-finger': [-20, 6, 50, -14], 'ring-finger': [70, 90, 50, 0], 'pinky-finger': [78, 95, 55, 0] },
  // both fingers let go together (the index curling alone under a straight middle finger would read as a rude gesture)
  release: { thumb: [20, 10, 15, 12], 'index-finger': [24, 30, 14, 1], 'middle-finger': [12, 22, 20, -6], 'ring-finger': [62, 80, 44, 0], 'pinky-finger': [70, 86, 48, 0] },
}
const blendPose = (a: Pose, b: Pose, k: number) => Object.fromEntries((Object.keys(a) as Finger[]).map(f => [f, a[f].map((x, i) => x + (b[f][i] - x) * k)])) as Pose

/* ---------- the sleeve: a tube rebuilt each frame between two points, hanging on its down side ---------- */

const NA = 28, NL = 18
function tubeGeo() {
  const g = new THREE.BufferGeometry(), idx: number[] = []
  for (let i = 0; i < NL; i++) for (let k = 0; k < NA; k++) {
    const a = i * (NA + 1) + k, b = a + NA + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  g.setIndex(idx)
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NL + 1) * (NA + 1) * 3), 3))
  return g
}
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _ax = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3()
/** r(t) radius along the tube, sag(t) extra drop on the down side; seed shifts the folds. */
function tube(g: THREE.BufferGeometry, A: THREE.Vector3, B: THREE.Vector3, r: (t: number) => number, sag: (t: number) => number, seed: number) {
  const pos = g.attributes.position as THREE.BufferAttribute, len = A.distanceTo(B)
  _ax.subVectors(B, A).normalize()
  _u.set(0, -1, 0).addScaledVector(_ax, _ax.y); if (_u.lengthSq() < 1e-4) _u.set(1, 0, 0); _u.normalize() // "down" across the tube
  _w.crossVectors(_ax, _u)
  for (let i = 0; i <= NL; i++) {
    const t = i / NL
    _c.copy(A).addScaledVector(_ax, t * len)
    for (let k = 0; k <= NA; k++) {
      const th = (k / NA) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th)
      // folds: soft lengthwise ridges, a few slanted creases where the cloth bunches (stronger near the ends)
      const ridge = (x: number) => 1 - 2 * Math.abs(Math.sin(x / 2)) // sharp crests, soft troughs: cloth, not a corrugated tube
      const fold = 0.045 * ridge(5 * th + seed) + 0.035 * ridge(8 * th + 9 * t + seed * 2) + 0.05 * ridge(3 * th - 14 * t + seed) * (1 - Math.sin(Math.PI * t))
      let rr = r(t) * (1 + fold)
      const down = Math.max(0, ct)
      rr += sag(t) * down * down * (1 + 0.15 * Math.sin(7 * t + seed))
      _d.copy(_u).multiplyScalar(ct).addScaledVector(_w, st)
      pos.setXYZ(i * (NA + 1) + k, _c.x + _d.x * rr, _c.y + _d.y * rr, _c.z + _d.z * rr)
    }
  }
  pos.needsUpdate = true
  g.computeVertexNormals(); g.computeBoundingSphere()
}

/* ---------- the gesture ---------- */

const mj = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (10 - 15 * t + 6 * t * t) } // minimum jerk
interface Key { t: number; p: THREE.Vector3; q: THREE.Quaternion; pose: Pose; arc?: number }
/** ms: the moments the demo and the captures refer to. */
export const T = { reach: 0, bowl: 600, pick: 760, lift: 900, over: 1600, aim: 1720, hand: 1940, held: 1940 + DROP_MS + 110, out: 2240, gone: 2900 }

/** Where the stone sits: along the index's last phalanx (share of it: > 1 is past the tip, so the stone sticks out in
 *  front of the fingers), above its axis (mm), toward the middle finger (mm). */
export const HOLD = { along: 0.88, up: 10.5, side: 5 }

/** The hand's orientation at each key, degrees: [pitch of the back of the hand below horizontal, roll (+: thumb side up), yaw]. */
export const ORI: Record<'lap' | 'bowl' | 'pick' | 'lift' | 'over' | 'aim' | 'hand' | 'out', [number, number, number]> = {
  lap: [15, 10, 0], bowl: [10, -8, 0], pick: [5, -8, 0], lift: [8, -4, 0], over: [8, 0, 0], aim: [8, 0, 0], hand: [8, 0, 0], out: [10, 0, 0],
}

export type Variant = 'A' | 'B'
/** The MakeHuman skin's multiplier on its baked map (the map is a daylight albedo), and its surface. */
export const MH_TINT: [number, number, number] = [0.74, 0.67, 0.69]
export const MH_SKIN = { roughness: 0.5, specular: 0.5, sheen: 0.5 }

export class OpponentHand {
  readonly root = new THREE.Group()
  private hand = new THREE.Group() // the hand's frame: oriented, then placed so the stone point lands on the target
  private gl = new THREE.Group() // the glTF, metres → mm
  private joints = new Map<string, { o: THREE.Object3D; rest: THREE.Quaternion; flex: THREE.Vector3; side: THREE.Vector3; zero: [number, number] }>()
  private stone: THREE.InstancedMesh
  private indexTip: THREE.Object3D
  private arm: { lower: THREE.Object3D; wrist: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3; wq: THREE.Quaternion } | null = null // MakeHuman: the forearm bone
  private upper = tubeGeo(); private fore = tubeGeo(); private juban = tubeGeo()
  private body = new THREE.Group(); private torso = new THREE.Group()
  private keys: Key[] = []
  private spot = { x: 0, y: 0, z: 0, seed: 0, rotY: 0 }
  private hip = new THREE.Vector3(); private S0 = new THREE.Vector3()
  private start = -1; private fixed = -1 // play: the gesture's start (performance.now time); at(): the frozen ms
  private picked = false; private handed = false
  private onHandoff: (() => void) | null = null; private done: (() => void) | null = null
  // skin under a ~2400 K andon: a cool, low-chroma albedo so it reads as skin, not orange plastic; the sheen is the soft edge
  readonly skin = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.5, 0.36, 0.31), roughness: 0.58, specularIntensity: 0.55, sheen: 0.35, sheenColor: new THREE.Color(0.85, 0.6, 0.62), sheenRoughness: 0.55, vertexColors: true })
  // montsuki silk: a very dark charcoal with a hint of blue, a strong sheen so the folds read under the andon
  readonly silk = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.045, 0.048, 0.062), roughness: 0.42, sheen: 1, sheenColor: new THREE.Color(0.72, 0.74, 0.82), sheenRoughness: 0.28, side: THREE.DoubleSide })
  // the under-kimono (juban): a warm off-white edge inside the cuff, framing the wrist
  readonly cotton = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.6, 0.56, 0.48), roughness: 0.65, sheen: 0.5, sheenColor: new THREE.Color(0.9, 0.88, 0.82), sheenRoughness: 0.5, side: THREE.DoubleSide })
  variant: Variant = 'A'
  private P: Poses; private H: typeof HOLD

  private constructor(private view: Board3D, gltf: THREE.Group, readonly model: HandModel) {
    this.P = model === 'mh' ? POSES : POSES_WEBXR; this.H = model === 'mh' ? HOLD : HOLD_WEBXR
    this.gl.scale.setScalar(1000); this.gl.add(gltf); this.hand.add(this.gl); this.root.add(this.hand)
    this.gl.updateMatrixWorld(true)
    let mesh: THREE.SkinnedMesh | null = null
    gltf.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh })
    if (!mesh) throw new Error('hand: no skinned mesh')
    const m = mesh as THREE.SkinnedMesh
    const byName = (n: string) => { const k = model === 'mh' ? mhName(n) : n; return m.skeleton.bones.find(b => b.name === k) ?? gltf.getObjectByName(k)! }
    if (model === 'webxr') { // WebXR poses every joint in world space: chain them (attach keeps world transforms, so the bind matrices hold)
      const chains = [['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
        ...FINGERS.map(f => ['wrist', `${f}-metacarpal`, `${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])]
      for (const c of chains) for (let i = 1; i < c.length; i++) byName(c[i - 1]).attach(byName(c[i]))
    }
    this.gl.updateMatrixWorld(true)
    this.indexTip = byName('index-finger-tip')
    if (model === 'mh') { const lower = m.skeleton.bones.find(b => b.name === 'lowerarm_r')!, wrist = byName('wrist'); this.arm = { lower, wrist, q: lower.quaternion.clone(), p: lower.position.clone(), wq: wrist.quaternion.clone() } }
    // axes in the hand frame (= gl space before posing): palm normal −x; each finger's flexion axis = its direction × palm normal
    const inv = this.gl.matrixWorld.clone().invert(), at = (n: string) => byName(n).getWorldPosition(new THREE.Vector3()).applyMatrix4(inv)
    const P = new THREE.Vector3(-1, 0, 0)
    const mk = (n: string, dirFrom: string, dirTo: string, thumb = false) => {
      const o = byName(n), d = at(dirTo).sub(at(dirFrom)).normalize()
      const flex = new THREE.Vector3().crossVectors(d, P).normalize(), side = P.clone()
      // the thumb bends across the palm (about ~the palm normal) and swings out of it (about its own flexion axis)
      const wq = o.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.gl.getWorldQuaternion(new THREE.Quaternion()).invert()).invert()
      this.joints.set(n, { o, rest: o.quaternion.clone(), flex: (thumb ? side : flex).clone().applyQuaternion(wq), side: (thumb ? flex : side).clone().applyQuaternion(wq), zero: [0, 0] })
    }
    mk('thumb-metacarpal', 'thumb-metacarpal', 'thumb-tip', true); mk('thumb-phalanx-proximal', 'thumb-phalanx-proximal', 'thumb-tip', true); mk('thumb-phalanx-distal', 'thumb-phalanx-proximal', 'thumb-tip', true)
    const PH = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip']
    for (const f of FINGERS) for (const j of PH.slice(0, 3)) mk(`${f}-${j}`, `${f}-phalanx-proximal`, `${f}-tip`)
    // MakeHuman's rest pose is curled and fanned: poses count from flat, parallel fingers (degrees toward the palm, toward the pinky)
    if (model === 'mh') for (const f of FINGERS) {
      let prev = 0
      for (let i = 0; i < 3; i++) {
        const d = at(`${f}-${PH[i + 1]}`).sub(at(`${f}-${PH[i]}`)), a = THREE.MathUtils.radToDeg(Math.atan2(-d.x, -d.y))
        this.joints.get(`${f}-${PH[i]}`)!.zero = [a - prev, i ? 0 : THREE.MathUtils.radToDeg(Math.atan2(d.z, -d.y))]; prev = a
      }
    }
    if (model === 'webxr') { this.paintSkin(m, at); m.material = this.skin } else m.material = this.mhSkin((m.material as THREE.MeshStandardMaterial).map)
    m.castShadow = m.receiveShadow = true; m.frustumCulled = false
    // the sleeve
    for (const g of [this.upper, this.fore, this.juban]) { const s = new THREE.Mesh(g, g === this.juban ? this.cotton : this.silk); s.castShadow = s.receiveShadow = true; s.frustumCulled = false; this.root.add(s) }
    // the carried stone: the set's own white stone
    const kit = view.debug.kit
    this.stone = stoneLayer(kit.geoW, kit.white, 1); this.stone.count = 1; this.stone.setMatrixAt(0, new THREE.Matrix4())
    this.root.add(this.stone)
    this.buildBody()
    this.root.visible = false
  }

  /** The bundled MakeHuman hand, the WebXR one (before/after comparisons), or a MakeHuman .glb's bytes (a downloaded file). */
  static async load(view: Board3D, model: HandModel | ArrayBuffer = 'mh') {
    const loader = new GLTFLoader()
    const g = model instanceof ArrayBuffer ? await loader.parseAsync(model, '') : await loader.loadAsync(model === 'webxr' ? webxrUrl : mhUrl)
    return new OpponentHand(view, g.scene, model === 'webxr' ? 'webxr' : 'mh')
  }

  /** The MakeHuman hand's skin: its baked colour map (young_asian_male), toned for the andon, a sheen for the soft edge. */
  private mhSkin(map: THREE.Texture | null) {
    return new THREE.MeshPhysicalMaterial({ map, color: new THREE.Color().setRGB(...MH_TINT), roughness: MH_SKIN.roughness, specularIntensity: MH_SKIN.specular, sheen: MH_SKIN.sheen, sheenColor: new THREE.Color(0.9, 0.55, 0.5), sheenRoughness: 0.5 })
  }

  /** Skin colour by vertex (the GLB has no texture): creases darker (concavity), fingertips and knuckles a little
   *  redder, the nails a paler, pinker patch on the back of each fingertip. */
  private paintSkin(m: THREE.SkinnedMesh, at: (n: string) => THREE.Vector3) {
    const g = m.geometry, pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute, n = pos.count
    const col = new Float32Array(n * 3).fill(1), w = new THREE.Matrix4().copy(this.gl.matrixWorld).invert().multiply(m.matrixWorld)
    const P = Array.from({ length: n }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(w))
    // concavity: how far the neighbours' centre sits out along the normal, relative to the edge length
    const sum = P.map(() => new THREE.Vector3()), cnt = new Uint16Array(n), idx = g.index!.array
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const i = idx[t + e], j = idx[t + (e + 1) % 3]; sum[i].add(P[j]); cnt[i]++; sum[j].add(P[i]); cnt[j]++ }
    const nv = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(w)
    const tips = ['thumb', ...FINGERS].map(f => [at(`${f}-tip`), at(f === 'thumb' ? 'thumb-phalanx-distal' : `${f}-phalanx-distal`)] as const)
    const knuckles = FINGERS.flatMap(f => [at(`${f}-phalanx-proximal`), at(`${f}-phalanx-intermediate`)])
    for (let i = 0; i < n; i++) {
      const c = sum[i].divideScalar(cnt[i] || 1).sub(P[i]), e = Math.max(c.length(), 1e-6)
      nv.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
      const cav = THREE.MathUtils.clamp(nv.dot(c) / e * 2.2, 0, 1) // > 0: a crease
      let r = 1 - 0.45 * cav, gg = 1 - 0.5 * cav, b = 1 - 0.5 * cav
      for (const [tip, dist] of tips) {
        const ax = tip.clone().sub(dist), t = P[i].clone().sub(dist).dot(ax) / ax.lengthSq()
        if (t < 0.2 || t > 1.1) continue
        const cc = dist.clone().addScaledVector(ax, t), off = P[i].clone().sub(cc), dorsal = off.x / (off.length() || 1) // +x: the back of the hand
        const nail = THREE.MathUtils.smoothstep(dorsal, 0.4, 0.8) * THREE.MathUtils.smoothstep(t, 0.45, 0.62)
        const pad = THREE.MathUtils.smoothstep(-dorsal, -0.2, 0.6) * THREE.MathUtils.smoothstep(t, 0.3, 0.9)
        r *= 1 + 0.18 * nail + 0.05 * pad; gg *= 1 + 0.12 * nail - 0.06 * pad; b *= 1 + 0.2 * nail - 0.05 * pad
      }
      for (const k of knuckles) { const d = P[i].distanceTo(k), kk = Math.max(0, 1 - d / 14) * Math.max(0, (P[i].x - k.x) / 8); r *= 1 + 0.04 * kk; gg *= 1 - 0.06 * kk; b *= 1 - 0.06 * kk }
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  }

  /** A coarse body in seiza, invisible to the camera (no colour, no depth): only the lamp's shadow pass draws it. */
  private buildBody() {
    const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    const add = (parent: THREE.Group, g: THREE.BufferGeometry, x: number, y: number, z: number) => { const o = new THREE.Mesh(g, ghost); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o }
    // torso (pivoting at the hips): hakama/kimono bulk widening to the shoulders, the neck and head above
    add(this.torso, new THREE.CylinderGeometry(200, 175, 520, 20, 1).scale(1, 1, 0.62), 0, 260, 0)
    add(this.torso, new THREE.SphereGeometry(205, 20, 12).scale(1, 0.35, 0.62), 0, 520, 0) // the shoulders' slope
    add(this.torso, new THREE.CylinderGeometry(52, 58, 110, 12), 0, 600, 10)
    add(this.torso, new THREE.SphereGeometry(98, 20, 14).scale(0.9, 1.12, 1), 0, 730, 20) // the head, a topknot's bun on it
    add(this.torso, new THREE.SphereGeometry(38, 12, 8), 0, 840, -20)
    add(this.torso, new THREE.CapsuleGeometry(62, 240, 4, 10).rotateX(-0.9), 175, 330, 120) // the left arm, its hand on the lap
    this.body.add(this.torso)
    // the lap: thighs folded under in seiza, the hakama spreading on the tatami
    add(this.body, new THREE.BoxGeometry(440, 190, 470).translate(0, -95, 170), 0, 0, 0)
    this.root.add(this.body)
  }

  /** Builds the keyframes for a move at v: from his lap, to the bowl, over the board, onto the stone's rest spot, away. */
  private plan(v: Vertex) {
    const dbg = this.view.debug, bowl = dbg.bowl(-1), sp = this.spot = dbg.restSpot(v), G = bowl.y
    const BD = Math.abs(bowl.z) / 0.3
    this.hip.set(0, G + 200, -BD / 2 - 360); this.S0.set(-190, G + 720, this.hip.z)
    // hand orientation: fingers along `dir` (heading toward the target from his side), pitched down, palm down, rolled
    const ori = (to: THREE.Vector3, pitch: number, roll = 0, yaw = 0) => {
      const h = new THREE.Vector3(to.x - this.S0.x, 0, to.z - this.S0.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const F = h.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, -Math.sin(pitch), 0))
      const Pn = new THREE.Vector3(0, -1, 0).addScaledVector(F, F.y).normalize().applyAxisAngle(F, roll), Tn = new THREE.Vector3().crossVectors(F, Pn)
      // gl's frame: x = −palm normal, y = −fingers, z = −thumb side
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(Pn.clone().negate(), F.clone().negate(), Tn.clone().negate()))
    }
    const d = THREE.MathUtils.degToRad, R = new THREE.Vector3(sp.x, sp.y, sp.z), B = new THREE.Vector3(bowl.x + 8, bowl.top, bowl.z + 6)
    const lap = new THREE.Vector3(-170, G + 260, this.hip.z + 210)
    const P = this.P, O = (k: keyof typeof ORI, to: THREE.Vector3) => ori(to, d(ORI[k][0]), d(ORI[k][1]), d(ORI[k][2]))
    const lapTo = lap.clone().add(new THREE.Vector3(0, 0, 300)), up = (p: THREE.Vector3, x: number, y: number, z: number) => p.clone().add(new THREE.Vector3(x, y, z))
    this.keys = [
      { t: T.reach, p: lap, q: O('lap', lapTo), pose: P.rest },
      { t: T.bowl, p: up(B, 0, 55, -10), q: O('bowl', B), pose: P.reach, arc: 60 },
      { t: T.pick, p: up(B, 0, 24, 0), q: O('pick', B), pose: blendPose(P.reach, P.grip, 0.95) },
      { t: T.lift, p: up(B, 0, 60, -5), q: O('lift', B), pose: P.grip },
      { t: T.over, p: up(R, -4, 45, -12), q: O('over', R), pose: P.grip, arc: 70 },
      { t: T.aim, p: up(R, -1, 30, -4), q: O('aim', R), pose: P.grip },
      { t: T.hand, p: up(R, 0, 12, 0), q: O('hand', R), pose: P.grip },
      { t: T.hand + DROP_MS, p: R.clone(), q: O('hand', R), pose: P.press },
      { t: T.held, p: R.clone(), q: O('hand', R), pose: P.press },
      { t: T.out, p: up(R, 0, 18, -30), q: O('out', R), pose: P.release },
      { t: T.gone, p: lap, q: O('lap', lapTo), pose: P.rest, arc: 40 },
    ]
  }

  private _q = new THREE.Quaternion(); private _p = new THREE.Vector3()
  /** Poses everything for the gesture at ms. */
  private pose(ms: number) {
    const K = this.keys
    let i = 0
    while (i < K.length - 2 && ms >= K[i + 1].t) i++
    const a = K[i], b = K[i + 1], lin = (ms - a.t) / Math.max(1, b.t - a.t), s = mj(lin)
    const p = this._p.lerpVectors(a.p, b.p, s)
    if (b.arc) p.y += b.arc * Math.sin(Math.PI * s)
    // the press follows the falling stone exactly (it starts 12 mm up and falls DROP_MS)
    if (ms >= T.hand && ms < T.hand + DROP_MS) p.y = this.spot.y + dropPose(ms - T.hand).y
    const q = this._q.slerpQuaternions(a.q, b.q, s), pose = blendPose(a.pose, b.pose, s)
    // placed by where the grip would hold the stone, whatever the fingers do (the index slides out, the hand stays)
    this.fingers(this.P.grip)
    this.hand.position.set(0, 0, 0); this.hand.quaternion.copy(q); this.root.updateMatrixWorld(true)
    const hold = this.holdPoint(), off = p.clone().sub(hold.p)
    this.fingers(pose)
    this.hand.position.add(off); this.root.updateMatrixWorld(true)
    // the stone: in the fingers (tilted with them), flattening to the board's own stone for the handoff
    const carried = ms >= T.pick && ms < T.hand
    this.stone.visible = carried
    if (carried) {
      const fl = mj((ms - T.aim) / (T.hand - T.aim)), flat = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.spot.rotY)
      this.stone.position.copy(p); this.stone.quaternion.copy(hold.q).slerp(flat, ms >= T.aim ? fl : 0)
      ;(this.stone.geometry.attributes.aSeed.array as Float32Array)[0] = this.spot.seed; this.stone.geometry.attributes.aSeed.needsUpdate = true
    }
    // arm: the torso leans just enough, then the two-bone solve from the shoulder to the wrist
    const wrist = this.joints.get('thumb-metacarpal')!.o.parent!.getWorldPosition(new THREE.Vector3())
    const lw = lean(arr(this.hip), arr(this.S0), arr(wrist), REACH * (L1 + L2))
    const ik = solveArm(lw.shoulder, arr(wrist), L1, L2, [-1, -0.7, -0.2])
    if (ik.capped) { const dw = v3(ik.wrist).sub(wrist); this.hand.position.add(dw); this.stone.position.add(dw); this.root.updateMatrixWorld(true) } // out of reach: the hand follows the arm
    const S = v3(lw.shoulder), E = v3(ik.elbow), W = v3(ik.wrist), fd = W.clone().sub(E).normalize()
    tube(this.upper, S.clone().addScaledVector(E.clone().sub(S).normalize(), -40), E.clone().addScaledVector(E.clone().sub(S).normalize(), 30), t => 62 - 10 * t, t => 20 * Math.sin(Math.PI * t), 1.3)
    tube(this.fore, E.clone().addScaledVector(fd, -45), W.clone().addScaledVector(fd, 4), t => 46 + 6 * t + 8 * t ** 6, t => 18 * Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.7, 4.1)
    tube(this.juban, W.clone().addScaledVector(fd, -30), W.clone().addScaledVector(fd, 11), t => 51 + 3 * t, t => 4 * t, 4.1) // ~7 mm past the cuff
    // the body (variant B): the torso pivots at the hips like the shoulder did
    this.alignForearm(fd)
    this.body.visible = this.variant === 'B'
    this.body.position.copy(this.hip); this.torso.quaternion.copy(lw.q)
  }

  /** MakeHuman's hand comes with a forearm: turn it about the wrist into the sleeve's axis (fd), the hand keeping its pose. */
  private alignForearm(fd: THREE.Vector3) {
    const a = this.arm
    if (!a) return
    a.lower.quaternion.copy(a.q); a.lower.position.copy(a.p); a.wrist.quaternion.copy(a.wq); a.lower.updateMatrixWorld(true)
    const W0 = a.wrist.getWorldPosition(new THREE.Vector3()), Q0 = a.wrist.getWorldQuaternion(new THREE.Quaternion())
    const turn = new THREE.Quaternion().setFromUnitVectors(W0.clone().sub(a.lower.getWorldPosition(new THREE.Vector3())).normalize(), fd)
    const lw = a.lower.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn)
    a.lower.quaternion.copy(a.lower.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(lw))
    a.wrist.quaternion.copy(lw.clone().invert().multiply(Q0))
    a.lower.updateMatrixWorld(true)
    const P = a.lower.parent!, W1 = a.wrist.getWorldPosition(new THREE.Vector3())
    a.lower.position.add(P.worldToLocal(W0.clone()).sub(P.worldToLocal(W1)))
    a.lower.updateMatrixWorld(true)
  }

  private fingers(pose: Pose) {
    const d = THREE.MathUtils.degToRad, q = new THREE.Quaternion(), q2 = new THREE.Quaternion()
    const set = (n: string, flex: number, side = 0) => {
      const j = this.joints.get(n)!
      j.o.quaternion.copy(j.rest).multiply(q.setFromAxisAngle(j.flex, d(flex - j.zero[0]))).multiply(q2.setFromAxisAngle(j.side, d(side - j.zero[1])))
    }
    const t = pose.thumb
    set('thumb-metacarpal', t[0], t[1]); set('thumb-phalanx-proximal', t[2]); set('thumb-phalanx-distal', t[3])
    for (const f of FINGERS) { const p = pose[f]; set(`${f}-phalanx-proximal`, p[0], p[3]); set(`${f}-phalanx-intermediate`, p[1]); set(`${f}-phalanx-distal`, p[2]) }
  }

  /** The stone's centre in the fingers: on the index's nail (the back of its last phalanx), under the middle finger's pad. */
  private holdPoint() {
    const j = this.joints.get('index-finger-phalanx-distal')!, tip = this.indexTip
    const a = j.o.getWorldPosition(new THREE.Vector3()), b = tip.getWorldPosition(new THREE.Vector3()), ax = b.clone().sub(a).normalize()
    const flex = j.flex.clone().transformDirection(j.o.matrixWorld), n = new THREE.Vector3().crossVectors(ax, flex).normalize() // the nail's side
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.hand.quaternion) // gl +z: toward the pinky
    return { p: a.clone().lerp(b, this.H.along).addScaledVector(n, this.H.up).addScaledVector(side, this.H.side), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) }
  }

  /** Real time: the gesture for a move at v; onHandoff() (drop + state update) runs in the frame the stone leaves the fingers. */
  play(v: Vertex, onHandoff: () => void) {
    this.plan(v); this.fixed = -1; this.start = -1; this.picked = this.handed = false; this.onHandoff = onHandoff
    this.root.visible = true
    this.view.debug.prop(this.root, now => this.tick(now))
    return new Promise<void>(r => { this.done = r })
  }

  /** Frozen at ms (deterministic captures): the board's stone is the caller's business. */
  at(v: Vertex, ms: number) {
    this.plan(v); this.fixed = ms; this.root.visible = true
    this.view.debug.prop(this.root, now => this.tick(now))
    this.pose(ms)
  }

  stop() { this.fixed = -1; this.start = -1; this.root.visible = false; this.view.debug.prop(null); this.done?.(); this.done = null }

  private tick(now: number) {
    if (this.fixed >= 0) { this.root.visible = this.view.debug.camE > 0; return false }
    if (this.start < 0) this.start = now
    const ms = now - this.start
    this.pose(Math.min(ms, T.gone))
    this.root.visible = this.view.debug.camE > 0
    if (ms >= T.pick && !this.picked) { this.picked = true; this.view.pass(-1) } // a soft tap from the bowl
    if (ms >= T.hand && !this.handed) { this.handed = true; this.onHandoff?.() }
    if (ms >= T.gone) { this.stop(); return false }
    return true
  }
}
