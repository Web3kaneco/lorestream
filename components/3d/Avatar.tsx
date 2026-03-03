'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

export type AnimationState = 'idle' | 'speaking' | 'thinking' | 'greeting';

// Reusable temp objects — avoid GC churn in 60fps useFrame loop
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
}

// Animation clip name → state mapping keywords
const CLIP_STATE_KEYWORDS: Record<AnimationState, string[]> = {
  idle: ['idle', 'breathing', 'standing', 'rest'],
  speaking: ['talk', 'speak', 'gesture', 'conversation', 'explain'],
  thinking: ['think', 'look', 'scratch', 'weight', 'shift', 'wonder'],
  greeting: ['wave', 'greet', 'salute', 'nod', 'hello', 'welcome'],
};

const CROSSFADE_DURATION = 0.4;
const MIN_CLIP_DURATION = 0.1; // Clips shorter than this are "baked pose" (static)

function categorizeClips(clips: THREE.AnimationClip[]): Map<AnimationState, THREE.AnimationClip> {
  const map = new Map<AnimationState, THREE.AnimationClip>();
  if (clips.length === 0) return map;
  for (const [state, keywords] of Object.entries(CLIP_STATE_KEYWORDS) as [AnimationState, string[]][]) {
    for (const clip of clips) {
      const n = clip.name.toLowerCase();
      if (keywords.some(kw => n.includes(kw))) { map.set(state, clip); break; }
    }
  }
  const fb = clips[0];
  for (const s of ['idle', 'speaking', 'thinking', 'greeting'] as AnimationState[]) {
    if (!map.has(s)) map.set(s, fb);
  }
  return map;
}

function repairTrackNames(clips: THREE.AnimationClip[], boneNames: Set<string>): number {
  let repaired = 0;
  const bnArray = Array.from(boneNames);
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const di = track.name.lastIndexOf('.');
      if (di < 0) continue;
      const bn = track.name.substring(0, di);
      const pp = track.name.substring(di); // .quaternion, .position, .scale
      if (boneNames.has(bn)) continue;

      let fixed = false;
      // Strategy 1: Strip known prefixes (Blender export artifacts)
      for (const pfx of ['Armature.', 'Armature/', 'Scene.', 'Scene/', 'Object.', 'Object/']) {
        if (bn.startsWith(pfx)) {
          const stripped = bn.substring(pfx.length);
          if (boneNames.has(stripped)) { track.name = stripped + pp; repaired++; fixed = true; break; }
        }
      }
      if (fixed) continue;

      // Strategy 2: Extract last segment of hierarchical path
      const segments = bn.split(/[./\\]/);
      for (let i = segments.length - 1; i >= 0; i--) {
        if (boneNames.has(segments[i])) {
          track.name = segments[i] + pp;
          repaired++; fixed = true; break;
        }
      }
      if (fixed) continue;

      // Strategy 3: Case-insensitive match on last segment
      const lastSeg = segments[segments.length - 1].toLowerCase();
      const ciMatch = bnArray.find(b => b.toLowerCase() === lastSeg);
      if (ciMatch) { track.name = ciMatch + pp; repaired++; }
    }
  }
  return repaired;
}

/**
 * Create programmatic morph targets (jawOpen + mouthWide) for models
 * that have no facial bones. Identifies head/mouth vertices by position
 * and creates displacement morph attributes on the geometry.
 * Works on the bind-pose vertex positions before skinning — deltas are
 * applied by the GPU before bone transforms, so the jaw deforms naturally.
 */
