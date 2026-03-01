"""
MCP-ready mouth rig script.

This is a self-contained version designed to be pasted into Blender MCP's
execute_blender_code tool. Copy the entire content of this file and send it
as a single code block to the Blender MCP.

Usage with Blender MCP (via Claude):
1. Open your GLB file in Blender
2. Use execute_blender_code with this script
3. Export the result

Example MCP commands in sequence:
    Step 1: Import the GLB
        execute_blender_code: bpy.ops.import_scene.gltf(filepath='C:/lorestream/public/architect.glb')

    Step 2: Run this script (paste full contents)

    Step 3: Export
        execute_blender_code: bpy.ops.export_scene.gltf(filepath='C:/lorestream/public/architect_mouthrig.glb', export_format='GLB', export_skins=True, export_animations=True)
"""

import bpy
from mathutils import Vector

# --- Config ---
MOUTH_BONES = {
    "jaw":        {"head": (0, -0.02, -0.015), "tail": (0, -0.07, -0.04),   "parent": "__HEAD__", "connect": False},
    "lip.T":      {"head": (0, -0.075, -0.01), "tail": (0, -0.08, -0.01),   "parent": "__HEAD__", "connect": False},
    "lip.T.L":    {"head": (0.015, -0.07, -0.012), "tail": (0.015, -0.075, -0.012), "parent": "__HEAD__", "connect": False},
    "lip.T.R":    {"head": (-0.015, -0.07, -0.012), "tail": (-0.015, -0.075, -0.012), "parent": "__HEAD__", "connect": False},
    "lip.B":      {"head": (0, -0.075, -0.025), "tail": (0, -0.08, -0.025), "parent": "jaw", "connect": False},
    "lip.B.L":    {"head": (0.015, -0.07, -0.023), "tail": (0.015, -0.075, -0.023), "parent": "jaw", "connect": False},
    "lip.B.R":    {"head": (-0.015, -0.07, -0.023), "tail": (-0.015, -0.075, -0.023), "parent": "jaw", "connect": False},
    "lips.L":     {"head": (0.025, -0.065, -0.015), "tail": (0.03, -0.065, -0.015), "parent": "__HEAD__", "connect": False},
    "lips.R":     {"head": (-0.025, -0.065, -0.015), "tail": (-0.03, -0.065, -0.015), "parent": "__HEAD__", "connect": False},
    "tongue":     {"head": (0, -0.04, -0.022), "tail": (0, -0.055, -0.022), "parent": "jaw", "connect": False},
    "tongue.001": {"head": (0, -0.055, -0.022), "tail": (0, -0.065, -0.02), "parent": "tongue", "connect": True},
    "tongue.002": {"head": (0, -0.065, -0.02),  "tail": (0, -0.072, -0.018),"parent": "tongue.001", "connect": True},
    "teeth.T":    {"head": (0, -0.065, -0.01),  "tail": (0, -0.075, -0.01), "parent": "__HEAD__", "connect": False},
    "teeth.B":    {"head": (0, -0.065, -0.025), "tail": (0, -0.075, -0.025),"parent": "jaw", "connect": False},
}

# --- Find armature ---
armature = None
for obj in bpy.data.objects:
    if obj.type == 'ARMATURE':
        armature = obj
        break

if not armature:
    raise RuntimeError("No armature found in scene!")

bpy.context.view_layer.objects.active = armature
armature.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')

# --- Find head bone ---
head_bone = None
for name in ["Head", "head", "mixamorig:Head", "mixamorig_Head"]:
    head_bone = armature.data.edit_bones.get(name)
    if head_bone:
        break
if not head_bone:
    for b in armature.data.edit_bones:
        if "head" in b.name.lower() and "top" not in b.name.lower():
            head_bone = b
            break

if not head_bone:
    bpy.ops.object.mode_set(mode='OBJECT')
    raise RuntimeError(f"No head bone found! Bones: {[b.name for b in armature.data.edit_bones]}")

origin = head_bone.head.copy()
created = []

# --- Create bones ---
for name, cfg in MOUTH_BONES.items():
    if armature.data.edit_bones.get(name):
        continue
    b = armature.data.edit_bones.new(name)
    h, t = cfg["head"], cfg["tail"]
    b.head = origin + Vector(h)
    b.tail = origin + Vector(t)
    b.use_connect = cfg["connect"]
    b.use_deform = True
    created.append(name)

# --- Set parents ---
for name, cfg in MOUTH_BONES.items():
    b = armature.data.edit_bones.get(name)
    if not b:
        continue
    p = cfg["parent"]
    if p == "__HEAD__":
        b.parent = head_bone
    else:
        b.parent = armature.data.edit_bones.get(p) or head_bone

bpy.ops.object.mode_set(mode='OBJECT')

# --- Create vertex groups on meshes ---
for child in armature.children:
    if child.type == 'MESH':
        for bone_name in MOUTH_BONES:
            if bone_name not in child.vertex_groups:
                child.vertex_groups.new(name=bone_name)

print(f"Added {len(created)} mouth bones: {created}")
print(f"Head bone used: {head_bone.name}")
