"""
Create a full humanoid skeleton from scratch for an unrigged GLB mesh.

Usage:
    blender --background --python rig_from_scratch.py -- input.glb output.glb

This creates a Tripo-compatible skeleton with mouth bones, skins the mesh
with automatic weights, and exports as a new GLB.

Bone naming follows the Tripo convention used by WOW.glb so that Avatar.tsx
can detect all bones consistently.
"""

import bpy
import sys
import os
from mathutils import Vector

# ---------------------------------------------------------------------------
# Full humanoid skeleton definition
# Each entry: (bone_name, head_pos, tail_pos, parent_name_or_None)
# Positions are in meters, roughly matching a 1.7m humanoid
# Blender coords: X = right, Y = forward, Z = up
# ---------------------------------------------------------------------------

SKELETON = [
    # Root / Hips
    ("Root",            (0, 0, 0.95),       (0, 0, 1.0),       None),
    ("Hip",             (0, 0, 0.95),       (0, 0, 1.0),       "Root"),

    # Spine chain
    ("Waist",           (0, 0, 1.0),        (0, 0, 1.08),      "Hip"),
    ("Spine01",         (0, 0, 1.08),       (0, 0, 1.18),      "Waist"),
    ("Spine02",         (0, 0, 1.18),       (0, 0, 1.30),      "Spine01"),

    # Neck / Head
    ("NeckTwist01",     (0, 0, 1.30),       (0, 0, 1.35),      "Spine02"),
    ("NeckTwist02",     (0, 0, 1.35),       (0, 0, 1.38),      "NeckTwist01"),
    ("Head",            (0, 0, 1.38),       (0, 0, 1.55),      "NeckTwist02"),

    # Left Arm
    ("L_Clavicle",      (0.02, 0, 1.30),    (0.12, 0, 1.30),   "Spine02"),
    ("L_Upperarm",      (0.12, 0, 1.30),    (0.38, 0, 1.30),   "L_Clavicle"),
    ("L_Forearm",       (0.38, 0, 1.30),    (0.60, 0, 1.30),   "L_Upperarm"),
    ("L_Hand",          (0.60, 0, 1.30),    (0.68, 0, 1.30),   "L_Forearm"),

    # Right Arm
    ("R_Clavicle",      (-0.02, 0, 1.30),   (-0.12, 0, 1.30),  "Spine02"),
    ("R_Upperarm",      (-0.12, 0, 1.30),   (-0.38, 0, 1.30),  "R_Clavicle"),
    ("R_Forearm",       (-0.38, 0, 1.30),   (-0.60, 0, 1.30),  "R_Upperarm"),
    ("R_Hand",          (-0.60, 0, 1.30),   (-0.68, 0, 1.30),  "R_Forearm"),

    # Left Leg
    ("L_Thigh",         (0.09, 0, 0.95),    (0.09, 0, 0.52),   "Hip"),
    ("L_Calf",          (0.09, 0, 0.52),    (0.09, 0, 0.08),   "L_Thigh"),
    ("L_Foot",          (0.09, 0, 0.08),    (0.09, -0.12, 0.0), "L_Calf"),

    # Right Leg
    ("R_Thigh",         (-0.09, 0, 0.95),   (-0.09, 0, 0.52),  "Hip"),
    ("R_Calf",          (-0.09, 0, 0.52),   (-0.09, 0, 0.08),  "R_Thigh"),
    ("R_Foot",          (-0.09, 0, 0.08),   (-0.09, -0.12, 0.0), "R_Calf"),
]

# Mouth bones (same as add_mouth_rig.py, relative to Head bone head position)
MOUTH_BONES = {
    "jaw":        {"head": (0, -0.02, -0.015), "tail": (0, -0.07, -0.04),   "parent": "Head"},
    "lip.T":      {"head": (0, -0.075, -0.01), "tail": (0, -0.08, -0.01),   "parent": "Head"},
    "lip.T.L":    {"head": (0.015, -0.07, -0.012), "tail": (0.015, -0.075, -0.012), "parent": "Head"},
    "lip.T.R":    {"head": (-0.015, -0.07, -0.012), "tail": (-0.015, -0.075, -0.012), "parent": "Head"},
    "lip.B":      {"head": (0, -0.075, -0.025), "tail": (0, -0.08, -0.025), "parent": "jaw"},
    "lip.B.L":    {"head": (0.015, -0.07, -0.023), "tail": (0.015, -0.075, -0.023), "parent": "jaw"},
    "lip.B.R":    {"head": (-0.015, -0.07, -0.023), "tail": (-0.015, -0.075, -0.023), "parent": "jaw"},
    "lips.L":     {"head": (0.025, -0.065, -0.015), "tail": (0.03, -0.065, -0.015), "parent": "Head"},
    "lips.R":     {"head": (-0.025, -0.065, -0.015), "tail": (-0.03, -0.065, -0.015), "parent": "Head"},
    "tongue":     {"head": (0, -0.04, -0.022), "tail": (0, -0.055, -0.022), "parent": "jaw"},
    "tongue.001": {"head": (0, -0.055, -0.022), "tail": (0, -0.065, -0.02), "parent": "tongue"},
    "tongue.002": {"head": (0, -0.065, -0.02),  "tail": (0, -0.072, -0.018),"parent": "tongue.001"},
    "teeth.T":    {"head": (0, -0.065, -0.01),  "tail": (0, -0.075, -0.01), "parent": "Head"},
    "teeth.B":    {"head": (0, -0.065, -0.025), "tail": (0, -0.075, -0.025),"parent": "jaw"},
}


