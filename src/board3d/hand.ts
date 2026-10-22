// The AI opponent's right hand (Workshop option, a lazy chunk): in a dark silk sleeve, it takes a stone from his bowl and
// places it. The seated camera never shows his face, so he is a hand, a sleeve and, as an option, the shadow of his body
// (an invisible stand-in that only the lamp's shadow pass sees). The model is not bundled: the app downloads
// downloads/hand/hand-v1.glb (MakeHuman, CC0, see downloads/hand/CREDITS.md) and passes its bytes to load().
// Board3D.setHand plugs it in. Units mm, y up, board top ≈ 0, he sits at −z.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Vertex } from '@sabaki/go-board'
import type { Board3D, HandCtx, HandPlug } from './Board3D'
import { DROP_MS, dropPose } from './logic'
import { stoneLayer, type StoneKit } from './stones'

export type V3 = [number, number, number]
/** Upper arm and forearm (shoulder → elbow → wrist), mm; the arm never straightens past this share of its length. */
export const L1 = 300, L2 = 255, REACH = 0.92

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

/** Where he sits in seiza across a board BD deep, the ground at G: his hips, and his right shoulder upright. */
export const seat = (G: number, BD: number) => ({ hip: [0, G + 200, -BD / 2 - 360] as V3, S0: [-190, G + 720, -BD / 2 - 360] as V3 })

/** How far the torso may bow about the hips (°): a seiza bow goes near level, the hips staying on the heels. */
const LEAN = 68

/** His torso for a wrist target T, seated at hip with the shoulder at S0: upright when the arm reaches T, else bowed
 *  toward it, just enough for the arm (≤ REACH) to get there; the farther, the more the shoulder goes forward and down. */
export function reach(hip: V3, S0: V3, T: V3) {
  const cap = REACH * (L1 + L2) - 2, h = v3(hip), u = v3(S0).sub(h), t = v3(T)
  const f = new THREE.Vector3(t.x - h.x, 0, t.z - h.z).normalize(), axis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), f).normalize()
  const at = (s: number) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(LEAN) * s); return { shoulder: arr(u.clone().applyQuaternion(q).add(h)), q } }
  const far = (s: number) => v3(at(s).shoulder).distanceTo(t) - cap
  if (far(0) <= 0) return at(0)
  // the least bow that reaches (the distance falls as he bows, until the shoulder passes over T); a target beyond even
  // the deepest bow: the arm stops short (solveArm caps it)
  let lo = 0, hi = 1
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (far(m) > 0) lo = m; else hi = m }
  return at(hi)
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
/** Degrees. Fingers: [MCP flex, PIP flex, DIP flex, spread (+ toward the pinky)]; thumb: [CMC flex, CMC abduction, MCP flex, IP flex]. */
type Pose = Record<Finger, [number, number, number, number]>
type Poses = Record<'rest' | 'reach' | 'grip' | 'press' | 'release', Pose>
/** The hand's poses, counted from flat, parallel fingers (see `zero`). */
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
/** ms the fingers keep the stone past the handoff waiting for the board's own (a move dropped at the last moment). */
const HOLD_MS = 300
export const T = { reach: 0, bowl: 600, pick: 760, lift: 900, over: 1600, aim: 1720, hand: 1940, held: 1940 + DROP_MS + 110, out: 2240, gone: 2900 }

/** Where the stone sits: along the index's last phalanx (share of it: > 1 is past the tip, so the stone sticks out in
 *  front of the fingers), above its axis (mm), toward the middle finger (mm). */
export const HOLD = { along: 0.88, up: 10.5, side: 5 }

/** The hand's orientation at each key, degrees: [pitch of the back of the hand below horizontal, roll (+: thumb side up), yaw]. */
export const ORI: Record<'lap' | 'bowl' | 'pick' | 'lift' | 'over' | 'aim' | 'hand' | 'out', [number, number, number]> = {
  lap: [15, 10, 0], bowl: [10, -8, 0], pick: [5, -8, 0], lift: [8, -4, 0], over: [8, 0, 0], aim: [8, 0, 0], hand: [8, 0, 0], out: [10, 0, 0],
}

