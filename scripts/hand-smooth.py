# Prototype helper: one level of Catmull-Clark on the opponent's hand, skin weights kept (vertex groups are interpolated).
# /Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/hand-smooth.py
import os
import bpy

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'src', 'board3d', 'hand', 'right.glb')
dst = os.path.join(here, '..', 'src', 'board3d', 'hand', 'right-smooth.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.find_armature()]  # the skinned hand (the GLB also has a loose Icosphere)
assert len(meshes) == 1, meshes
m = meshes[0]
bpy.context.view_layer.objects.active = m
m.select_set(True)
sub = m.modifiers.new('smooth', 'SUBSURF')
sub.levels = sub.render_levels = 1
sub.subdivision_type = 'CATMULL_CLARK'
while m.modifiers[0] != sub:  # before the armature: subdivide the rest pose, then skin it
    bpy.ops.object.modifier_move_up(modifier='smooth')
bpy.ops.object.modifier_apply(modifier='smooth')
print('vertices', len(m.data.vertices), 'groups', [g.name for g in m.vertex_groups])
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_skins=True, export_animations=False, export_materials='EXPORT', export_yup=True)
print('wrote', dst)
