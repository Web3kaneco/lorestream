"""
Batch process all GLB files in /public/ to add mouth bone rigs.

Usage:
    blender --background --python batch_add_mouth_rig.py -- /path/to/project/public

This will:
1. Find all .glb files in the given directory
2. Import each one into Blender
3. Add mouth bones to the armature
4. Export to a new file: original_name_mouthrig.glb
5. Optionally overwrite originals with --overwrite flag

The original files are always preserved unless --overwrite is passed.
"""

import bpy
import sys
import os

# Import the mouth rig module from the same directory
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

from add_mouth_rig import process_glb_file


def batch_process(directory, overwrite=False, head_bone_name=None, scale=1.0):
    """Process all GLB files in a directory."""
    if not os.path.isdir(directory):
        print(f"ERROR: '{directory}' is not a valid directory")
        return

    glb_files = [f for f in os.listdir(directory) if f.lower().endswith('.glb')]

    if not glb_files:
        print(f"No .glb files found in '{directory}'")
        return

    print(f"Found {len(glb_files)} GLB file(s) to process:")
    for f in glb_files:
        print(f"  - {f}")

    results = {"success": [], "failed": [], "skipped": []}

    for filename in glb_files:
        # Skip files that already have mouth rig suffix
        if "_mouthrig" in filename:
            print(f"\nSKIP: '{filename}' (already processed)")
            results["skipped"].append(filename)
            continue

        input_path = os.path.join(directory, filename)

        if overwrite:
            output_path = input_path
        else:
            base, ext = os.path.splitext(filename)
            output_path = os.path.join(directory, f"{base}_mouthrig{ext}")

        try:
            success = process_glb_file(
                input_path, output_path, head_bone_name, scale
            )
            if success:
                results["success"].append(filename)
            else:
                results["failed"].append(filename)
        except Exception as e:
            print(f"ERROR processing '{filename}': {e}")
            results["failed"].append(filename)

    # Summary
    print(f"\n{'='*60}")
    print("BATCH PROCESSING COMPLETE")
    print(f"  Success: {len(results['success'])}")
    print(f"  Failed:  {len(results['failed'])}")
    print(f"  Skipped: {len(results['skipped'])}")

    if results["success"]:
        print("\nSuccessfully processed:")
        for f in results["success"]:
            print(f"  + {f}")

    if results["failed"]:
        print("\nFailed:")
        for f in results["failed"]:
            print(f"  ! {f}")


if __name__ == "__main__":
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1:]
    else:
        args = []

    if not args:
        print("Usage: blender --background --python batch_add_mouth_rig.py -- /path/to/glb/directory [--overwrite]")
        sys.exit(1)

    directory = args[0]
    overwrite = "--overwrite" in args

    # Optional named args
    head_bone = None
    scale = 1.0
    for i, arg in enumerate(args):
        if arg == "--head-bone" and i + 1 < len(args):
            head_bone = args[i + 1]
        elif arg == "--scale" and i + 1 < len(args):
            scale = float(args[i + 1])

    batch_process(directory, overwrite, head_bone, scale)
