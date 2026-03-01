/**
 * Inspect bone structure of GLB files using three.js GLTFLoader in Node.js
 * Usage: node --experimental-modules inspect_glb_bones.mjs <path-to-glb>
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

// GLB is a binary format: 12-byte header + chunks
// We parse the JSON chunk to extract the skeleton without needing full three.js rendering

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node inspect_glb_bones.mjs <path-to-glb>');
  process.exit(1);
}

const buffer = readFileSync(resolve(filePath));
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

// GLB header: magic (4) + version (4) + length (4)
const magic = view.getUint32(0, true);
if (magic !== 0x46546C67) { // "glTF"
  console.error('Not a valid GLB file');
  process.exit(1);
}

const version = view.getUint32(4, true);
console.log(`GLB version: ${version}`);
console.log(`File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB\n`);

// First chunk: JSON
const chunk0Length = view.getUint32(12, true);
const chunk0Type = view.getUint32(16, true);

if (chunk0Type !== 0x4E4F534A) { // "JSON"
  console.error('First chunk is not JSON');
  process.exit(1);
}

const jsonBytes = buffer.slice(20, 20 + chunk0Length);
const gltf = JSON.parse(jsonBytes.toString('utf8'));

// Extract nodes
const nodes = gltf.nodes || [];
const skins = gltf.skins || [];
const animations = gltf.animations || [];

console.log(`=== NODES (${nodes.length} total) ===`);

// Find skin joints to identify bones
const boneIndices = new Set();
for (const skin of skins) {
  if (skin.joints) {
    for (const j of skin.joints) boneIndices.add(j);
  }
}

console.log(`\n=== SKINS (${skins.length}) ===`);
for (const [i, skin] of skins.entries()) {
  console.log(`  Skin ${i}: "${skin.name || 'unnamed'}" — ${skin.joints?.length || 0} joints`);
}

// Build parent map
const parentMap = new Map();
for (let i = 0; i < nodes.length; i++) {
  const node = nodes[i];
  if (node.children) {
    for (const childIdx of node.children) {
      parentMap.set(childIdx, i);
    }
  }
}

// Print bone hierarchy
console.log(`\n=== BONE HIERARCHY (${boneIndices.size} bones) ===`);

function getNodeName(idx) {
  return nodes[idx]?.name || `Node_${idx}`;
}

function printTree(nodeIdx, indent = '') {
  const node = nodes[nodeIdx];
  const name = node?.name || `Node_${nodeIdx}`;
  const isBone = boneIndices.has(nodeIdx);
  const marker = isBone ? '🦴' : '  ';

  // Check for translation/rotation/scale
  const t = node?.translation ? `pos(${node.translation.map(v => v.toFixed(3)).join(', ')})` : '';
  const r = node?.rotation ? `rot(${node.rotation.map(v => v.toFixed(3)).join(', ')})` : '';

  console.log(`${indent}${marker} [${nodeIdx}] ${name}  ${t} ${r}`);

  if (node?.children) {
    for (const childIdx of node.children) {
      printTree(childIdx, indent + '    ');
    }
  }
}

// Find root bones (bones with no parent that is also a bone)
const rootBones = [];
for (const boneIdx of boneIndices) {
  const parent = parentMap.get(boneIdx);
  if (parent === undefined || !boneIndices.has(parent)) {
    rootBones.push(boneIdx);
  }
}

// Print from scene roots if no clear bone root
if (rootBones.length > 0) {
  for (const root of rootBones) {
    // Find the highest non-bone ancestor
    let current = root;
    let topParent = parentMap.get(current);
    while (topParent !== undefined && !boneIndices.has(topParent)) {
      current = topParent;
      topParent = parentMap.get(current);
    }
    printTree(current);
  }
} else {
  // Fallback: print all nodes
  const rootNodes = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!parentMap.has(i)) rootNodes.push(i);
  }
  for (const r of rootNodes) printTree(r);
}

// Specifically look for head/mouth/jaw related bones
console.log(`\n=== MOUTH/FACE BONE SEARCH ===`);
const faceKeywords = ['head', 'jaw', 'lip', 'mouth', 'chin', 'tongue', 'teeth', 'face', 'mandible', 'oral'];
let foundFace = false;
for (const boneIdx of boneIndices) {
  const name = (nodes[boneIdx]?.name || '').toLowerCase();
  for (const kw of faceKeywords) {
    if (name.includes(kw)) {
      console.log(`  FOUND: [${boneIdx}] "${nodes[boneIdx].name}" (matched: ${kw})`);
      foundFace = true;
      break;
    }
  }
}
if (!foundFace) {
  console.log('  ❌ No face/mouth bones found — mouth rig needs to be added');
}

// Animation info
console.log(`\n=== ANIMATIONS (${animations.length}) ===`);
for (const [i, anim] of animations.entries()) {
  console.log(`  Anim ${i}: "${anim.name || 'unnamed'}" — ${anim.channels?.length || 0} channels`);
  // Show which bones are animated
  const animatedBones = new Set();
  for (const ch of (anim.channels || [])) {
    const nodeIdx = ch.target?.node;
    if (nodeIdx !== undefined && boneIndices.has(nodeIdx)) {
      animatedBones.add(nodes[nodeIdx]?.name || `Node_${nodeIdx}`);
    }
  }
  if (animatedBones.size > 0 && animatedBones.size <= 30) {
    console.log(`    Animated bones: ${[...animatedBones].join(', ')}`);
  } else if (animatedBones.size > 30) {
    console.log(`    Animated bones: ${animatedBones.size} bones (too many to list)`);
  }
}

console.log('\n=== DONE ===');
