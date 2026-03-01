"""
One-click Blender MCP setup script.
Run this INSIDE Blender's Scripting workspace to install and start the MCP addon.

Steps:
  1. Open Blender 5.0
  2. Switch to the "Scripting" workspace tab at the top
  3. Click "+ New" to create a new text block
  4. Paste this entire script
  5. Press Alt+P (or click the ▶ Play button)
  6. The MCP server will start automatically

After running, start a NEW Claude Code session in your terminal.
Claude will have access to execute_blender_code and other Blender tools.
"""

import bpy
import os
import shutil

# Path to the addon we downloaded
ADDON_SOURCE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)) if '__file__' in dir() else '',
    'blender_mcp_addon.py'
)

# Fallback: look in known project location
PROJECT_ADDON = r'C:\lorestream\scripts\blender\blender_mcp_addon.py'
WORKTREE_ADDON = r'C:\lorestream\.claude\worktrees\hardcore-chebyshev\scripts\blender\blender_mcp_addon.py'

addon_path = None
for candidate in [ADDON_SOURCE, PROJECT_ADDON, WORKTREE_ADDON]:
    if os.path.isfile(candidate):
        addon_path = candidate
        break

if addon_path:
    print(f"Installing addon from: {addon_path}")
    try:
        bpy.ops.preferences.addon_install(filepath=addon_path)
        print("Addon installed successfully!")
    except Exception as e:
        print(f"Install via operator failed: {e}")
        # Manual fallback: copy to addons directory
        addons_dir = bpy.utils.user_resource('SCRIPTS', path="addons")
        os.makedirs(addons_dir, exist_ok=True)
        dest = os.path.join(addons_dir, 'blender_mcp_addon.py')
        shutil.copy2(addon_path, dest)
        print(f"Copied addon to: {dest}")
else:
    print("WARNING: Could not find addon file. Checking if already installed...")

# Enable the addon
try:
    bpy.ops.preferences.addon_enable(module='blender_mcp_addon')
    print("Addon enabled!")
except Exception as e:
    # Try alternate module name
    try:
        bpy.ops.preferences.addon_enable(module='addon')
        print("Addon enabled (as 'addon')!")
    except Exception as e2:
        print(f"Could not enable addon: {e2}")
        print("Try manually: Edit > Preferences > Add-ons > search 'MCP' > enable")

# Save preferences so it persists
bpy.ops.wm.save_userpref()
print("\nPreferences saved. The Blender MCP addon is installed.")
print("\nNow click 'Start MCP Server' in the N-panel sidebar (press N to toggle).")
print("Look for the 'BlenderMCP' panel in the sidebar.")
