# The opponent's right hand (src-tauri/assets/hand/hand-v1.glb, built into the desktop app), made with MakeHuman's MPFB in Blender.
# Writes hand-v2.glb by default, never over v1: a new hand replaces v1 in src-tauri/src/hand.rs (and its test's size and SHA-256).
# Headless, in an isolated Blender profile (the user's own Blender settings and add-ons stay untouched):
#   export BLENDER_USER_RESOURCES=$PWD/vendor/makehuman/blender-profile
#   /Applications/Blender.app/Contents/MacOS/Blender --command extension install-file -r user_default -e vendor/makehuman/mpfb/add-on-mpfb-v2.0.18.zip
#   /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/hand-makehuman.py
# The first run loads the CC0 asset packs (makehuman_system_assets, hands01) from vendor/makehuman/ (or $MAKEHUMAN_VENDOR)
# with MPFB's own loader.
# Output: a skinned hand + wrist + a short forearm (hidden by the kimono sleeve), joints kept, the skin baked to its own UVs.
# The glTF frame hand.ts expects (that of the WebXR hand it was first written for): metres, wrist at the origin, fingers −y, palm normal −x, thumb side −z.
import os
import bmesh
import bpy
from mathutils import Matrix

here = os.path.dirname(os.path.abspath(__file__))
DST = os.environ.get('HAND_OUT', os.path.join(here, '..', 'src-tauri', 'assets', 'hand', 'hand-v2.glb'))  # never over hand-v1.glb
TEX = int(os.environ.get('HAND_TEX', '1024'))  # atlas size
SUBDIV = int(os.environ.get('HAND_SUBDIV', '1'))
CUT = 0.11  # m of forearm kept behind the wrist joint (the sleeve and its juban hide everything past ~0.03)

from bl_ext.user_default.mpfb.services import AssetService, HumanService, LocationService, TargetService  # noqa: E402

VENDOR = os.environ.get('MAKEHUMAN_VENDOR', os.path.join(here, '..', 'vendor', 'makehuman'))  # the downloaded MPFB zip and packs
for pack, zip_ in (('makehuman_system_assets', 'system-assets/makehuman_system_assets_cc0.zip'), ('hands01', 'hands01/hands01_cc0.zip')):
    if pack not in AssetService.get_pack_names():
        bpy.ops.mpfb.load_pack(filepath=os.path.join(VENDOR, zip_))
        AssetService.rescan_pack_metadata()

# ---------- the human: a young adult East Asian man (MakeHuman macro scale: age 0.5 = 25 years) ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
macro = TargetService.get_default_macro_info_dict()
macro.update(gender=1.0, age=0.5, muscle=0.5, weight=0.5, proportions=0.5, height=0.5)
macro['race'] = {'asian': 1.0, 'caucasian': 0.0, 'african': 0.0}
human = HumanService.create_human(mask_helpers=True, macro_detail_dict=macro)

# hands01 (CC0): knuckles present but young, fingers corrected, a fuller palm
data = LocationService.get_user_data()
HANDS = {'mindfront_hand_fingers_correction': 1.0, 'mindfront_hand_thenar_eminence': 0.7, 'mindfront_hand_hypothenar': 0.6, 'jujube_knobby_knuckles': 0.35}
for name, w in HANDS.items():
    TargetService.load_target(human, os.path.join(data, 'targets', 'hands', name + '.target'), weight=w)

rig = HumanService.add_builtin_rig(human, 'game_engine')  # fingers: thumb_01..03, index/middle/ring/pinky_01..03 (no metacarpals)
HumanService.set_character_skin(os.path.join(data, 'skins', 'young_asian_male', 'young_asian_male.mhmat'), human, skin_type='GAMEENGINE')
TargetService.bake_targets(human)

print('human: vertices', len(human.data.vertices), 'bones', len(rig.data.bones))

# ---------- keep the right hand (the character's right: −x) and the end of the forearm ----------
FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky']
HAND_BONES = ['lowerarm_r', 'hand_r'] + [f'{f}_0{i}_r' for f in FINGERS for i in (1, 2, 3)]
bones = rig.data.bones
W = rig.matrix_world @ bones['hand_r'].head_local  # the wrist joint
axis = (W - rig.matrix_world @ bones['lowerarm_r'].head_local).normalized()  # elbow → wrist
keep_groups = {human.vertex_groups[n].index for n in HAND_BONES}
bone_groups = {g.index for g in human.vertex_groups if g.name in bones}
body = human.vertex_groups['body'].index

bm = bmesh.new()
bm.from_mesh(human.data)
dl = bm.verts.layers.deform.active
def dominant(v):
    d = [kv for kv in v[dl].items() if kv[0] in bone_groups]
    return max(d, key=lambda kv: kv[1])[0] if d else -1
drop = [v for v in bm.verts if body not in v[dl] or v[dl][body] < 0.5  # helpers (eyes, teeth, joint cubes...)
        or dominant(v) not in keep_groups or (v.co - W).dot(axis) < -CUT - 0.02]
bmesh.ops.delete(bm, geom=drop, context='VERTS')
# a clean cut across the forearm, capped (only the sleeve sees it)
res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=W - axis * CUT, plane_no=-axis, clear_outer=True)
cut_edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
# shrapnel: anything not connected to the hand (bits of the thigh or hip the arm hangs against)
seen, stack = set(), [min(bm.verts, key=lambda v: (v.co - (rig.matrix_world @ bones['middle_03_r'].head_local)).length)]
while stack:
    v = stack.pop()
    if v in seen: continue
    seen.add(v); stack.extend(e.other_vert(v) for e in v.link_edges)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in seen], context='VERTS')
