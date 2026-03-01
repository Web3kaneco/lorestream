"""
Add mouth bone rig to an existing GLB armature.

Usage (standalone):
    blender --background --python add_mouth_rig.py -- input.glb output.glb

Usage (via Blender MCP execute_blender_code):
    Paste this script's add_mouth_bones_to_armature() function and call it.

Adds these bones parented to the Head bone:
    jaw         - main jaw (open/close)
    lip.T       - upper lip center
    lip.T.L     - upper lip left
    lip.T.R     - upper lip right
    lip.B       - lower lip center (parented to jaw)
    lip.B.L     - lower lip left (parented to jaw)
    lip.B.R     - lower lip right (parented to jaw)
    lips.L      - left lip corner
    lips.R      - right lip corner
    tongue      - tongue root (parented to jaw)
    tongue.001  - tongue mid
    tongue.002  - tongue tip
    teeth.T     - upper teeth
    teeth.B     - lower teeth (parented to jaw)
"""

import bpy
import sys
from mathutils import Vector, Matrix


# ---------------------------------------------------------------------------
# Bone position profiles — offsets relative to head bone origin
# Tuned for Mixamo-scale humanoid characters (~1.7m tall)
# All values in meters; Y = forward, Z = up in Blender coords
# ---------------------------------------------------------------------------