export type Variant = 'A' | 'B'
/** The skin's multiplier on its baked map (the map is a daylight albedo) by daylight, and under an andon alone: the
 *  andon's ~2000 K light would make it orange, so it leans to green and blue there (still warm). See tone(). */
export const MH_TINT: [number, number, number] = [0.74, 0.67, 0.69]
export const ANDON_TINT: [number, number, number] = [0.66, 0.8, 0.88] // blue barely matters under an andon; more would turn mauve under a mixed light
export const MH_SKIN = { roughness: 0.5, specular: 0.5, sheen: 0.5 }
const SHEEN_DAY: [number, number, number] = [0.9, 0.55, 0.5], SHEEN_ANDON: [number, number, number] = [0.7, 0.66, 0.66]
const _tint = new THREE.Color()

export class OpponentHand implements HandPlug {
  readonly root = new THREE.Group()
  /** ms from play() to the handoff, when the stone leaves the fingers and the board's own drop takes over. */
  readonly handoffMs = T.hand
  private hand = new THREE.Group() // the hand's frame: oriented, then placed so the stone point lands on the target
  private gl = new THREE.Group() // the glTF, metres → mm
  private joints = new Map<string, { o: THREE.Object3D; rest: THREE.Quaternion; flex: THREE.Vector3; side: THREE.Vector3; zero: [number, number] }>()
  private stone: THREE.InstancedMesh | null = null; private stoneKit: StoneKit | null = null // the carried stone, from the set in use
  private indexTip: THREE.Object3D
  private arm: { lower: THREE.Object3D; wrist: THREE.Object3D; q: THREE.Quaternion; p: THREE.Vector3; wq: THREE.Quaternion } // the forearm bone
  private upper = tubeGeo(); private fore = tubeGeo(); private juban = tubeGeo()
  private body = new THREE.Group(); private torso = new THREE.Group()
  private keys: Key[] = []
  private spot = { x: 0, y: 0, z: 0, seed: 0, rotY: 0 }
  private hip = new THREE.Vector3(); private S0 = new THREE.Vector3()
  private start = -1; private fixed = -1 // play: the gesture's start (performance.now time); at(): the frozen ms
  private picked = false; private handedAt = -1; private landedAt = -1; private v: Vertex = [0, 0]; private k = 1
  private onHandoff: (() => void) | null = null; private done: (() => void) | null = null
  private view: Board3D | null = null; private ctx: HandCtx | null = null
  private skin: THREE.MeshPhysicalMaterial
  // montsuki silk: a very dark charcoal with a hint of blue, a strong sheen so the folds read under the andon
  readonly silk = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.045, 0.048, 0.062), roughness: 0.42, sheen: 1, sheenColor: new THREE.Color(0.72, 0.74, 0.82), sheenRoughness: 0.28, side: THREE.DoubleSide })
  // the under-kimono (juban): a warm off-white edge inside the cuff, framing the wrist
  readonly cotton = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.6, 0.56, 0.48), roughness: 0.65, sheen: 0.5, sheenColor: new THREE.Color(0.9, 0.88, 0.82), sheenRoughness: 0.5, side: THREE.DoubleSide })
  variant: Variant = 'A'

  private constructor(gltf: THREE.Group) {
    this.gl.scale.setScalar(1000); this.gl.add(gltf); this.hand.add(this.gl); this.root.add(this.hand)
    this.gl.updateMatrixWorld(true)
    let mesh: THREE.SkinnedMesh | null = null
    gltf.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh })
    if (!mesh) throw new Error('hand: no skinned mesh')
    const m = mesh as THREE.SkinnedMesh
    const bone = (k: string) => { const b = m.skeleton.bones.find(b => b.name === k) ?? gltf.getObjectByName(k); if (!b) throw new Error(`hand: no bone ${k}`); return b }
    const byName = (n: string) => bone(mhName(n))
    this.indexTip = byName('index-finger-tip')
    const lower = bone('lowerarm_r'), wrist = byName('wrist')
    this.arm = { lower, wrist, q: lower.quaternion.clone(), p: lower.position.clone(), wq: wrist.quaternion.clone() }
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
    for (const f of FINGERS) {
      let prev = 0
      for (let i = 0; i < 3; i++) {
        const d = at(`${f}-${PH[i + 1]}`).sub(at(`${f}-${PH[i]}`)), a = THREE.MathUtils.radToDeg(Math.atan2(-d.x, -d.y))
        this.joints.get(`${f}-${PH[i]}`)!.zero = [a - prev, i ? 0 : THREE.MathUtils.radToDeg(Math.atan2(d.z, -d.y))]; prev = a
      }
    }
    m.material = this.skin = this.mhSkin((m.material as THREE.MeshStandardMaterial).map)
    // casts, but takes no shadow: under a daylight key his own sleeve would bury the hand in its shadow
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false
    // the sleeve
    for (const g of [this.upper, this.fore, this.juban]) { const s = new THREE.Mesh(g, g === this.juban ? this.cotton : this.silk); s.castShadow = s.receiveShadow = true; s.frustumCulled = false; this.root.add(s) }
    this.buildBody()
    this.root.visible = false
  }

  /** The hand from a .glb's bytes (the downloaded downloads/hand/hand-v1.glb). */
  static async load(glb: ArrayBuffer) {
    // the skin decodes through an <img>: the app's CSP allows blob: images, not blob: fetches (ImageBitmapLoader)
    const loader = new GLTFLoader().register(p => { p.textureLoader = new THREE.TextureLoader(p.options.manager); return { name: 'masame_img' } })
    return new OpponentHand((await loader.parseAsync(glb, '')).scene)
  }

  /** The skin: its baked colour map (young_asian_male), toned for the andon, a sheen for the soft edge. */
  private mhSkin(map: THREE.Texture | null) {
    return new THREE.MeshPhysicalMaterial({ map, color: new THREE.Color().setRGB(...MH_TINT), roughness: MH_SKIN.roughness, specularIntensity: MH_SKIN.specular, sheen: MH_SKIN.sheen, sheenColor: new THREE.Color(...SHEEN_DAY), sheenRoughness: 0.5 })
  }

  /** The skin's tint, from the lamp's share of the light on the board (its illuminance there against the key's). */
  private tone(ctx: HandCtx) {
    const L = ctx.lamp, e = L.visible ? L.intensity / Math.max(1, L.position.distanceToSquared(L.target.position)) : 0
    const sum = e + (ctx.key.visible ? ctx.key.intensity : 0), k = sum > 0 ? e / sum : 0
    this.skin.color.setRGB(...MH_TINT).lerp(_tint.setRGB(...ANDON_TINT), k)
    this.skin.sheenColor.setRGB(...SHEEN_DAY).lerp(_tint.setRGB(...SHEEN_ANDON), k)
  }

  /** The carried stone: the set's own white stone, remade when the set changes (Board3D frees the old kit). */
  private stoneFor(kit: StoneKit) {
    if (this.stoneKit === kit && this.stone) return this.stone
    if (this.stone) { this.stone.removeFromParent(); this.stone.geometry.dispose() }
    const st = this.stone = stoneLayer(kit.geoW, kit.white, 1); this.stoneKit = kit
    st.count = 1; st.setMatrixAt(0, new THREE.Matrix4()); st.visible = false
    this.root.add(st)
    return st
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
    const ctx = this.ctx!, bowl = ctx.bowl(-1), sp = this.spot = ctx.restSpot(v), G = bowl.y
    const st = seat(G, Math.abs(bowl.z) / 0.3)
    this.hip.set(...st.hip); this.S0.set(...st.S0)
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
    const P = POSES, O = (k: keyof typeof ORI, to: THREE.Vector3) => ori(to, d(ORI[k][0]), d(ORI[k][1]), d(ORI[k][2]))
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
  private pose(ms: number, held = false) {
    this.tone(this.ctx!)
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
    this.fingers(POSES.grip)
    this.hand.position.set(0, 0, 0); this.hand.quaternion.copy(q); this.root.updateMatrixWorld(true)
    const hold = this.holdPoint(), off = p.clone().sub(hold.p)
    this.fingers(pose)
    this.hand.position.add(off); this.root.updateMatrixWorld(true)
    // the stone: in the fingers (tilted with them), flattening to the board's own stone for the handoff
    const carried = ms >= T.pick && (ms < T.hand || held), st = this.stoneFor(this.ctx!.kit)
    st.visible = carried
    if (carried) {
      const fl = mj((ms - T.aim) / (T.hand - T.aim)), flat = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.spot.rotY)
      st.position.copy(p); st.quaternion.copy(hold.q).slerp(flat, ms >= T.aim ? fl : 0)
      ;(st.geometry.attributes.aSeed.array as Float32Array)[0] = this.spot.seed; st.geometry.attributes.aSeed.needsUpdate = true
    }
    // arm: the torso bows just enough, then the two-bone solve from the shoulder to the wrist
    const wrist = this.joints.get('thumb-metacarpal')!.o.parent!.getWorldPosition(new THREE.Vector3())
    const lw = reach(arr(this.hip), arr(this.S0), arr(wrist))
    const ik = solveArm(lw.shoulder, arr(wrist), L1, L2, [-1, -0.7, -0.2])
    if (ik.capped) { const dw = v3(ik.wrist).sub(wrist); this.hand.position.add(dw); st.position.add(dw); this.root.updateMatrixWorld(true) } // out of reach: the hand follows the arm
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
    return { p: a.clone().lerp(b, HOLD.along).addScaledVector(n, HOLD.up).addScaledVector(side, HOLD.side), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n) }
  }

  /** Real time: the gesture for a move at v on view; onHandoff() (drop + state update) runs when the stone reaches the
   *  handoff, and the fingers keep it until the board draws its own. k < 1 plays the way to the handoff faster (k of its
   *  natural time); the press and the way back keep their pace. Resolves when the hand is back in his lap, or at stop(). */
  play(view: Board3D, v: Vertex, onHandoff: () => void, k = 1) {
    this.stop()
    this.plug(view); this.plan(v); this.v = v; this.k = k; this.start = this.handedAt = this.landedAt = -1; this.picked = false; this.onHandoff = onHandoff
    return new Promise<void>(r => { this.done = r })
  }

  /** Frozen at ms (deterministic captures): the board's stone is the caller's business. */
  at(view: Board3D, v: Vertex, ms: number) {
    this.stop()
    this.plug(view); this.plan(v); this.fixed = ms
    this.pose(ms)
  }

  /** Puts the hand away at once (nothing more is handed off) and unplugs it. */
  stop() {
    this.fixed = -1; this.start = -1; this.root.visible = false; this.onHandoff = null
    this.view?.setHand(null); this.view = this.ctx = null
    this.done?.(); this.done = null
  }

  /** Between play() and the handoff: the move is still in his fingers. */
  get pending() { return !!this.onHandoff }

  private plug(view: Board3D) { this.view = view; this.ctx = view.setHand(this); this.root.visible = true }

  tick(now: number) {
    const ctx = this.ctx
    if (!ctx) return false
    if (this.fixed >= 0) { this.root.visible = ctx.camE > 0; return false }
    if (this.start < 0) this.start = now
    const el = now - this.start
    let ms = el / this.k, held = false
    if (ms >= T.hand) {
      if (this.handedAt < 0) { this.handedAt = now; const h = this.onHandoff; this.onHandoff = null; h?.() }
      // the press follows the board's own drop: the stone stays in his fingers until the board draws it (React updates
      // it a frame or two after the handoff), or HOLD_MS if the move never comes
      const d = ctx.dropT0(this.v)
      if (d !== null && this.landedAt < 0) this.landedAt = d // latched: an undo just after must not put it back in his fingers
      const t0 = this.landedAt >= 0 ? this.landedAt : now - this.handedAt > HOLD_MS ? this.handedAt + HOLD_MS : null
      held = t0 === null
      ms = T.hand + (held ? 0 : Math.max(0, now - t0!))
    }
    this.pose(Math.min(ms, T.gone), held)
    this.root.visible = ctx.camE > 0
    if (ms >= T.pick && !this.picked) { this.picked = true; this.view?.pass(-1) } // a soft tap from the bowl
    if (ms >= T.gone) { this.stop(); return false }
    return true
  }
}