bm.to_mesh(human.data); bm.free()
for m in list(human.modifiers):
    if m.type == 'MASK': human.modifiers.remove(m)
for g in list(human.vertex_groups):
    if g.name not in HAND_BONES: human.vertex_groups.remove(g)
print('hand: vertices', len(human.data.vertices), 'faces', len(human.data.polygons))

# bones: the forearm is the root; a leaf at each fingertip (the bone tail of the last phalanx) for hand.ts
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
for b in list(eb):
    if b.name not in HAND_BONES: eb.remove(b)
eb['lowerarm_r'].parent = None
for f in FINGERS:
    last = eb[f'{f}_03_r']
    tip = eb.new(f'{f}_tip_r')
    tip.head = last.tail; tip.tail = last.tail + (last.tail - last.head) * 0.3
    tip.roll = last.roll; tip.parent = last; tip.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------- the skin: MPFB's material baked onto the hand's own UVs (MakeHuman's islands, packed) ----------
me = human.data
uv = me.uv_layers.new(name='hand')
me.uv_layers.active = uv
bpy.ops.object.select_all(action='DESELECT')
human.select_set(True); bpy.context.view_layer.objects.active = human
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
mat = human.data.materials[0]
nt = mat.node_tree
uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
nt.links.new(uvn.outputs['UV'], nt.nodes['DiffuseTexture'].inputs['Vector'])
img = bpy.data.images.new('hand_skin', TEX, TEX)
tgt = nt.nodes.new('ShaderNodeTexImage'); tgt.image = img
for n in nt.nodes: n.select = False
tgt.select = True; nt.nodes.active = tgt
bake = scene.render.bake
bake.use_pass_direct = bake.use_pass_indirect = False; bake.use_pass_color = True
bake.margin = 16
bpy.ops.object.bake(type='DIFFUSE', uv_layer='hand')
# ambient occlusion in the rest pose (creases between and under the fingers), multiplied in softly
ao = bpy.data.images.new('hand_ao', TEX, TEX)
tgt.image = ao
scene.cycles.samples = 64
bpy.ops.object.bake(type='AO', uv_layer='hand')
px, ao_px = list(img.pixels), ao.pixels[:]
AO_STRENGTH = 0.55
for i in range(0, len(px), 4):
    k = 1 - AO_STRENGTH * (1 - ao_px[i])
    px[i] *= k; px[i + 1] *= k; px[i + 2] *= k
img.pixels = px
img.pack()
me.uv_layers.remove(me.uv_layers['UVMap'])
uv.active_render = True

# a plain glTF material: Principled BSDF, the baked colour
human.data.materials.clear()
skin = bpy.data.materials.new('skin')
skin.use_nodes = True
bsdf = skin.node_tree.nodes['Principled BSDF']
tx = skin.node_tree.nodes.new('ShaderNodeTexImage'); tx.image = img
skin.node_tree.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
uvh = skin.node_tree.nodes.new('ShaderNodeUVMap'); uvh.uv_map = 'hand'
skin.node_tree.links.new(uvh.outputs['UV'], tx.inputs['Vector'])
skin.use_backface_culling = True  # closed mesh (the cut is capped): glTF doubleSided false
bsdf.inputs['Roughness'].default_value = 0.5
human.data.materials.append(skin)

# ---------- smooth: Catmull-Clark on the rest pose, before the armature (weights interpolate) ----------
if SUBDIV:
    sub = human.modifiers.new('smooth', 'SUBSURF')
    sub.levels = sub.render_levels = SUBDIV
    while human.modifiers[0] != sub: bpy.ops.object.modifier_move_up(modifier='smooth')
    bpy.ops.object.modifier_apply(modifier='smooth')

# ---------- the frame of the WebXR hand (glTF: fingers −y, palm normal −x, thumb side −z; Blender before +Y-up: −Z, −X, +Y) ----------
mw = rig.matrix_world
F = (mw @ bones['middle_01_r'].head_local - W).normalized()
Tn = (mw @ bones['index_01_r'].head_local - mw @ bones['pinky_01_r'].head_local)
Tn = (Tn - F * Tn.dot(F)).normalized()
Pn = Tn.cross(F)
src = Matrix((Pn, F, Tn)).transposed()  # columns: palm normal, fingers, thumb side
dst = Matrix(((-1, 0, 0), (0, 0, -1), (0, 1, 0))).transposed()
R = (dst @ src.inverted()).to_4x4()
rig.matrix_world = R @ Matrix.Translation(-W) @ rig.matrix_world
bpy.context.view_layer.update()

# ---------- export ----------
for o in bpy.data.objects: o.select_set(o in (human, rig))
os.makedirs(os.path.dirname(DST), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_skins=True, export_influence_nb=4,
                          export_def_bones=False, export_leaf_bone=False, export_animations=False, export_morph=False,
                          export_materials='EXPORT', export_image_format='JPEG', export_jpeg_quality=90, export_yup=True,
                          export_apply=False, export_tangents=False, export_vertex_color='NONE', export_extras=False)
tri = sum(len(p.vertices) - 2 for p in human.data.polygons)
print('exported', os.path.normpath(DST))
print('  vertices', len(human.data.vertices), 'triangles', tri, 'texture', f'{TEX}x{TEX}')
print('  bones', [b.name for b in rig.data.bones])
print('  size', os.path.getsize(DST), 'bytes')
if os.environ.get('HAND_BLEND'): bpy.ops.wm.save_as_mainfile(filepath=os.environ['HAND_BLEND'])