MOUTH_BONES = {
    # name: (head_offset, tail_offset, parent_name, use_connect, use_deform)
    "jaw": {
        "head": (0.0, -0.02, -0.015),
        "tail": (0.0, -0.07, -0.04),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "lip.T": {
        "head": (0.0, -0.075, -0.01),
        "tail": (0.0, -0.08, -0.01),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "lip.T.L": {
        "head": (0.015, -0.07, -0.012),
        "tail": (0.015, -0.075, -0.012),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "lip.T.R": {
        "head": (-0.015, -0.07, -0.012),
        "tail": (-0.015, -0.075, -0.012),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "lip.B": {
        "head": (0.0, -0.075, -0.025),
        "tail": (0.0, -0.08, -0.025),
        "parent": "jaw",
        "connect": False,
        "deform": True,
    },
    "lip.B.L": {
        "head": (0.015, -0.07, -0.023),
        "tail": (0.015, -0.075, -0.023),
        "parent": "jaw",
        "connect": False,
        "deform": True,
    },
    "lip.B.R": {
        "head": (-0.015, -0.07, -0.023),
        "tail": (-0.015, -0.075, -0.023),
        "parent": "jaw",
        "connect": False,
        "deform": True,
    },
    "lips.L": {
        "head": (0.025, -0.065, -0.015),
        "tail": (0.03, -0.065, -0.015),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "lips.R": {
        "head": (-0.025, -0.065, -0.015),
        "tail": (-0.03, -0.065, -0.015),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "tongue": {
        "head": (0.0, -0.04, -0.022),
        "tail": (0.0, -0.055, -0.022),
        "parent": "jaw",
        "connect": False,
        "deform": True,
    },
    "tongue.001": {
        "head": (0.0, -0.055, -0.022),
        "tail": (0.0, -0.065, -0.02),
        "parent": "tongue",
        "connect": True,
        "deform": True,
    },
    "tongue.002": {
        "head": (0.0, -0.065, -0.02),
        "tail": (0.0, -0.072, -0.018),
        "parent": "tongue.001",
        "connect": True,
        "deform": True,
    },
    "teeth.T": {
        "head": (0.0, -0.065, -0.01),
        "tail": (0.0, -0.075, -0.01),
        "parent": "__HEAD__",
        "connect": False,
        "deform": True,
    },
    "teeth.B": {
        "head": (0.0, -0.065, -0.025),
        "tail": (0.0, -0.075, -0.025),
        "parent": "jaw",
        "connect": False,
        "deform": True,
    },
}


def find_head_bone(armature_data):
    """Find the head bone using common naming conventions."""
    candidates = [
        "Head", "head", "HEAD",
        "mixamorig:Head", "mixamorig_Head",
        "Bip01_Head", "Bip001_Head",
        "head_bone", "Head_M",
        "DEF-head", "ORG-head",
    ]
    for name in candidates:
        bone = armature_data.edit_bones.get(name)
        if bone:
            return bone

    # Fallback: search for any bone with "head" in the name (case-insensitive)
    for bone in armature_data.edit_bones:
        if "head" in bone.name.lower() and "headtop" not in bone.name.lower():
            return bone

    return None


def find_armature(obj_name=None):
    """Find the armature object in the scene."""
    if obj_name:
        obj = bpy.data.objects.get(obj_name)
        if obj and obj.type == 'ARMATURE':
            return obj

    # Search all objects
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            return obj

    return None


def add_mouth_bones_to_armature(armature_obj, head_bone_name=None, scale=1.0):
    """
    Add a complete mouth bone rig to an existing armature.

    Args:
        armature_obj: The Blender armature object
        head_bone_name: Name of the head bone to parent to (auto-detected if None)
        scale: Scale multiplier for bone positions (1.0 = standard Mixamo scale)

    Returns:
        list of created bone names, or empty list on failure
    """
    if armature_obj.type != 'ARMATURE':
        print(f"ERROR: {armature_obj.name} is not an armature")
        return []

    # Make active and enter edit mode
    bpy.context.view_layer.objects.active = armature_obj
    armature_obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')

    armature_data = armature_obj.data

    # Find head bone
    if head_bone_name:
        head_bone = armature_data.edit_bones.get(head_bone_name)
    else:
        head_bone = find_head_bone(armature_data)

    if not head_bone:
        print("ERROR: Could not find head bone in armature!")
        print("Available bones:", [b.name for b in armature_data.edit_bones])
        bpy.ops.object.mode_set(mode='OBJECT')
        return []

    print(f"Found head bone: '{head_bone.name}'")

    # Use head bone's head position as the reference origin
    # For Mixamo, the head bone head is roughly at the base of the skull
    head_origin = head_bone.head.copy()

    # Calculate the forward direction from the head bone
    # Mixamo bones typically point up (+Z), so we use the bone's orientation
    head_matrix = head_bone.matrix.copy()

    created_bones = []

    # First pass: create all bones with positions
    for bone_name, bone_def in MOUTH_BONES.items():
        # Skip if bone already exists
        if armature_data.edit_bones.get(bone_name):
            print(f"  SKIP: '{bone_name}' already exists")
            continue

        bone = armature_data.edit_bones.new(bone_name)

        # Apply offset relative to head bone origin, with scale
        h = bone_def["head"]
        t = bone_def["tail"]
        bone.head = head_origin + Vector((h[0] * scale, h[1] * scale, h[2] * scale))
        bone.tail = head_origin + Vector((t[0] * scale, t[1] * scale, t[2] * scale))

        bone.use_connect = bone_def["connect"]
        bone.use_deform = bone_def["deform"]

        created_bones.append(bone_name)
        print(f"  CREATED: '{bone_name}'")

    # Second pass: set parents (all bones exist now)
    for bone_name, bone_def in MOUTH_BONES.items():
        bone = armature_data.edit_bones.get(bone_name)
        if not bone:
            continue

        parent_name = bone_def["parent"]
        if parent_name == "__HEAD__":
            bone.parent = head_bone
        else:
            parent = armature_data.edit_bones.get(parent_name)
            if parent:
                bone.parent = parent
            else:
                print(f"  WARNING: parent '{parent_name}' not found for '{bone_name}'")
                bone.parent = head_bone

    # Exit edit mode
    bpy.ops.object.mode_set(mode='OBJECT')

    print(f"\nAdded {len(created_bones)} mouth bones to '{armature_obj.name}'")
    return created_bones


def create_mouth_vertex_groups(mesh_obj, armature_obj):
    """
    Create empty vertex groups on the mesh for each mouth bone.
    This prepares the mesh for weight painting.

    The actual weights should be painted manually or via automatic weights,
    but having the groups pre-created makes the workflow smoother.
    """
    if mesh_obj.type != 'MESH':
        print(f"ERROR: {mesh_obj.name} is not a mesh")
        return

    for bone_name in MOUTH_BONES:
        if bone_name not in mesh_obj.vertex_groups:
            mesh_obj.vertex_groups.new(name=bone_name)
            print(f"  Created vertex group: '{bone_name}'")


def auto_weight_mouth_bones(mesh_obj, armature_obj):
    """
    Attempt automatic weight painting for mouth bones.
    Uses Blender's 'Automatic Weights' with the armature.

    NOTE: This works best when the mouth geometry is clean and
    the bone positions are well-placed relative to the mesh.
    Manual touch-up is usually still needed.
    """
    # Select mesh, then armature
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    armature_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature_obj

    # Parent with automatic weights
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        print("Automatic weights applied successfully")
    except RuntimeError as e:
        print(f"Auto weights failed (common for complex meshes): {e}")
        print("You may need to manually weight paint the mouth area")


# ---------------------------------------------------------------------------
# Batch processing: import GLB → add mouth bones → export GLB
# ---------------------------------------------------------------------------

def process_glb_file(input_path, output_path, head_bone_name=None, scale=1.0):
    """
    Import a GLB, add mouth bones, and export a new GLB.

    Args:
        input_path: Path to the source .glb file
        output_path: Path for the output .glb file
        head_bone_name: Name of head bone (auto-detected if None)
        scale: Scale factor for bone positions
    """
    # Clear the scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # Import GLB
    print(f"\n{'='*60}")
    print(f"Importing: {input_path}")
    bpy.ops.import_scene.gltf(filepath=input_path)

    # Find the armature
    armature = find_armature()
    if not armature:
        print("ERROR: No armature found in imported GLB!")
        return False

    print(f"Found armature: '{armature.name}'")

    # List existing bones for reference
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    print(f"Existing bones ({len(armature.data.edit_bones)}):")
    for b in armature.data.edit_bones:
        print(f"  - {b.name}")
    bpy.ops.object.mode_set(mode='OBJECT')

    # Add mouth bones
    created = add_mouth_bones_to_armature(armature, head_bone_name, scale)
    if not created:
        print("WARNING: No new bones were created")

    # Create vertex groups on all child meshes
    for child in armature.children:
        if child.type == 'MESH':
            create_mouth_vertex_groups(child, armature)

    # Export GLB
    print(f"\nExporting: {output_path}")
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format='GLB',
        export_skins=True,
        export_animations=True,
        export_def_bones=False,  # Export all bones, not just deform
    )

    print(f"SUCCESS: {output_path}")
    return True


# ---------------------------------------------------------------------------
# CLI entry point: blender --background --python add_mouth_rig.py -- in.glb out.glb
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    argv = sys.argv
    # Everything after "--" is our script's arguments
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    if len(args) >= 2:
        input_glb = args[0]
        output_glb = args[1]
        head_name = args[2] if len(args) > 2 else None
        bone_scale = float(args[3]) if len(args) > 3 else 1.0

        process_glb_file(input_glb, output_glb, head_name, bone_scale)
    elif len(args) == 0:
        # Interactive mode — just add bones to whatever armature is in the scene
        armature = find_armature()
        if armature:
            add_mouth_bones_to_armature(armature)
        else:
            print("No armature found in scene. Import a GLB first.")
    else:
        print("Usage: blender --background --python add_mouth_rig.py -- input.glb output.glb [head_bone_name] [scale]")