function createMouthMorphTargets(mesh: THREE.SkinnedMesh): boolean {
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute('position');
  if (!posAttr) return false;
  const count = posAttr.count;
  if (count < 100) return false;

  // 1. Compute bounding box from geometry positions (bind-pose / local space)
  const bbox = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
    bbox.expandByPoint(v);
  }
  const totalH = bbox.max.y - bbox.min.y;
  if (totalH < 0.01) return false;

  // 2. Head region = top ~14% of model height
  const headMinY = bbox.max.y - totalH * 0.14;

  // 3. Collect head vertices + compute head bounding box
  const headIdxs: number[] = [];
  const headBbox = new THREE.Box3();
  for (let i = 0; i < count; i++) {
    const y = posAttr.getY(i);
    if (y >= headMinY) {
      headIdxs.push(i);
      v.set(posAttr.getX(i), y, posAttr.getZ(i));
      headBbox.expandByPoint(v);
    }
  }
  if (headIdxs.length < 20) {
    console.warn('[MORPH] Too few head vertices:', headIdxs.length);
    return false;
  }

  const headCenter = new THREE.Vector3();
  headBbox.getCenter(headCenter);
  const headH = headBbox.max.y - headBbox.min.y;

  // 4. Detect face-forward axis via extent asymmetry.
  //    The nose protrudes, making one side extend further from centroid.
  //    For Tripo models with rotation [0,-π/2,0], face forward = +X in bind pose.
  const extPosX = headBbox.max.x - headCenter.x;
  const extNegX = headCenter.x - headBbox.min.x;
  const extPosZ = headBbox.max.z - headCenter.z;
  const extNegZ = headCenter.z - headBbox.min.z;

  const asymX = Math.abs(extPosX - extNegX);
  const asymZ = Math.abs(extPosZ - extNegZ);

  let faceAxis: 0 | 2;   // 0 = X axis, 2 = Z axis
  let faceSign: 1 | -1;  // positive or negative direction
  let lrAxis: 0 | 2;     // left-right axis (perpendicular to face)

  if (asymX >= asymZ) {
    faceAxis = 0;
    faceSign = extPosX >= extNegX ? 1 : -1;
    lrAxis = 2;
  } else {
    faceAxis = 2;
    faceSign = extPosZ >= extNegZ ? 1 : -1;
    lrAxis = 0;
  }

  const faceCenter = faceAxis === 0 ? headCenter.x : headCenter.z;
  const faceExtent = faceAxis === 0
    ? (faceSign > 0 ? extPosX : extNegX)
    : (faceSign > 0 ? extPosZ : extNegZ);
  const lrCenter = lrAxis === 0 ? headCenter.x : headCenter.z;

  // 5. Mouth Y level: ~35% up from head bottom (chin/lips area)
  const mouthY = headBbox.min.y + headH * 0.35;

  // 6. Build morph target deltas
  const jawDelta = new Float32Array(count * 3);
  const wideDelta = new Float32Array(count * 3);
  let jawVerts = 0, wideVerts = 0;

  for (const i of headIdxs) {
    const y = posAttr.getY(i);
    const faceVal = faceAxis === 0 ? posAttr.getX(i) : posAttr.getZ(i);
    const lrVal = lrAxis === 0 ? posAttr.getX(i) : posAttr.getZ(i);

    // Frontness: 0 at centroid, 1 at face surface
    const frontness = faceExtent > 0.001
      ? ((faceVal - faceCenter) * faceSign) / faceExtent
      : 0;
    if (frontness < -0.1) continue; // back of head → skip

    const frontFade = Math.max(Math.min((frontness + 0.1) / 0.6, 1), 0);

    // JAW OPEN: pull lower-face vertices downward
    const mouthUpper = mouthY + headH * 0.10;
    if (y < mouthUpper) {
      const downFactor = Math.min((mouthUpper - y) / (mouthUpper - headBbox.min.y), 1);
      const eased = downFactor * downFactor; // quadratic for natural falloff
      const disp = eased * frontFade * headH * 0.20; // 20% of head height max
      jawDelta[i * 3 + 1] = -disp;
      if (disp > 0.0001) jawVerts++;
    }

    // MOUTH WIDE: push mouth-level vertices apart horizontally
    const yDist = Math.abs(y - mouthY);
    if (yDist < headH * 0.15) {
      const yFade = 1 - yDist / (headH * 0.15);
      const lrOff = lrVal - lrCenter;
      const disp = Math.sign(lrOff) * yFade * frontFade * headH * 0.08;
      wideDelta[i * 3 + lrAxis] = disp;
      if (Math.abs(disp) > 0.0001) wideVerts++;
    }
  }

  if (jawVerts < 5) {
    console.warn('[MORPH] Too few jaw vertices found:', jawVerts);
    return false;
  }

  // 7. Attach morph attributes to geometry
  const jawAttr = new THREE.Float32BufferAttribute(jawDelta, 3);
  jawAttr.name = 'jawOpen';
  const wideAttr = new THREE.Float32BufferAttribute(wideDelta, 3);
  wideAttr.name = 'mouthWide';

  geo.morphAttributes.position = [jawAttr, wideAttr];
  geo.morphTargetsRelative = true;

  mesh.updateMorphTargets();

  // Force shader recompile to include morph target support
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach(m => { (m as THREE.Material).needsUpdate = true; });

  console.log(
    `%c[MORPH] Created mouth morphs: headVerts=${headIdxs.length} jawVerts=${jawVerts} wideVerts=${wideVerts} ` +
    `faceAxis=${faceAxis === 0 ? 'X' : 'Z'}${faceSign > 0 ? '+' : '-'} headH=${headH.toFixed(4)}`,
    'color: #ff69b4; font-weight: bold'
  );
  return true;
}

// Shared animation library path — kanecov1 uses the same Tripo skeleton
// as other Tripo models (Root, Hip, L_Upperarm, etc.) so its full-body
// animations can be reused for any model with compatible bone names.
const SHARED_ANIM_LIB = '/kanecov1.glb';

