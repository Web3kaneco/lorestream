# Blender MCP + Mouth Rig Automation Setup

## Quick Start

### 1. Install Blender MCP addon

```bash
# Install the Python package (provides the MCP server)
pip install blender-mcp
# OR
uvx blender-mcp
```

Then in **Blender**:
1. Download `addon.py` from https://github.com/ahujasid/blender-mcp
2. Edit > Preferences > Add-ons > Install > select `addon.py`
3. Enable the addon checkbox
4. In the N-panel sidebar, find **BlenderMCP** > click **Start MCP Server**

### 2. Add MCP to Claude Code

Run in your terminal (outside Claude Code):

```bash
claude mcp add blender -- uvx blender-mcp
```

**Or on Windows with cmd:**
```bash
claude mcp add blender -- cmd /c uvx blender-mcp
```

### 3. Verify Connection

Start a new Claude Code session. You should see `blender` in the MCP tools.
Ask Claude: "Get the current Blender scene info" — it should return scene data.

---

## Usage: Add Mouth Bones

### Option A: Via Blender MCP (Claude does it)

With Blender open and the MCP addon running, ask Claude:

> "Import architect.glb from C:/lorestream/public/ into Blender, add mouth bones using the script in scripts/blender/mcp_mouth_rig.py, then export as architect_mouthrig.glb"

Claude will use `execute_blender_code` to run each step.

### Option B: Standalone CLI (no MCP needed)

Process a single file:
```bash
blender --background --python scripts/blender/add_mouth_rig.py -- public/architect.glb public/architect_mouthrig.glb
```

Batch process all GLBs in public/:
```bash
blender --background --python scripts/blender/batch_add_mouth_rig.py -- public/
```

Overwrite originals:
```bash
blender --background --python scripts/blender/batch_add_mouth_rig.py -- public/ --overwrite
```

### Option C: Inside Blender (manual)

1. Open Blender, import your GLB (File > Import > glTF)
2. Open the Scripting workspace
3. Load `scripts/blender/add_mouth_rig.py`
4. Run the script (Alt+P)
5. Export as GLB (File > Export > glTF)

---

## Bones Added

| Bone | Parent | Purpose |
|------|--------|---------|
| jaw | Head | Jaw open/close |
| lip.T | Head | Upper lip center |
| lip.T.L / lip.T.R | Head | Upper lip sides |
| lip.B | jaw | Lower lip center |
| lip.B.L / lip.B.R | jaw | Lower lip sides |
| lips.L / lips.R | Head | Lip corners |
| tongue | jaw | Tongue root |
| tongue.001 | tongue | Tongue mid |
| tongue.002 | tongue.001 | Tongue tip |
| teeth.T | Head | Upper teeth |
| teeth.B | jaw | Lower teeth |

Total: 14 bones

---

## Adjusting Bone Positions

The bone offsets in `add_mouth_rig.py` are tuned for standard Mixamo-scale
characters (~1.7m). If your model is a different scale:

```bash
# Use --scale flag (e.g., 0.01 for centimeter-scale models)
blender --background --python add_mouth_rig.py -- model.glb output.glb Head 0.01
```

Or edit the `MOUTH_BONES` dict in the script to adjust positions.

---

## After Adding Bones

The bones are added but **vertex weights are empty**. You need to:

1. **Auto-weight** (quick but imprecise): Select mesh, then armature, Ctrl+P > Armature Deform With Automatic Weights
2. **Manual weight paint** (precise): Switch to Weight Paint mode and paint weights for each mouth bone
3. **Transfer weights** (if you have a reference): Use Data Transfer modifier to copy weights from a weighted mesh

For basic lip-sync in Three.js/React Three Fiber, even just the `jaw` bone
with simple weights on the lower face vertices gives good results.
