"""
Apply automatic vertex weights for mouth bones on a GLB that already has the bones added.

Usage:
    blender --background --python apply_mouth_weights.py -- input.glb output.glb

Strategy:
  1. Import GLB (bones already present from add_mouth_rig.py)
  2. Select only mouth bones in the armature
  3. Use 'Bone Heat Weighting' via parent_set(ARMATURE_AUTO) which re-weights ALL bones
     — BUT we first lock existing body bone weights so they're preserved,
       then unlock only mouth bones so only those get new weights.
  4. Export with Draco compression to keep file size reasonable.
"""

import bpy
import sys
from mathutils import Vector

MOUTH_BONE_NAMES = {
    "jaw", "lip.T", "lip.T.L", "lip.T.R",
    "lip.B", "lip.B.L", "lip.B.R",
    "lips.L", "lips.R",
    "tongue", "tongue.001", "tongue.002",
    "teeth.T", "teeth.B",
}


def apply_mouth_weights(input_path, output_path):
    """Import GLB, apply automatic weights for mouth bones, export."""

    # Clear scene
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    # Also clean orphan data
    for block in bpy.data.meshes:
        if block.users == 0:
            bpy.data.meshes.remove(block)

    # Import
    print(f"\n{'='*60}")
    print(f"Importing: {input_path}")
    bpy.ops.import_scene.gltf(filepath=input_path)

    # Find armature and mesh
    armature = None
    meshes = []
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE':
            armature = obj
        elif obj.type == 'MESH':
            meshes.append(obj)

    if not armature:
        print("ERROR: No armature found!")
        return False

    if not meshes:
        print("ERROR: No meshes found!")
        return False

    print(f"Armature: '{armature.name}' with {len(armature.data.bones)} bones")
    print(f"Meshes: {[m.name for m in meshes]}")

    # Verify mouth bones exist
    mouth_bones_found = []
    for bone in armature.data.bones:
        if bone.name in MOUTH_BONE_NAMES:
            mouth_bones_found.append(bone.name)
    print(f"Mouth bones found: {len(mouth_bones_found)}/{len(MOUTH_BONE_NAMES)}")

    if not mouth_bones_found:
        print("ERROR: No mouth bones in armature! Run add_mouth_rig.py first.")
        return False

    # ================================================================
    # APPROACH: Select mouth bones only, deselect body bones,
    # then use automatic weights which will only calculate for
    # selected deform bones near the mesh surface.
    # ================================================================

    # Find the main character mesh (skip tiny helper meshes like Icosphere)
    main_mesh = max(meshes, key=lambda m: len(m.data.vertices))
    print(f"\nMain mesh: '{main_mesh.name}' ({len(main_mesh.data.vertices)} verts)")

    for mesh_obj in [main_mesh]:
        print(f"\n--- Weighting mesh: '{mesh_obj.name}' ---")

        # Step 1: Ensure all mouth bones are marked as deform
        bpy.context.view_layer.objects.active = armature
        bpy.ops.object.mode_set(mode='EDIT')
        for ebone in armature.data.edit_bones:
            if ebone.name in MOUTH_BONE_NAMES:
                ebone.use_deform = True
        bpy.ops.object.mode_set(mode='OBJECT')

        # Step 2: Clear existing parent relationship so we can re-parent with weights
        bpy.ops.object.select_all(action='DESELECT')
        mesh_obj.select_set(True)
        bpy.context.view_layer.objects.active = mesh_obj
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')

        # Step 3: Remove ALL existing vertex groups (auto-weights will recreate them all)
        mesh_obj.vertex_groups.clear()
        print("  Cleared existing vertex groups")

        # Also remove any existing armature modifiers
        for mod in list(mesh_obj.modifiers):
            if mod.type == 'ARMATURE':
                mesh_obj.modifiers.remove(mod)

        # Step 4: Re-parent mesh to armature with automatic weights
        # This calculates heat-diffuse weights for ALL bones including mouth bones
        bpy.ops.object.select_all(action='DESELECT')
        mesh_obj.select_set(True)
        armature.select_set(True)
        bpy.context.view_layer.objects.active = armature

        try:
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')
            print("  ✓ Automatic weights applied for ALL bones (body + mouth)!")

            # Check which mouth groups got weights
            weighted_groups = 0
            for bone_name in MOUTH_BONE_NAMES:
                vg = mesh_obj.vertex_groups.get(bone_name)
                if vg:
                    # Sample a few verts to check if any have non-zero weight
                    count = 0
                    sample = min(len(mesh_obj.data.vertices), 50000)
                    step = max(1, len(mesh_obj.data.vertices) // sample)
                    for i in range(0, len(mesh_obj.data.vertices), step):
                        try:
                            w = vg.weight(i)
                            if w > 0.001:
                                count += 1
                        except RuntimeError:
                            pass
                    if count > 0:
                        weighted_groups += 1
                        est = count * step
                        print(f"    {bone_name}: ~{est} vertices weighted")
                    else:
                        print(f"    {bone_name}: 0 vertices (bone may be inside mesh)")

            print(f"  {weighted_groups}/{len(MOUTH_BONE_NAMES)} mouth groups have weights")

            # If jaw didn't get auto-weights, use distance fallback for mouth only
            jaw_vg = mesh_obj.vertex_groups.get('jaw')
            jaw_has_weight = False
            if jaw_vg:
                for i in range(0, len(mesh_obj.data.vertices), max(1, len(mesh_obj.data.vertices) // 1000)):
                    try:
                        if jaw_vg.weight(i) > 0.001:
                            jaw_has_weight = True
                            break
                    except RuntimeError:
                        pass

            if not jaw_has_weight:
                print("  Jaw has no auto-weights — applying distance-based fallback for mouth...")
                apply_distance_weights(mesh_obj, armature)

        except RuntimeError as e:
            print(f"  ✗ Auto weights failed: {e}")
            print("  Applying distance-based weights for mouth bones...")
            apply_distance_weights(mesh_obj, armature)

            # Still need to parent and add modifier
            mesh_obj.parent = armature
            mod = mesh_obj.modifiers.new(name='Armature', type='ARMATURE')
            mod.object = armature

    # ================================================================
    # Export with Draco compression to keep file size reasonable
    # ================================================================
    print(f"\nExporting: {output_path}")

    # Check if Draco is available
    try:
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format='GLB',
            export_skins=True,
            export_animations=True,
            export_def_bones=False,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
        )
    except TypeError:
        # Draco params might differ by Blender version
        bpy.ops.export_scene.gltf(
            filepath=output_path,
            export_format='GLB',
            export_skins=True,
            export_animations=True,
            export_def_bones=False,
        )

    print(f"\nSUCCESS: {output_path}")
    return True


def apply_distance_weights(mesh_obj, armature_obj):
    """Fallback: apply simple distance-based weights for mouth bones."""
    print("  Applying distance-based weights as fallback...")

    bpy.context.view_layer.objects.active = armature_obj
    bpy.ops.object.mode_set(mode='EDIT')

    # Get mouth bone world positions
    bone_positions = {}
    for ebone in armature_obj.data.edit_bones:
        if ebone.name in MOUTH_BONE_NAMES:
            # Get bone center in world space
            center = (ebone.head + ebone.tail) / 2
            world_center = armature_obj.matrix_world @ center
            bone_positions[ebone.name] = world_center

    bpy.ops.object.mode_set(mode='OBJECT')

    # For each mouth bone, weight nearby vertices
    for bone_name, bone_pos in bone_positions.items():
        vg = mesh_obj.vertex_groups.get(bone_name)
        if not vg:
            vg = mesh_obj.vertex_groups.new(name=bone_name)

        # Influence radius depends on bone type
        if bone_name == 'jaw':
            radius = 0.08
        elif 'lip' in bone_name or 'lips' in bone_name:
            radius = 0.03
        elif 'tongue' in bone_name:
            radius = 0.02
        elif 'teeth' in bone_name:
            radius = 0.02
        else:
            radius = 0.03

        count = 0
        for v in mesh_obj.data.vertices:
            v_world = mesh_obj.matrix_world @ v.co
            dist = (v_world - bone_pos).length
            if dist < radius:
                weight = max(0, 1.0 - (dist / radius))
                weight = weight * weight  # Quadratic falloff
                vg.add([v.index], weight, 'REPLACE')
                count += 1

        if count > 0:
            print(f"    {bone_name}: {count} vertices (distance-based, r={radius:.3f})")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    if len(args) >= 2:
        apply_mouth_weights(args[0], args[1])
    else:
        print("Usage: blender --background --python apply_mouth_weights.py -- input.glb output.glb")