def find_mesh_center_and_height(mesh_obj):
    """Calculate mesh bounding box center and height for skeleton scaling."""
    # Get world-space bounding box corners
    bbox = [mesh_obj.matrix_world @ Vector(corner) for corner in mesh_obj.bound_box]

    min_z = min(v.z for v in bbox)
    max_z = max(v.z for v in bbox)
    center_x = sum(v.x for v in bbox) / 8
    center_y = sum(v.y for v in bbox) / 8

    height = max_z - min_z
    return Vector((center_x, center_y, min_z)), height


def create_full_rig(mesh_obj):
    """Create a complete humanoid skeleton sized to the mesh, with mouth bones."""

    mesh_origin, mesh_height = find_mesh_center_and_height(mesh_obj)

    # Our reference skeleton is for a 1.55m-tall mesh (root at 0.95, head top at ~1.55)
    # Scale everything to match the actual mesh
    ref_height = 1.55  # reference total height
    scale = mesh_height / ref_height if mesh_height > 0.01 else 1.0

    print(f"Mesh height: {mesh_height:.4f}m, scale factor: {scale:.4f}")
    print(f"Mesh base: Z={mesh_origin.z:.4f}")

    # Offset to align skeleton with mesh bottom
    z_offset = mesh_origin.z
    x_offset = mesh_origin.x
    y_offset = mesh_origin.y

    # Create armature
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    armature_obj = bpy.context.object
    armature_obj.name = "Armature"
    armature_data = armature_obj.data
    armature_data.name = "Armature"

    # Remove the default bone
    for bone in armature_data.edit_bones:
        armature_data.edit_bones.remove(bone)

    # Create body skeleton
    print("\n--- Creating body skeleton ---")
    for bone_name, head_pos, tail_pos, parent_name in SKELETON:
        bone = armature_data.edit_bones.new(bone_name)
        bone.head = Vector((
            head_pos[0] * scale + x_offset,
            head_pos[1] * scale + y_offset,
            head_pos[2] * scale + z_offset
        ))
        bone.tail = Vector((
            tail_pos[0] * scale + x_offset,
            tail_pos[1] * scale + y_offset,
            tail_pos[2] * scale + z_offset
        ))
        bone.use_deform = True
        bone.use_connect = False

        if parent_name:
            parent = armature_data.edit_bones.get(parent_name)
            if parent:
                bone.parent = parent

        print(f"  Created: {bone_name}")

    # Create mouth bones (relative to Head bone)
    print("\n--- Creating mouth bones ---")
    head_bone = armature_data.edit_bones.get("Head")
    if head_bone:
        head_origin = head_bone.head.copy()

        for bone_name, cfg in MOUTH_BONES.items():
            bone = armature_data.edit_bones.new(bone_name)
            h, t = cfg["head"], cfg["tail"]
            bone.head = head_origin + Vector((h[0] * scale, h[1] * scale, h[2] * scale))
            bone.tail = head_origin + Vector((t[0] * scale, t[1] * scale, t[2] * scale))
            bone.use_deform = True
            bone.use_connect = False
            print(f"  Created: {bone_name}")

        # Set mouth bone parents
        for bone_name, cfg in MOUTH_BONES.items():
            bone = armature_data.edit_bones.get(bone_name)
            if bone:
                parent = armature_data.edit_bones.get(cfg["parent"])
                bone.parent = parent if parent else head_bone

    # Exit edit mode
    bpy.ops.object.mode_set(mode='OBJECT')

    total = len(SKELETON) + len(MOUTH_BONES)
    print(f"\nCreated {total} bones total ({len(SKELETON)} body + {len(MOUTH_BONES)} mouth)")

    return armature_obj


def skin_mesh_to_armature(mesh_obj, armature_obj):
    """Parent mesh to armature with automatic weights."""
    print("\n--- Skinning mesh with automatic weights ---")

    # Deselect all, then select mesh, then armature (armature must be active)
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    armature_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature_obj

    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print("  Automatic weights applied successfully!")
        return True
    except RuntimeError as e:
        print(f"  Auto weights failed: {e}")
        print("  Trying envelope weights as fallback...")
        try:
            bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')
            print("  Envelope weights applied as fallback")
            return True
        except RuntimeError as e2:
            print(f"  Envelope weights also failed: {e2}")
            print("  Falling back to empty groups (manual weight painting needed)")
            # At minimum, parent with empty groups
            bpy.ops.object.parent_set(type='ARMATURE_NAME')
            return False


def process_unrigged_glb(input_path, output_path):
    """Full pipeline: import raw mesh → create skeleton → skin → export."""

    # Clear scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # Import
    print(f"\n{'='*60}")
    print(f"Importing: {input_path}")
    bpy.ops.import_scene.gltf(filepath=input_path)

    # Find the mesh
    mesh_obj = None
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            mesh_obj = obj
            break

    if not mesh_obj:
        print("ERROR: No mesh found in imported file!")
        return False

    print(f"Found mesh: '{mesh_obj.name}' ({len(mesh_obj.data.vertices)} vertices)")

    # Create skeleton
    armature_obj = create_full_rig(mesh_obj)

    # Skin
    skin_mesh_to_armature(mesh_obj, armature_obj)

    # Export
    print(f"\nExporting: {output_path}")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_skins=True,
        export_animations=False,  # No animations on a freshly rigged model
        export_def_bones=False,
    )

    print(f"\nSUCCESS: {output_path}")
    return True


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    if len(args) >= 2:
        process_unrigged_glb(args[0], args[1])
    elif len(args) == 0:
        # Interactive: rig whatever mesh is in the scene
        mesh = None
        for obj in bpy.data.objects:
            if obj.type == 'MESH':
                mesh = obj
                break
        if mesh:
            armature = create_full_rig(mesh)
            skin_mesh_to_armature(mesh, armature)
        else:
            print("No mesh in scene. Import a GLB first.")
    else:
        print("Usage: blender --background --python rig_from_scratch.py -- input.glb output.glb")