export function Avatar({ modelUrl, volumeRef, animationState = 'idle' }: AvatarProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(modelUrl);
  // Pre-load shared animation library (animations only — mesh is ignored)
  const { animations: sharedAnimLib } = useGLTF(SHARED_ANIM_LIB);

  // ============================================================
  // CRITICAL FIX #1: Clone scene with SkeletonUtils
  // useGLTF caches scenes — reusing the same Three.js scene object
  // across React renders corrupts skeleton bindings (bone references
  // get stale, boneInverses don't match). SkeletonUtils.clone()
  // deep-clones the scene WITH proper skeleton re-binding.
  // ============================================================
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    console.log('%c[AVATAR] Scene cloned via SkeletonUtils', 'color: #d4af37; font-weight: bold');
    return c;
  }, [scene]);

  // ============================================================
  // CRITICAL FIX #2: Clone + repair clips (never mutate cached originals)
  // useGLTF caches animation clips too. repairTrackNames() mutates
  // track names in-place — if we modify the cached clips, switching
  // models and switching back produces double-repaired garbage names.
  // Also filter out "baked pose" clips (<0.1s) that are static.
  // ============================================================
  const { repairedClips, hasRealAnimation } = useMemo(() => {
    const boneNames = new Set<string>();
    clone.traverse(c => { if ((c as THREE.Bone).isBone) boneNames.add(c.name); });

    // Filter out static clips and clone surviving ones
    let realClips = animations
      .filter(clip => clip.duration > MIN_CLIP_DURATION)
      .map(clip => clip.clone());

    // Fallback: if model has no real animations but uses Tripo skeleton,
    // borrow body animations from shared library (same bone names)
    if (realClips.length === 0 && sharedAnimLib.length > 0 && boneNames.has('L_Upperarm')) {
      const shared = sharedAnimLib
        .filter(clip => clip.duration > MIN_CLIP_DURATION)
        .map(clip => clip.clone());
      if (shared.length > 0) {
        console.log(`%c[AVATAR] No embedded animations — loading ${shared.length} clips from shared Tripo library`,
          'color: #d4af37; font-weight: bold');
        realClips = shared;
      }
    }

    if (realClips.length > 0) {
      const count = repairTrackNames(realClips, boneNames);
      if (count > 0) console.log(`%c[AVATAR] Repaired ${count} track names`, 'color: #ffa500');

      // Binding diagnostic
      let bound = 0, total = 0;
      for (const clip of realClips) {
        for (const track of clip.tracks) {
          total++;
          const di = track.name.lastIndexOf('.');
          const bn = di >= 0 ? track.name.substring(0, di) : track.name;
          if (clone.getObjectByName(bn)) bound++;
        }
        console.log(`  Clip "${clip.name}" dur=${clip.duration.toFixed(2)}s tracks=${clip.tracks.length}`);
      }
      console.log(`%c[AVATAR] Track binding: ${bound}/${total} (${total > 0 ? (bound / total * 100).toFixed(0) : 0}%)`,
        bound === total ? 'color: #00ff00; font-weight: bold' : 'color: #ffa500; font-weight: bold');
    }

    const skipped = animations.length - realClips.length;
    if (skipped > 0) console.log(`%c[AVATAR] Skipped ${skipped} static clips (<${MIN_CLIP_DURATION}s)`, 'color: #ff8800');

    return { repairedClips: realClips, hasRealAnimation: realClips.length > 0 };
  }, [clone, animations, sharedAnimLib]);

  // ============================================================
  // CRITICAL FIX #3: Use drei's useAnimations hook
  // This is the standard, proven R3F animation pipeline.
  // Internally it:
  //   1. Creates AnimationMixer with useState (persistent)
  //   2. Sets mixer._root = groupRef.current via useLayoutEffect
  //      on EVERY render (keeps root synced with React reconciler)
  //   3. Creates actions lazily via mixer.clipAction(clip, root)
  //   4. Calls mixer.update(delta) in its own useFrame hook
  // ============================================================
  const { actions, mixer, names } = useAnimations(repairedClips, groupRef);

  // ------- Bone refs -------
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBoneRef = useRef<THREE.Bone | null>(null);
  const jawBoneRef = useRef<THREE.Bone | null>(null);
  const lipTopRef = useRef<THREE.Bone | null>(null);
  const lipBottomRef = useRef<THREE.Bone | null>(null);
  const lipTopLRef = useRef<THREE.Bone | null>(null);
  const lipTopRRef = useRef<THREE.Bone | null>(null);
  const lipBottomLRef = useRef<THREE.Bone | null>(null);
  const lipBottomRRef = useRef<THREE.Bone | null>(null);
  const lipsLRef = useRef<THREE.Bone | null>(null);
  const lipsRRef = useRef<THREE.Bone | null>(null);
  const hasFullMouthRigRef = useRef(false);

  // Arm bone refs (for T-pose fix)
  const armLRef = useRef<THREE.Bone | null>(null);
  const armRRef = useRef<THREE.Bone | null>(null);
  const forearmLRef = useRef<THREE.Bone | null>(null);
  const forearmRRef = useRef<THREE.Bone | null>(null);
  const armLRestQ = useRef<THREE.Quaternion | null>(null);
  const armRRestQ = useRef<THREE.Quaternion | null>(null);
  const forearmLRestQ = useRef<THREE.Quaternion | null>(null);
  const forearmRRestQ = useRef<THREE.Quaternion | null>(null);

  // World-space computed arm fix quaternions (computed once in useFrame)
  const armFixLRef = useRef<THREE.Quaternion | null>(null);
  const armFixRRef = useRef<THREE.Quaternion | null>(null);
  const forearmFixLRef = useRef<THREE.Quaternion | null>(null);
  const forearmFixRRef = useRef<THREE.Quaternion | null>(null);
  const armFixComputedRef = useRef(false);

  // Diagnostic frame counter
  const diagFrameRef = useRef(0);

  // Smoothed viseme channels
  const smoothJawRef = useRef(0);
  const smoothWidthRef = useRef(0);
  const smoothVolRef = useRef(0);

  // Base rotations (captured once from bind pose, used as anchor for offsets)
  const headBaseRotRef = useRef<THREE.Euler | null>(null);
  const neckBaseRotRef = useRef<THREE.Euler | null>(null);
  const lipsLBaseRotRef = useRef<THREE.Euler | null>(null);
  const lipsRBaseRotRef = useRef<THREE.Euler | null>(null);

  // Animation state tracking
  const clipMapRef = useRef<Map<AnimationState, THREE.AnimationClip>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentAnimStateRef = useRef<AnimationState>('idle');

  // Morph-target mouth (for models without jaw/lip bones)
  const morphMeshRef = useRef<THREE.SkinnedMesh | null>(null);
  const hasMorphMouthRef = useRef(false);

  // Arm gesture blending (smooth idle↔talking transition)
  const armTalkBlendRef = useRef(0);

  // ============================================================
  // EFFECT 1: Scan CLONE skeleton for bones
  // ============================================================
  useEffect(() => {
    // Reset all bone refs
    headBoneRef.current = null;
    neckBoneRef.current = null;
    jawBoneRef.current = null;
    lipTopRef.current = null;
    lipBottomRef.current = null;
    lipTopLRef.current = null;
    lipTopRRef.current = null;
    lipBottomLRef.current = null;
    lipBottomRRef.current = null;
    lipsLRef.current = null;
    lipsRRef.current = null;
    hasFullMouthRigRef.current = false;
    headBaseRotRef.current = null;
    neckBaseRotRef.current = null;
    lipsLBaseRotRef.current = null;
    lipsRBaseRotRef.current = null;
    armLRef.current = null;
    armRRef.current = null;
    forearmLRef.current = null;
    forearmRRef.current = null;
    armLRestQ.current = null;
    armRRestQ.current = null;
    forearmLRestQ.current = null;
    forearmRRestQ.current = null;
    armFixLRef.current = null;
    armFixRRef.current = null;
    forearmFixLRef.current = null;
    forearmFixRRef.current = null;
    armFixComputedRef.current = false;
    morphMeshRef.current = null;
    hasMorphMouthRef.current = false;

    const allBoneNames: string[] = [];
    const mouthBoneMap: Record<string, React.MutableRefObject<THREE.Bone | null>> = {
      // Blender dot convention (original rig names)
      'lip.T': lipTopRef, 'lip.B': lipBottomRef,
      'lip.T.L': lipTopLRef, 'lip.T.R': lipTopRRef,
      'lip.B.L': lipBottomLRef, 'lip.B.R': lipBottomRRef,
      'lips.L': lipsLRef, 'lips.R': lipsRRef,
      // GLB export convention (dots stripped — Tripo/generic exporters)
      'lipT': lipTopRef, 'lipB': lipBottomRef,
      'lipTL': lipTopLRef, 'lipTR': lipTopRRef,
      'lipBL': lipBottomLRef, 'lipBR': lipBottomRRef,
      'lipsL': lipsLRef, 'lipsR': lipsRRef,
    };

    clone.traverse((child) => {
      if (!(child as THREE.Bone).isBone) return;
      const bone = child as THREE.Bone;
      allBoneNames.push(bone.name);
      const lname = bone.name.toLowerCase();

      // Head / Neck / Jaw detection
      if (lname.includes('head') && !lname.includes('headtop') && !lname.includes('head_end') && !headBoneRef.current)
        headBoneRef.current = bone;
      if (lname.includes('neck') && !lname.includes('necklace') && !neckBoneRef.current)
        neckBoneRef.current = bone;
      if ((lname === 'jaw' || lname.includes('jaw') || lname.includes('chin') || lname.includes('mandible')) && !jawBoneRef.current)
        jawBoneRef.current = bone;

      // Lip detection by pattern
      if ((lname.includes('lips') || lname.includes('lip')) && !lname.includes('headtop')) {
        if ((lname.includes('.l') || lname.includes('_l') || lname.includes('left') || lname.endsWith('l')) && !lipsLRef.current) lipsLRef.current = bone;
        if ((lname.includes('.r') || lname.includes('_r') || lname.includes('right') || lname.endsWith('r')) && !lipsRRef.current) lipsRRef.current = bone;
      }

      // Exact-name mouth rig (overrides pattern matching)
      const mRef = mouthBoneMap[bone.name];
      if (mRef) mRef.current = bone;

      // Arm bones — multi-convention support
      const isLeft = lname.startsWith('l_') || lname.includes('left') || lname.includes('.l') || lname.includes('_l');
      const isRight = lname.startsWith('r_') || lname.includes('right') || lname.includes('.r') || lname.includes('_r');

      if (lname.includes('forearm') || lname.includes('fore_arm')) {
        if (isLeft && !forearmLRef.current) forearmLRef.current = bone;
        if (isRight && !forearmRRef.current) forearmRRef.current = bone;
      } else if (lname.includes('upperarm') || lname.includes('upper_arm') ||
                 (lname.includes('arm') && !lname.includes('forearm'))) {
        if (isLeft && !armLRef.current) armLRef.current = bone;
        if (isRight && !armRRef.current) armRRef.current = bone;
      }
    });

    // Capture arm rest quaternions BEFORE any animation
    if (armLRef.current) armLRestQ.current = armLRef.current.quaternion.clone();
    if (armRRef.current) armRRestQ.current = armRRef.current.quaternion.clone();
    if (forearmLRef.current) forearmLRestQ.current = forearmLRef.current.quaternion.clone();
    if (forearmRRef.current) forearmRRestQ.current = forearmRRef.current.quaternion.clone();

    hasFullMouthRigRef.current = !!(jawBoneRef.current && lipsLRef.current && lipsRRef.current);

    // SkinnedMesh diagnostics + fix frustumCulled
    let skinnedCount = 0;
    clone.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = child as THREE.SkinnedMesh;
        skinnedCount++;
        // Disable frustum culling — animated models can have wrong bounding boxes
        // causing them to disappear when the camera moves
        sm.frustumCulled = false;
        console.log(`  SkinnedMesh: "${sm.name}" bones=${sm.skeleton?.bones.length ?? 0} bindMode=${sm.bindMode}`);
      }
    });

    console.log(`%c[AVATAR] ${allBoneNames.length} bones, ${skinnedCount} SkinnedMesh(es)`, 'color: #d4af37; font-weight: bold');
    console.log(`  Head=${headBoneRef.current?.name ?? 'MISS'} Neck=${neckBoneRef.current?.name ?? 'MISS'} Jaw=${jawBoneRef.current?.name ?? 'MISS'}`);
    console.log(`  Arms: L=${armLRef.current?.name ?? 'MISS'} R=${armRRef.current?.name ?? 'MISS'} ForeL=${forearmLRef.current?.name ?? 'MISS'} ForeR=${forearmRRef.current?.name ?? 'MISS'}`);
    console.log(`  MouthRig=${hasFullMouthRigRef.current ? 'FULL' : 'NONE'}`);
    console.log(`  All bones: ${allBoneNames.join(', ')}`);

    // Mouth animation for models WITHOUT facial bones:
    // 1. Check if the GLB has built-in morph targets (jawOpen, mouthWide)
    // 2. If not, create programmatic morph targets from vertex analysis
    if (!hasFullMouthRigRef.current) {
      let targetMesh: THREE.SkinnedMesh | null = null;
      clone.traverse(c => {
        if ((c as THREE.SkinnedMesh).isSkinnedMesh && !targetMesh) {
          targetMesh = c as THREE.SkinnedMesh;
        }
      });
      if (targetMesh) {
        // Check for built-in morph targets from GLB (created in Blender)
        const dict = (targetMesh as THREE.SkinnedMesh).morphTargetDictionary;
        if (dict && ('jawOpen' in dict) && ('mouthWide' in dict)) {
          morphMeshRef.current = targetMesh;
          hasMorphMouthRef.current = true;
          console.log('%c[AVATAR] Using built-in GLB morph targets: jawOpen=%d mouthWide=%d',
            'color: #00ff00; font-weight: bold', dict['jawOpen'], dict['mouthWide']);
        } else {
          // Fallback: create programmatic morph targets from vertex analysis
          hasMorphMouthRef.current = createMouthMorphTargets(targetMesh);
          if (hasMorphMouthRef.current) {
            morphMeshRef.current = targetMesh;
            console.log('%c[AVATAR] Using programmatic morph targets (fallback)', 'color: #ffa500; font-weight: bold');
          }
        }
      }
    }
  }, [clone]);

  // ============================================================
  // EFFECT 2: Play initial animation via drei actions
  // drei's useAnimations creates actions lazily — accessing
  // actions[name] calls mixer.clipAction(clip, groupRef.current)
  // which properly binds tracks to the clone's bone hierarchy.
  // ============================================================
  useEffect(() => {
    if (!hasRealAnimation || names.length === 0) return;

    const clipMap = categorizeClips(repairedClips);
    clipMapRef.current = clipMap;

    const idleClip = clipMap.get('idle') || repairedClips[0];
    const action = actions[idleClip.name];
    if (action) {
      action.reset();
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      currentActionRef.current = action;
      currentAnimStateRef.current = 'idle';
      console.log(`%c[AVATAR] Playing: "${idleClip.name}" via drei actions`, 'color: #00ff00; font-weight: bold');
    }
  }, [actions, names, repairedClips, hasRealAnimation]);

  // ============================================================
  // EFFECT 3: Crossfade on animationState changes
  // ============================================================
  useEffect(() => {
    if (!hasRealAnimation || clipMapRef.current.size === 0) return;
    if (animationState === currentAnimStateRef.current) return;
    const targetClip = clipMapRef.current.get(animationState);
    if (!targetClip) return;

    const prevAction = currentActionRef.current;
    const nextAction = actions[targetClip.name];
    if (!nextAction) return;

    if (animationState === 'greeting') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    nextAction.reset();
    if (prevAction) nextAction.crossFadeFrom(prevAction, CROSSFADE_DURATION, true);
    nextAction.play();
    currentActionRef.current = nextAction;
    currentAnimStateRef.current = animationState;

    if (animationState === 'greeting') {
      const onDone = (e: { action: THREE.AnimationAction }) => {
        if (e.action !== nextAction) return;
        mixer.removeEventListener('finished', onDone);
        const idleClip = clipMapRef.current.get('idle');
        if (idleClip) {
          const a = actions[idleClip.name];
          if (a) {
            a.reset();
            a.setLoop(THREE.LoopRepeat, Infinity);
            a.crossFadeFrom(nextAction, CROSSFADE_DURATION, true);
            a.play();
            currentActionRef.current = a;
            currentAnimStateRef.current = 'idle';
          }
        }
      };
      mixer.addEventListener('finished', onDone);
    }
  }, [animationState, hasRealAnimation, actions, mixer]);

  // ============================================================
  // RENDER LOOP — Custom bone overrides on top of mixer
  //
  // ORDERING: drei's useAnimations registers its useFrame FIRST
  // (when the hook was called above), so mixer.update(delta) runs
  // BEFORE this callback. We apply overrides AFTER the mixer has
  // set bone transforms from the animation clips.
  //
  // Three.js v0.164 renderer auto-handles skeleton:
  //   - Auto-creates boneTexture via skeleton.computeBoneTexture()
  //   - Auto-calls skeleton.update() every frame
  //   - Auto-uploads boneTexture to GPU
  // ============================================================
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const vol = smoothVolRef.current;
    diagFrameRef.current++;

    // =======================================
    // GROUP-LEVEL ANIMATION (never distorts mesh — moves whole model)
    // =======================================
    if (groupRef.current) {
      const amp = hasRealAnimation ? 1.0 : 2.5;
      const breathY = Math.sin(t * 1.8) * 0.015 * amp;
      const swayX = Math.sin(t * 0.6) * 0.012 * amp;
      const lookY = Math.sin(t * 0.35) * 0.04 * amp;
      const lateralX = Math.sin(t * 0.45) * 0.008 * amp;

      groupRef.current.position.y = -1 + breathY;
      groupRef.current.position.x = lateralX;
      groupRef.current.rotation.x = swayX;
      groupRef.current.rotation.y = lookY;
    }

    // NOTE: mixer.update(delta) already called by drei's useAnimations

    // =======================================
    // FREQUENCY-DRIVEN LIP SYNC (computed early — used by arms + mouth)
    // =======================================
    const viseme = volumeRef.current;
    const jawAlpha = viseme.jawOpen > smoothJawRef.current ? 0.5 : 0.12;
    smoothJawRef.current += (viseme.jawOpen - smoothJawRef.current) * jawAlpha;
    const widthAlpha = viseme.mouthWidth > smoothWidthRef.current ? 0.4 : 0.15;
    smoothWidthRef.current += (viseme.mouthWidth - smoothWidthRef.current) * widthAlpha;
    const volAlpha = viseme.volume > smoothVolRef.current ? 0.45 : 0.1;
    smoothVolRef.current += (viseme.volume - smoothVolRef.current) * volAlpha;

    const jaw = smoothJawRef.current;
    const width = smoothWidthRef.current;

    // =======================================
    // ARM POSE SYSTEM — models WITHOUT animation clips
    // Computes world-space fixes ONCE to bring arms from T-pose to
    // a natural resting pose, then applies subtle dynamic offsets.
    // =======================================
    if (!hasRealAnimation && !armFixComputedRef.current && armLRef.current) {
      // Helper: compute fix quaternion to rotate a bone's direction toward a target
      const computeBoneFix = (
        bone: THREE.Bone,
        childBoneHint: THREE.Bone | null,
        targetDir: THREE.Vector3,
        strength: number
      ): THREE.Quaternion => {
        bone.updateWorldMatrix(true, true);

        let childBone: THREE.Bone | undefined = childBoneHint || undefined;
        if (!childBone) {
          childBone = bone.children.find(c => {
            if (!(c as THREE.Bone).isBone) return false;
            const n = c.name.toLowerCase();
            return !n.includes('twist') && !n.includes('helper') && !n.includes('roll');
          }) as THREE.Bone | undefined;
        }
        if (!childBone) {
          childBone = bone.children.find(c => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
        }
        if (!childBone) return new THREE.Quaternion();

        const bonePos = new THREE.Vector3();
        const childPos = new THREE.Vector3();
        bone.getWorldPosition(bonePos);
        childBone.getWorldPosition(childPos);
        const boneDir = childPos.clone().sub(bonePos).normalize();

        console.log(`[AVATAR] Bone fix ${bone.name}: child=${childBone.name} dir=(${boneDir.x.toFixed(3)}, ${boneDir.y.toFixed(3)}, ${boneDir.z.toFixed(3)}) → target=(${targetDir.x.toFixed(3)}, ${targetDir.y.toFixed(3)}, ${targetDir.z.toFixed(3)}) str=${strength}`);

        const worldFix = new THREE.Quaternion().setFromUnitVectors(boneDir, targetDir.clone().normalize());
        worldFix.slerp(new THREE.Quaternion(), 1.0 - strength); // strength=0.95 → keep 95%

        const parentWQ = new THREE.Quaternion();
        if (bone.parent) bone.parent.getWorldQuaternion(parentWQ);
        const parentInv = parentWQ.clone().invert();
        return parentInv.multiply(worldFix).multiply(parentWQ);
      };

      // Detect outward direction from T-pose arm
      const getArmOutward = (bone: THREE.Bone, childBone: THREE.Bone | null): THREE.Vector3 => {
        bone.updateWorldMatrix(true, true);
        const child = childBone || bone.children.find(c => (c as THREE.Bone).isBone) as THREE.Bone | undefined;
        if (!child) return new THREE.Vector3(1, 0, 0);
        const bp = new THREE.Vector3(); const cp = new THREE.Vector3();
        bone.getWorldPosition(bp); child.getWorldPosition(cp);
        const dir = cp.clone().sub(bp).normalize();
        return new THREE.Vector3(dir.x, 0, dir.z).normalize();
      };

      // Upper arms: hang nearly straight down, tiny outward angle
      const outL = getArmOutward(armLRef.current, forearmLRef.current);
      armFixLRef.current = computeBoneFix(
        armLRef.current, forearmLRef.current,
        new THREE.Vector3(outL.x * 0.06, -0.98, 0.08), // Nearly straight down
        0.95 // 95% application (was 65%)
      );
      if (armRRef.current) {
        const outR = getArmOutward(armRRef.current, forearmRRef.current);
        armFixRRef.current = computeBoneFix(
          armRRef.current, forearmRRef.current,
          new THREE.Vector3(outR.x * 0.06, -0.98, 0.08),
          0.95
        );
      }

      // Apply upper arm fixes first, then compute forearm fixes
      // (forearm world direction changes after upper arm is rotated)
      if (armLRef.current && armLRestQ.current && armFixLRef.current) {
        armLRef.current.quaternion.copy(armLRestQ.current).premultiply(armFixLRef.current);
        armLRef.current.updateWorldMatrix(true, true);
      }
      if (armRRef.current && armRRestQ.current && armFixRRef.current) {
        armRRef.current.quaternion.copy(armRRestQ.current).premultiply(armFixRRef.current);
        armRRef.current.updateWorldMatrix(true, true);
      }

      // Forearms: slight forward bend for natural elbow angle
      if (forearmLRef.current) {
        forearmFixLRef.current = computeBoneFix(
          forearmLRef.current, null,
          new THREE.Vector3(0.15, -0.75, 0.65), // Forward + slightly inward
          0.40
        );
      }
      if (forearmRRef.current) {
        forearmFixRRef.current = computeBoneFix(
          forearmRRef.current, null,
          new THREE.Vector3(-0.15, -0.75, 0.65), // Forward + slightly inward (mirrored)
          0.40
        );
      }

      // Restore rest quaternions for upper arms (will be re-applied each frame)
      if (armLRef.current && armLRestQ.current) armLRef.current.quaternion.copy(armLRestQ.current);
      if (armRRef.current && armRRestQ.current) armRRef.current.quaternion.copy(armRRestQ.current);

      armFixComputedRef.current = true;
      console.log('%c[AVATAR] Computed arm + forearm rest poses', 'color: #ffa500; font-weight: bold');
    }

    // Apply arm poses + subtle dynamic offsets (only when no real animation)
    if (!hasRealAnimation && armFixComputedRef.current) {
      // Smooth blend: idle(0) ↔ talking(1)
      const talkTarget = vol > 0.03 ? 1.0 : 0.0;
      armTalkBlendRef.current = THREE.MathUtils.lerp(armTalkBlendRef.current, talkTarget, 0.04);
      const tb = armTalkBlendRef.current;

      // --- Upper arms: base fix + very subtle offsets ---
      if (armLRef.current && armLRestQ.current && armFixLRef.current) {
        armLRef.current.quaternion.copy(armLRestQ.current).premultiply(armFixLRef.current);
        // Idle: barely perceptible weight shift (no rocking)
        const idleZ = Math.sin(t * 0.3) * 0.012;
        const idleX = Math.sin(t * 0.45 + 1.0) * 0.008;
        // Talk: small emphasis gestures tied to speech energy
        const talkZ = tb * Math.sin(t * 1.8) * jaw * 0.06;
        const talkX = tb * jaw * 0.04; // Slight forward lift when speaking
        _e.set(idleX + talkX, 0, idleZ + talkZ);
        armLRef.current.quaternion.multiply(_q.setFromEuler(_e));
      }
      if (armRRef.current && armRRestQ.current && armFixRRef.current) {
        armRRef.current.quaternion.copy(armRRestQ.current).premultiply(armFixRRef.current);
        const idleZ = Math.sin(t * 0.35 + 2.0) * 0.010;
        const idleX = Math.sin(t * 0.4 + 2.5) * 0.007;
        const talkZ = tb * Math.sin(t * 1.5 + Math.PI) * jaw * 0.04;
        const talkX = tb * jaw * 0.03;
        _e.set(idleX + talkX, 0, -(idleZ + talkZ));
        armRRef.current.quaternion.multiply(_q.setFromEuler(_e));
      }

      // --- Forearms: base elbow bend fix + tiny talk variation ---
      if (forearmLRef.current && forearmLRestQ.current && forearmFixLRef.current) {
        forearmLRef.current.quaternion.copy(forearmLRestQ.current).premultiply(forearmFixLRef.current);
        const talkBend = tb * jaw * 0.03;
        _e.set(talkBend, 0, 0);
        forearmLRef.current.quaternion.multiply(_q.setFromEuler(_e));
      } else if (forearmLRef.current && forearmLRestQ.current) {
        forearmLRef.current.quaternion.copy(forearmLRestQ.current);
      }
      if (forearmRRef.current && forearmRRestQ.current && forearmFixRRef.current) {
        forearmRRef.current.quaternion.copy(forearmRRestQ.current).premultiply(forearmFixRRef.current);
        const talkBend = tb * jaw * 0.025;
        _e.set(talkBend, 0, 0);
        forearmRRef.current.quaternion.multiply(_q.setFromEuler(_e));
      } else if (forearmRRef.current && forearmRRestQ.current) {
        forearmRRef.current.quaternion.copy(forearmRRestQ.current);
      }
    }

    // =======================================
    // HEAD/NECK IDLE ANIMATION
    // =======================================
    if (neckBoneRef.current) {
      if (!neckBaseRotRef.current) neckBaseRotRef.current = neckBoneRef.current.rotation.clone();
      neckBoneRef.current.rotation.y = neckBaseRotRef.current.y + Math.sin(t * 0.7) * 0.15;
      neckBoneRef.current.rotation.x = neckBaseRotRef.current.x + Math.sin(t * 1.0) * 0.08;
    }
    if (headBoneRef.current) {
      if (!headBaseRotRef.current) headBaseRotRef.current = headBoneRef.current.rotation.clone();
      headBoneRef.current.rotation.z = headBaseRotRef.current.z + Math.sin(t * 1.3) * 0.12;
      headBoneRef.current.rotation.x = headBaseRotRef.current.x + Math.sin(t * 0.8) * 0.06;
    }

    // =======================================
    // DIAGNOSTIC LOGGING (~every 3 sec)
    // =======================================
    if (diagFrameRef.current % 180 === 1) {
      const la = armLRef.current;
      const laQ = la ? `z=${la.quaternion.z.toFixed(3)} w=${la.quaternion.w.toFixed(3)}` : 'null';

      // Frame 1: initial skeleton check
      if (diagFrameRef.current === 1) {
        clone.traverse(c => {
          if ((c as THREE.SkinnedMesh).isSkinnedMesh) {
            const sm = c as THREE.SkinnedMesh;
            const skel = sm.skeleton;
            console.log(`%c[AVATAR] f=1 "${sm.name}" boneTexture=${!!skel?.boneTexture} bones=${skel?.bones.length} bindMode=${sm.bindMode} visible=${sm.visible}`,
              'color: #00ff00; font-weight: bold');
          }
        });
      }

      // Frame ~10+: deep skeleton verification (after renderer has had time to process)
      if (diagFrameRef.current >= 10 && diagFrameRef.current < 20) {
        clone.traverse(c => {
          if ((c as THREE.SkinnedMesh).isSkinnedMesh) {
            const sm = c as THREE.SkinnedMesh;
            const skel = sm.skeleton;
            const bt = skel?.boneTexture;
            const btInfo = bt ? `${bt.image.width}x${bt.image.height}` : 'NONE';

            // Verify skeleton bones are the SAME objects we're manipulating
            const headBone = headBoneRef.current;
            let headInSkeleton = false;
            if (headBone && skel?.bones) {
              headInSkeleton = skel.bones.some(b => b === headBone);
            }

            // Check if boneMatrices are changing
            const bm = skel?.boneMatrices;
            const sample = bm ? `[0..3]=${bm[0]?.toFixed(3)},${bm[1]?.toFixed(3)},${bm[2]?.toFixed(3)},${bm[3]?.toFixed(3)}` : 'null';

            console.log(`%c[AVATAR] f=${diagFrameRef.current} DEEP: "${sm.name}" boneTexture=${btInfo} headInSkeleton=${headInSkeleton} boneMatrices=${sample} frustumCulled=${sm.frustumCulled}`,
              bt ? 'color: #00ff00; font-weight: bold' : 'color: #ff0000; font-weight: bold');
          }
        });

        // Mixer action diagnostics — verify actions are actually playing
        if (hasRealAnimation && currentActionRef.current) {
          const act = currentActionRef.current;
          console.log(`%c[AVATAR] f=${diagFrameRef.current} MIXER: action="${act.getClip().name}" isRunning=${act.isRunning()} weight=${act.getEffectiveWeight().toFixed(3)} time=${act.time.toFixed(3)} mixerTime=${mixer.time.toFixed(3)}`,
            act.isRunning() ? 'color: #00ff00; font-weight: bold' : 'color: #ff0000; font-weight: bold');
        }
      }

      const mouthInfo = hasMorphMouthRef.current
        ? `morphJaw=${morphMeshRef.current?.morphTargetInfluences?.[0]?.toFixed(3) ?? '?'} morphWide=${morphMeshRef.current?.morphTargetInfluences?.[1]?.toFixed(3) ?? '?'}`
        : (hasFullMouthRigRef.current ? 'boneRig' : 'NONE');
      console.log(`[AVATAR] f=${diagFrameRef.current} vol=${vol.toFixed(3)} jaw=${smoothJawRef.current.toFixed(3)} mouth=${mouthInfo} armL.q(${laQ}) hasRealAnim=${hasRealAnimation}`);
    }

    // Jaw bone
    if (jawBoneRef.current) {
      const amp = hasFullMouthRigRef.current ? 0.45 : 0.35;
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(jawBoneRef.current.rotation.x, jaw * amp, 0.4);
    }

    // Full mouth rig lips
    if (hasFullMouthRigRef.current) {
      if (lipsLRef.current && !lipsLBaseRotRef.current) lipsLBaseRotRef.current = lipsLRef.current.rotation.clone();
      if (lipsRRef.current && !lipsRBaseRotRef.current) lipsRBaseRotRef.current = lipsRRef.current.rotation.clone();

      if (vol > 0.02) {
        if (lipsLRef.current && lipsLBaseRotRef.current) {
          lipsLRef.current.rotation.y = THREE.MathUtils.lerp(lipsLRef.current.rotation.y, lipsLBaseRotRef.current.y - width * 0.12, 0.35);
          lipsLRef.current.rotation.z = THREE.MathUtils.lerp(lipsLRef.current.rotation.z, lipsLBaseRotRef.current.z + jaw * 0.06, 0.3);
        }
        if (lipsRRef.current && lipsRBaseRotRef.current) {
          lipsRRef.current.rotation.y = THREE.MathUtils.lerp(lipsRRef.current.rotation.y, lipsRBaseRotRef.current.y + width * 0.12, 0.35);
          lipsRRef.current.rotation.z = THREE.MathUtils.lerp(lipsRRef.current.rotation.z, lipsRBaseRotRef.current.z + jaw * 0.06, 0.3);
        }
        if (lipTopRef.current) lipTopRef.current.position.y = THREE.MathUtils.lerp(lipTopRef.current.position.y, jaw * 0.002, 0.3);
        if (lipBottomRef.current) lipBottomRef.current.position.y = THREE.MathUtils.lerp(lipBottomRef.current.position.y, -jaw * 0.001, 0.3);
        const cs = (width - 0.3) * 0.003;
        if (lipTopLRef.current) lipTopLRef.current.position.x = THREE.MathUtils.lerp(lipTopLRef.current.position.x, cs * 0.5, 0.2);
        if (lipTopRRef.current) lipTopRRef.current.position.x = THREE.MathUtils.lerp(lipTopRRef.current.position.x, -cs * 0.5, 0.2);
        if (lipBottomLRef.current) lipBottomLRef.current.position.x = THREE.MathUtils.lerp(lipBottomLRef.current.position.x, cs * 0.5, 0.2);
        if (lipBottomRRef.current) lipBottomRRef.current.position.x = THREE.MathUtils.lerp(lipBottomRRef.current.position.x, -cs * 0.5, 0.2);
      } else {
        // Idle breathing micro-animation for mouth
        const bp = Math.sin(t * 1.8) * 0.5 + 0.5;
        if (jawBoneRef.current) jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(jawBoneRef.current.rotation.x, bp * 0.01, 0.06);
        if (lipsLRef.current && lipsLBaseRotRef.current) lipsLRef.current.rotation.y = THREE.MathUtils.lerp(lipsLRef.current.rotation.y, lipsLBaseRotRef.current.y + bp * 0.005, 0.05);
        if (lipsRRef.current && lipsRBaseRotRef.current) lipsRRef.current.rotation.y = THREE.MathUtils.lerp(lipsRRef.current.rotation.y, lipsRBaseRotRef.current.y - bp * 0.005, 0.05);
      }
    }

    // Speech head gestures
    if (headBoneRef.current && headBaseRotRef.current && vol > 0.05) {
      headBoneRef.current.rotation.x += jaw * 0.012;
      headBoneRef.current.rotation.z += Math.sin(t * 6) * jaw * 0.006;
    }

    // =======================================
    // MORPH TARGET MOUTH (for models WITHOUT facial bones)
    // Drives jawOpen + mouthWide morph targets — either from GLB
    // (Blender shape keys) or programmatically created at load time.
    // =======================================
    if (hasMorphMouthRef.current && morphMeshRef.current?.morphTargetInfluences) {
      const mesh = morphMeshRef.current;
      const infl = mesh.morphTargetInfluences;
      const dict = mesh.morphTargetDictionary ?? {};
      const jawIdx = dict['jawOpen'] ?? 0;
      const wideIdx = dict['mouthWide'] ?? 1;

      if (vol > 0.02) {
        // Speaking: power curve softens the attack (less "forced" snap),
        // organic sine variation adds natural micro-movements
        const jawTarget = Math.pow(jaw, 0.75) * 1.0
          + Math.sin(t * 5.3) * 0.025 + Math.sin(t * 8.7) * 0.012;
        const wideTarget = Math.pow(width, 0.8) * 0.65
          + Math.sin(t * 4.1) * 0.015;
        // Slower lerp (0.25) = smoother motion, less snappy/robotic
        infl[jawIdx] = THREE.MathUtils.lerp(infl[jawIdx], Math.max(0, jawTarget), 0.25);
        infl[wideIdx] = THREE.MathUtils.lerp(infl[wideIdx], Math.max(0, wideTarget), 0.22);
      } else {
        // Idle: subtle breathing micro-animation keeps face alive
        const bp = Math.sin(t * 1.8) * 0.5 + 0.5;
        infl[jawIdx] = THREE.MathUtils.lerp(infl[jawIdx], bp * 0.05, 0.06);
        infl[wideIdx] = THREE.MathUtils.lerp(infl[wideIdx], bp * 0.01, 0.04);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={clone} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

// Preload shared animation library so it's ready when models need it
useGLTF.preload(SHARED_ANIM_LIB);
