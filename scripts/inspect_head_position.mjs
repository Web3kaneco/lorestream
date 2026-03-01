/**
 * Trace the head bone position through the skeleton hierarchy
 * to determine where mouth bones should be placed.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = process.argv[2];
const buffer = readFileSync(resolve(filePath));
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
const chunk0Length = view.getUint32(12, true);
const jsonBytes = buffer.slice(20, 20 + chunk0Length);
const gltf = JSON.parse(jsonBytes.toString('utf8'));
const nodes = gltf.nodes || [];

// Build parent map
const parentMap = new Map();
for (let i = 0; i < nodes.length; i++) {
  if (nodes[i].children) {
    for (const c of nodes[i].children) parentMap.set(c, i);
  }
}

// Find head bone
let headIdx = -1;
for (let i = 0; i < nodes.length; i++) {
  if (nodes[i].name === 'Head') { headIdx = i; break; }
}

if (headIdx === -1) {
  console.log('No Head bone found');
  process.exit(1);
}

// Trace path from root to head
const path = [];
let cur = headIdx;
while (cur !== undefined) {
  path.unshift(cur);
  cur = parentMap.get(cur);
}

console.log('Path from root to Head:');
for (const idx of path) {
  const n = nodes[idx];
  const t = n.translation || [0,0,0];
  const r = n.rotation || [0,0,0,1];
  const s = n.scale || [1,1,1];
  console.log(`  [${idx}] ${n.name || 'unnamed'}`);
  console.log(`    translation: [${t.map(v=>v.toFixed(4)).join(', ')}]`);
  console.log(`    rotation:    [${r.map(v=>v.toFixed(4)).join(', ')}]`);
  console.log(`    scale:       [${s.map(v=>v.toFixed(4)).join(', ')}]`);
}

// Also show Head's children if any
const headNode = nodes[headIdx];
if (headNode.children && headNode.children.length > 0) {
  console.log('\nHead children:');
  for (const c of headNode.children) {
    const cn = nodes[c];
    console.log(`  [${c}] ${cn.name} — t: [${(cn.translation||[0,0,0]).map(v=>v.toFixed(4)).join(', ')}]`);
  }
} else {
  console.log('\nHead has NO children (no sub-bones like jaw)');
}

// Show all bone positions for reference
console.log('\n=== ALL BONE POSITIONS ===');
const skins = gltf.skins || [];
const boneSet = new Set();
for (const skin of skins) {
  for (const j of (skin.joints || [])) boneSet.add(j);
}
for (const idx of boneSet) {
  const n = nodes[idx];
  const t = n.translation || [0,0,0];
  console.log(`  ${n.name}: t=[${t.map(v=>v.toFixed(4)).join(', ')}]`);
}
