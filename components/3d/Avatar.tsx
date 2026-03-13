'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

export type AnimationState = 'idle' | 'speaking' | 'thinking' | 'greeting';

// Use local Draco decoder files (copied to public/draco/) instead of fetching from CDN.
useGLTF.setDecoderPath('/draco/');

// Reusable temp objects — avoid GC churn in 60fps useFrame loop
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _slerpQ = new THREE.Quaternion();

// =======================================
// GESTURE POSE LIBRARY — computed from Blender bone data
// Each pose has quaternions for L/R upperarm + forearm.
// Three.js Quaternion(x, y, z, w) — Blender outputs (w, x, y, z).
// =======================================
interface ArmPose {
  name: string;
  upperL: THREE.Quaternion; upperR: THREE.Quaternion;
  foreL: THREE.Quaternion;  foreR: THREE.Quaternion;
  /** Optional clavicle quaternions (for poses that need shoulder adjustment) */
  clavL?: THREE.Quaternion; clavR?: THREE.Quaternion;
  /** Minimum hold time in seconds before transitioning */
  holdMin: number;
  /** Maximum hold time */
  holdMax: number;
  /** Only use during speech? */
  speechOnly?: boolean;
}

const ARM_POSES: ArmPose[] = [
  {
    // Arms relaxed at sides (default resting pose)
    name: 'relaxed',
    upperL: new THREE.Quaternion(-0.0189, -0.0141, -0.7562, 0.6540),
    upperR: new THREE.Quaternion(-0.0164,  0.0128,  0.7080, 0.7059),
    foreL:  new THREE.Quaternion( 0.0512,  0.0017,  0.0334, 0.9981),
    foreR:  new THREE.Quaternion( 0.0509, -0.0004, -0.0083, 0.9987),
    holdMin: 8, holdMax: 16,
  },
  {
    // Left hand on hip, right relaxed
    name: 'hipL',
    upperL: new THREE.Quaternion( 0.0518, -0.1473, -0.5854, 0.7956),
    upperR: new THREE.Quaternion(-0.0164,  0.0128,  0.7080, 0.7059),
    foreL:  new THREE.Quaternion( 0.5687,  0.0749,  0.1069, 0.8121),
    foreR:  new THREE.Quaternion( 0.0509, -0.0004, -0.0083, 0.9987),
    holdMin: 8, holdMax: 14,
  },
  {
    // Right hand on hip, left relaxed
    name: 'hipR',
    upperL: new THREE.Quaternion(-0.0189, -0.0141, -0.7562, 0.6540),
    upperR: new THREE.Quaternion( 0.0518,  0.1473,  0.5854, 0.7956),
    foreL:  new THREE.Quaternion( 0.0512,  0.0017,  0.0334, 0.9981),
    foreR:  new THREE.Quaternion( 0.5687, -0.0749, -0.1069, 0.8121),
    holdMin: 8, holdMax: 14,
  },
  {
    // Both hands on hips (confident/waiting)
    name: 'hipBoth',
    upperL: new THREE.Quaternion( 0.0518, -0.1473, -0.5854, 0.7956),
    upperR: new THREE.Quaternion( 0.0518,  0.1473,  0.5854, 0.7956),
    foreL:  new THREE.Quaternion( 0.5687,  0.0749,  0.1069, 0.8121),
    foreR:  new THREE.Quaternion( 0.5687, -0.0749, -0.1069, 0.8121),
    holdMin: 6, holdMax: 12,
  },
  {
    // Arms folded in front of chest (confident/waiting) — Blender verified
    // Clavicles bring shoulders forward, upper arms angled down, forearms crossing inward
    name: 'armsFolded',
    clavL: new THREE.Quaternion(0.0694, -0.1043, 0.0073, 0.9921),
    clavR: new THREE.Quaternion(0.0694,  0.1043, -0.0073, 0.9921),
    upperL: new THREE.Quaternion(0.0619, -0.2057, -0.3126, 0.9253),
    upperR: new THREE.Quaternion(0.0619,  0.2057,  0.3126, 0.9253),
    foreL:  new THREE.Quaternion(0.3334, -0.5882, -0.5679, 0.4695),
    foreR:  new THREE.Quaternion(0.3334,  0.5882,  0.5679, 0.4695),
    holdMin: 8, holdMax: 16,
  },
  {
    // Hands together in front (attentive/listening)
    name: 'frontTogether',
    upperL: new THREE.Quaternion(-0.0201, -0.1548, -0.6394, 0.7529),
    upperR: new THREE.Quaternion(-0.0201,  0.1548,  0.6394, 0.7529),
    foreL:  new THREE.Quaternion( 0.3769,  0.0665,  0.1604, 0.9098),
    foreR:  new THREE.Quaternion( 0.3769, -0.0665, -0.1604, 0.9098),
    holdMin: 6, holdMax: 12,
  },
  {
    // Right hand gesturing (explaining), left relaxed — speech only
    name: 'gestureR',
    upperL: new THREE.Quaternion(-0.0189, -0.0141, -0.7562, 0.6540),
    upperR: new THREE.Quaternion( 0.1328,  0.1900,  0.5211, 0.8214),
    foreL:  new THREE.Quaternion( 0.0512,  0.0017,  0.0334, 0.9981),
    foreR:  new THREE.Quaternion( 0.4629, -0.0017, -0.0973, 0.8810),
    holdMin: 3, holdMax: 6, speechOnly: true,
  },
];

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
  /** Base Y rotation in radians — corrects model facing direction. Default: 0 */
  facingRotationY?: number;
  /** Skip procedural hip/spine/neck/head additive motion — for models with full idle animation baked in (e.g. Tripo-generated). Default: false */
  skipProceduralMotion?: boolean;
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

    if (frontness < 0.2) continue; // only front-facing vertices
    const frontFade = Math.max(Math.min((frontness - 0.2) / 0.5, 1), 0);

    // Tight lip band: only vertices within ±6% of head height around mouth
    const lipBandHalf = headH * 0.06;
    const lipTop = mouthY + lipBandHalf;
    const lipBottom = mouthY - lipBandHalf;

    // JAW OPEN: pull lip-band vertices downward (tiny displacement)
    if (y < lipTop && y > lipBottom - lipBandHalf) {
      const downFactor = Math.min(Math.max((lipTop - y) / (lipBandHalf * 2), 0), 1);
      const eased = downFactor * downFactor;
      const disp = eased * frontFade * headH * 0.06; // 6% of head height max
      jawDelta[i * 3 + 1] = -disp;
      if (disp > 0.0001) jawVerts++;
    }

    // MOUTH WIDE: push lip-band vertices apart horizontally
    const yDist = Math.abs(y - mouthY);
    if (yDist < lipBandHalf) {
      const yFade = 1 - yDist / lipBandHalf;
      const lrOff = lrVal - lrCenter;
      const disp = Math.sign(lrOff) * yFade * frontFade * headH * 0.04;
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

  if (process.env.NODE_ENV === 'development') console.log(
    `%c[MORPH] Created mouth morphs: headVerts=${headIdxs.length} jawVerts=${jawVerts} wideVerts=${wideVerts} ` +
    `faceAxis=${faceAxis === 0 ? 'X' : 'Z'}${faceSign > 0 ? '+' : '-'} headH=${headH.toFixed(4)}`,
    'color: #ff69b4; font-weight: bold'
  );
  return true;
}


export function Avatar({ modelUrl, volumeRef, animationState = 'idle', facingRotationY = 0, skipProceduralMotion = false }: AvatarProps) {
  const __DEV__ = process.env.NODE_ENV === 'development';
  const groupRef = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(modelUrl);

  // ============================================================
  // CRITICAL FIX #1: Clone scene with SkeletonUtils
  // useGLTF caches scenes — reusing the same Three.js scene object
  // across React renders corrupts skeleton bindings (bone references
  // get stale, boneInverses don't match). SkeletonUtils.clone()
  // deep-clones the scene WITH proper skeleton re-binding.
  // ============================================================
  const clone = useMemo(() => {
    const c = SkeletonUtils.clone(scene);
    if (__DEV__) console.log('%c[AVATAR] Scene cloned via SkeletonUtils', 'color: #d4af37; font-weight: bold');
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
    const realClips = animations
      .filter(clip => clip.duration > MIN_CLIP_DURATION)
      .map(clip => clip.clone());

    if (realClips.length > 0) {
      const count = repairTrackNames(realClips, boneNames);
      if (__DEV__ && count > 0) console.log(`%c[AVATAR] Repaired ${count} track names`, 'color: #ffa500');

      // Binding diagnostic
      let bound = 0, total = 0;
      for (const clip of realClips) {
        for (const track of clip.tracks) {
          total++;
          const di = track.name.lastIndexOf('.');
          const bn = di >= 0 ? track.name.substring(0, di) : track.name;
          if (clone.getObjectByName(bn)) bound++;
        }
        if (__DEV__) console.log(`  Clip "${clip.name}" dur=${clip.duration.toFixed(2)}s tracks=${clip.tracks.length}`);
      }
      if (__DEV__) console.log(`%c[AVATAR] Track binding: ${bound}/${total} (${total > 0 ? (bound / total * 100).toFixed(0) : 0}%)`,
        bound === total ? 'color: #00ff00; font-weight: bold' : 'color: #ffa500; font-weight: bold');
    }

    // ARM TRACKS: Kept intact — animation drives arms naturally.
    // Previous approach stripped arm tracks and applied static quaternions,
    // but the ARM_POSES quaternions are in Blender space, not GLTF space,
    // causing T-pose. Let the breathing animation handle arm positioning.

    // Track stripping only for demo models — generated models (Tripo pipeline)
    // have properly designed idle animation that should be played as-is.
    if (!skipProceduralMotion) {
      // Strip ALL scale tracks — breathing animation bakes scale on every bone
      // including Head, which causes cheeks to puff/expand unnaturally.
      let scaleStripped = 0;
      for (const clip of realClips) {
        const before = clip.tracks.length;
        clip.tracks = clip.tracks.filter(track => !track.name.endsWith('.scale'));
        scaleStripped += before - clip.tracks.length;
      }
      if (__DEV__ && scaleStripped > 0) {
        console.log(`%c[AVATAR] Stripped ${scaleStripped} scale tracks (prevents face puffing)`,
          'color: #ff6600; font-weight: bold');
      }

      // Strip Head POSITION tracks — breathing animation moves Head bone position
      // slightly, which shifts the face forward/back creating a "cheek breathing" effect.
      // Rotation tracks are kept (handled by additive procedural motion).
      let headPosStripped = 0;
      for (const clip of realClips) {
        const before = clip.tracks.length;
        clip.tracks = clip.tracks.filter(track => {
          const di = track.name.lastIndexOf('.');
          const bn = (di >= 0 ? track.name.substring(0, di) : track.name).toLowerCase();
          const prop = di >= 0 ? track.name.substring(di) : '';
          return !(bn.includes('head') && prop === '.position');
        });
        headPosStripped += before - clip.tracks.length;
      }
      if (__DEV__ && headPosStripped > 0) {
        console.log(`%c[AVATAR] Stripped ${headPosStripped} Head position tracks (prevents cheek breathing)`,
          'color: #ff6600; font-weight: bold');
      }
    } else if (__DEV__) {
      console.log('%c[AVATAR] skipProceduralMotion=true — keeping all animation tracks intact', 'color: #00ccff; font-weight: bold');
    }

    const skipped = animations.length - realClips.length;
    if (__DEV__ && skipped > 0) console.log(`%c[AVATAR] Skipped ${skipped} static clips (<${MIN_CLIP_DURATION}s)`, 'color: #ff8800');

    return { repairedClips: realClips, hasRealAnimation: realClips.length > 0 };
  }, [clone, animations, skipProceduralMotion]);

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

  // Arm bone refs
  const armLRef = useRef<THREE.Bone | null>(null);
  const armRRef = useRef<THREE.Bone | null>(null);
  const forearmLRef = useRef<THREE.Bone | null>(null);
  const forearmRRef = useRef<THREE.Bone | null>(null);

  // Body movement bone refs (additive procedural motion — NO track stripping)
  const spine01Ref = useRef<THREE.Bone | null>(null);
  const spine02Ref = useRef<THREE.Bone | null>(null);
  const hipRef = useRef<THREE.Bone | null>(null);
  const clavLRef = useRef<THREE.Bone | null>(null);
  const clavRRef = useRef<THREE.Bone | null>(null);
  const speechEnergyRef = useRef(0);

  // Mouth cavity: dark sphere behind lips so open mouth shows a dark void
  const cavityRef = useRef<THREE.Mesh | null>(null);

  // Gesture state machine — smooth transitions between natural arm poses
  const gesturePoseRef = useRef(0);           // current pose index in ARM_POSES
  const gestureTargetRef = useRef(0);         // target pose index
  const gestureBlendRef = useRef(1);          // 0→1 slerp progress (1=fully at target)
  const gestureHoldTimerRef = useRef(0);      // time remaining in current pose hold
  const gestureTransDurRef = useRef(1.5);     // transition duration in seconds

  // Arm-down quaternions: bind_pose * Euler(-82°Z for L, +82°Z for R).
  // Verified in Blender: arms hang at sides with natural outward splay, no body clipping.
  const ARM_DOWN_L = useMemo(() => new THREE.Quaternion(-0.0189, -0.0141, -0.7562, 0.6540), []);
  const ARM_DOWN_R = useMemo(() => new THREE.Quaternion(-0.0164, 0.0128, 0.7080, 0.7059), []);
  const FOREARM_REST_L = useMemo(() => new THREE.Quaternion(0.0512, 0.0017, 0.0334, 0.9981), []);
  const FOREARM_REST_R = useMemo(() => new THREE.Quaternion(0.0509, -0.0004, -0.0083, 0.9987), []);

  // Arm freeze: capture first-frame quaternions from animation, then override every frame.
  // The breathing animation oscillates arms ("flapping"). We lock them at the initial pose.
  const armFrozenRef = useRef(false);
  const armFreezeL = useRef(new THREE.Quaternion());
  const armFreezeR = useRef(new THREE.Quaternion());
  const foreFreezeL = useRef(new THREE.Quaternion());
  const foreFreezeR = useRef(new THREE.Quaternion());

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

  // Eye blink state
  const blinkTimerRef = useRef(0);      // countdown to next blink
  const blinkPhaseRef = useRef(0);      // 0=open, >0 = blinking (counts down)
  const nextBlinkRef = useRef(2 + Math.random() * 4); // time until next blink

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
    armFrozenRef.current = false;
    spine01Ref.current = null;
    spine02Ref.current = null;
    hipRef.current = null;
    clavLRef.current = null;
    clavRRef.current = null;
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

      // Body bones for procedural movement (additive only — NO track stripping)
      if (/^(hip|hips)$/i.test(bone.name) && !hipRef.current) hipRef.current = bone;
      if (/^(spine01|spine1|spine)$/i.test(bone.name) && !spine01Ref.current) spine01Ref.current = bone;
      if (/^(spine02|spine2|chest)$/i.test(bone.name) && !spine02Ref.current) spine02Ref.current = bone;
      if (/clavicle/i.test(bone.name) && !lname.includes('arm')) {
        if (isLeft && !clavLRef.current) clavLRef.current = bone;
        if (isRight && !clavRRef.current) clavRRef.current = bone;
      }
    });

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
        if (__DEV__) console.log(`  SkinnedMesh: "${sm.name}" bones=${sm.skeleton?.bones.length ?? 0} bindMode=${sm.bindMode}`);
      }
    });

    // Detect skeleton convention for diagnostics
    const hasMixamo = allBoneNames.some(n => n.startsWith('mixamorig'));
    const hasTripo = allBoneNames.some(n => /^[LR]_/.test(n));
    const hasBlender = allBoneNames.some(n => n.includes('.'));
    const convention = hasMixamo ? 'Mixamo' : hasTripo ? 'Tripo' : hasBlender ? 'Blender' : 'Unknown';

    if (__DEV__) {
      console.log(`%c[AVATAR] ${allBoneNames.length} bones (${convention} skeleton), ${skinnedCount} SkinnedMesh(es)`, 'color: #d4af37; font-weight: bold');
      console.log(`  Head=${headBoneRef.current?.name ?? 'MISS'} Neck=${neckBoneRef.current?.name ?? 'MISS'} Jaw=${jawBoneRef.current?.name ?? 'MISS'}`);
      console.log(`  Arms: L=${armLRef.current?.name ?? 'MISS'} R=${armRRef.current?.name ?? 'MISS'} ForeL=${forearmLRef.current?.name ?? 'MISS'} ForeR=${forearmRRef.current?.name ?? 'MISS'}`);
      console.log(`  Spine: hip=${hipRef.current?.name ?? 'MISS'} s1=${spine01Ref.current?.name ?? 'MISS'} s2=${spine02Ref.current?.name ?? 'MISS'} clavL=${clavLRef.current?.name ?? 'MISS'} clavR=${clavRRef.current?.name ?? 'MISS'}`);
      console.log(`  MouthRig=${hasFullMouthRigRef.current ? 'FULL' : 'NONE (morph target fallback)'}`);
      console.log(`  All bones: ${allBoneNames.join(', ')}`);
    }

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
          if (__DEV__) console.log('%c[AVATAR] Using built-in GLB morph targets: jawOpen=%d mouthWide=%d',
            'color: #00ff00; font-weight: bold', dict['jawOpen'], dict['mouthWide']);
        } else {
          // Fallback: create programmatic morph targets from vertex analysis
          hasMorphMouthRef.current = createMouthMorphTargets(targetMesh);
          if (hasMorphMouthRef.current) {
            morphMeshRef.current = targetMesh;
            if (__DEV__) console.log('%c[AVATAR] Using programmatic morph targets (fallback)', 'color: #ffa500; font-weight: bold');
          }
        }

        // DoubleSide prevents seeing HDR environment through mesh backfaces.
        // The teal lips are the character's design (teal lipstick) — we keep them.
        // Mouth opening is capped at a very low jawOpen value (~0.05) in the
        // per-frame morph target section so the interior barely shows.
        if (hasMorphMouthRef.current) {
          const mats = Array.isArray(targetMesh.material) ? targetMesh.material : [targetMesh.material];
          mats.forEach(m => {
            (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
          });
          if (__DEV__) console.log('%c[AVATAR] DoubleSide applied to mesh material', 'color: #ff69b4; font-weight: bold');
        }
      }
    }

    // ============================================================
    // FINGER BONE COLLECTION — for per-frame natural curl
    // Collect all finger bones from hand bones, store rest quaternions
    // and determine curl parameters by depth in the finger chain.
    // NOTE: WOW model has no individual finger bones (L_Hand/R_Hand are leaf nodes).
    // Finger curl is handled by the 'relaxedHands' morph target / shape key instead.
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
      if (__DEV__) console.log(`%c[AVATAR] Playing: "${idleClip.name}" via drei actions`, 'color: #00ff00; font-weight: bold');
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
      if (hasRealAnimation) {
        // Real animation drives body movement — add breathing + visible lateral drift
        const breathY = Math.sin(t * 1.8) * 0.003;
        const lateralX = Math.sin(t * 0.35) * 0.004;  // visible weight shift
        groupRef.current.position.y = -1 + breathY;
        groupRef.current.position.x = lateralX;
        groupRef.current.rotation.x = 0;
        groupRef.current.rotation.y = facingRotationY;
      } else {
        // No animation clip — move the whole group for life-like sway
        const amp = 2.5;
        const breathY = Math.sin(t * 1.8) * 0.015 * amp;
        const swayX = Math.sin(t * 0.6) * 0.012 * amp;
        const lookY = Math.sin(t * 0.35) * 0.04 * amp;
        const lateralX = Math.sin(t * 0.45) * 0.008 * amp;

        groupRef.current.position.y = -1 + breathY;
        groupRef.current.position.x = lateralX;
        groupRef.current.rotation.x = swayX;
        groupRef.current.rotation.y = facingRotationY + lookY;
      }
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

    // Speech energy: 0=silent, 1=actively speaking. Fast attack, slow decay.
    const rawEnergy = Math.min(vol * 3, 1);
    const eAlpha = rawEnergy > speechEnergyRef.current ? 0.15 : 0.04;
    speechEnergyRef.current += (rawEnergy - speechEnergyRef.current) * eAlpha;
    const energy = speechEnergyRef.current;

    // =======================================
    // ARM FREEZE — lock arms at initial animation pose
    // The breathing animation oscillates arm bones up/down ("flapping").
    // We capture the first-frame quaternions (which are in correct GLTF space
    // from the animation) and override every frame to keep arms static.
    // This runs AFTER mixer.update(), so our values win.
    // Skipped for generated models — their baked idle animation handles arms properly.
    // =======================================
    const dt = 1 / 60; // approximate frame delta (still used by hip/spine)
    if (!skipProceduralMotion) {
      if (!armFrozenRef.current && armLRef.current) {
        // Capture whatever the animation set on the first frame — these are
        // the correct arms-down quaternions in GLTF space.
        armFreezeL.current.copy(armLRef.current.quaternion);
        if (armRRef.current) armFreezeR.current.copy(armRRef.current.quaternion);
        if (forearmLRef.current) foreFreezeL.current.copy(forearmLRef.current.quaternion);
        if (forearmRRef.current) foreFreezeR.current.copy(forearmRRef.current.quaternion);
        armFrozenRef.current = true;
        if (__DEV__) console.log('%c[AVATAR] Captured arm freeze quaternions from animation frame 0', 'color: #00ffaa; font-weight: bold');
      }
      if (armFrozenRef.current) {
        if (armLRef.current) armLRef.current.quaternion.copy(armFreezeL.current);
        if (armRRef.current) armRRef.current.quaternion.copy(armFreezeR.current);
        if (forearmLRef.current) forearmLRef.current.quaternion.copy(foreFreezeL.current);
        if (forearmRRef.current) forearmRRef.current.quaternion.copy(foreFreezeR.current);
      }
    }

    // =======================================
    // PROCEDURAL ADDITIVE MOTION — hip sway, spine, neck, head
    // Skipped for models with full idle animation baked in (Tripo-generated)
    // to avoid doubling the motion and causing visual distortion.
    // =======================================
    if (!skipProceduralMotion) {
      // HIP SWAY — natural weight shifting (additive on top of mixer)
      if (hipRef.current) {
        const swayY = Math.sin(t * 0.3) * 0.012
                     + Math.sin(t * 0.7) * 0.004;
        const tiltX = Math.sin(t * 0.4) * 0.008;
        const hipTwist = Math.sin(t * 0.2) * 0.006;
        _e.set(tiltX, swayY, hipTwist);
        hipRef.current.quaternion.multiply(_q.setFromEuler(_e));
      }

      // SPINE — counter-rotation to complement hip sway
      if (spine01Ref.current) {
        const counterZ = -Math.sin(t * 0.3) * 0.005;
        const leanX = Math.sin(t * 0.5) * 0.005;
        _e.set(leanX, 0, counterZ);
        spine01Ref.current.quaternion.multiply(_q.setFromEuler(_e));
      }
      if (spine02Ref.current) {
        const turnY = Math.sin(t * 0.25) * 0.006;
        const leanZ = Math.sin(t * 0.55) * 0.004;
        _e.set(0, turnY, leanZ);
        spine02Ref.current.quaternion.multiply(_q.setFromEuler(_e));
      }

      // HEAD/NECK — subtle, always active, scales with speech
      if (neckBoneRef.current) {
        const neckY = Math.sin(t * 0.5) * (0.012 + energy * 0.02);
        const neckX = Math.sin(t * 0.7) * (0.006 + energy * 0.01);
        _e.set(neckX, neckY, 0);
        neckBoneRef.current.quaternion.multiply(_q.setFromEuler(_e));
      }
      if (headBoneRef.current) {
        const headZ = Math.sin(t * 0.6) * (0.010 + energy * 0.018);
        const headX = Math.sin(t * 1.0) * (0.005 + energy * 0.008);
        const headY = Math.sin(t * 0.35) * (0.006 + energy * 0.005);
        _e.set(headX, headY, headZ);
        headBoneRef.current.quaternion.multiply(_q.setFromEuler(_e));
      }
    }

    // SHOULDERS — disabled. Clavicle rotation cascades to entire arm chain,
    // causing disproportionate visual movement. Arms get their motion from
    // the gesture pose system instead.

    // =======================================
    // DIAGNOSTIC LOGGING (dev only, first few frames)
    // =======================================
    if (process.env.NODE_ENV === 'development' && diagFrameRef.current <= 20 && diagFrameRef.current % 10 === 1) {
      const la = armLRef.current;
      const laQ = la ? `z=${la.quaternion.z.toFixed(3)} w=${la.quaternion.w.toFixed(3)}` : 'null';
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

    // (Speech head gestures now handled in the unified HEAD/NECK block above)

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

      // relaxedHands morph target: dynamic finger curl based on current arm pose.
      // NEGATIVE influence = fingers curl INWARD (toward palm). The shape key delta
      // points upward in bind space (dZ=+0.058), but when arms are rotated down the
      // positive direction maps to fingers curving backward (away from palm).
      // Negating the influence reverses the delta → natural inward curl.
      // Hip poses → tighter curl (-0.65), others → light curl (-0.15).
      const relaxedIdx = dict['relaxedHands'];
      if (relaxedIdx !== undefined) {
        const currentPose = ARM_POSES[gestureTargetRef.current];
        const isHipPose = currentPose?.name === 'hipL' || currentPose?.name === 'hipR' || currentPose?.name === 'hipBoth';
        const isFolded = currentPose?.name === 'armsFolded';
        const targetRelaxed = isHipPose ? -0.65 : isFolded ? -0.45 : -0.15;
        infl[relaxedIdx] = THREE.MathUtils.lerp(infl[relaxedIdx], targetRelaxed, 0.06);
      }

      // ---- Random eye blinks ----
      const eyesIdx = dict['eyesClosed'];
      if (eyesIdx !== undefined) {
        blinkTimerRef.current += 1 / 60; // ~60fps
        if (blinkPhaseRef.current > 0) {
          // Currently blinking: quick close then open (total ~0.15s)
          blinkPhaseRef.current -= 1 / 60;
          const halfBlink = 0.075; // half of blink duration
          const remaining = blinkPhaseRef.current;
          const blinkDuration = 0.15;
          const elapsed = blinkDuration - remaining;
          // Triangle wave: 0→1→0 over blink duration
          const blinkVal = elapsed < halfBlink
            ? elapsed / halfBlink
            : remaining / halfBlink;
          infl[eyesIdx] = Math.max(0, Math.min(1, blinkVal));
          if (blinkPhaseRef.current <= 0) {
            blinkPhaseRef.current = 0;
            infl[eyesIdx] = 0;
            // Schedule next blink: 2-6 seconds, occasionally a double-blink
            nextBlinkRef.current = 2 + Math.random() * 4;
            blinkTimerRef.current = 0;
          }
        } else {
          infl[eyesIdx] = 0;
          if (blinkTimerRef.current >= nextBlinkRef.current) {
            // Start a blink
            blinkPhaseRef.current = 0.15;
            blinkTimerRef.current = 0;
            // 20% chance of double-blink (quick follow-up)
            if (Math.random() < 0.2) {
              nextBlinkRef.current = 0.3; // blink again quickly
            }
          }
        }
      }

      if (vol > 0.02) {
        // Speaking: lip movement for natural speech animation.
        // Verified in Blender: jawOpen 0.03 = slight lip part,
        // 0.10 = clearly open, 0.30 = screaming. Cap at 0.15 for speech.
        const jawBase = Math.pow(jaw, 0.85) * 0.14;
        const jawFlutter = Math.sin(t * 6.2) * 0.006 + Math.sin(t * 9.4) * 0.004
          + Math.sin(t * 14.1) * 0.002; // high-freq for consonant feel
        const jawTarget = Math.min(0.15, jawBase + jawFlutter);
        const wideTarget = Math.min(0.03, Math.pow(width, 0.8) * 0.025);
        infl[jawIdx] = THREE.MathUtils.lerp(infl[jawIdx], Math.max(0, jawTarget), 0.30);
        infl[wideIdx] = THREE.MathUtils.lerp(infl[wideIdx], Math.max(0, wideTarget), 0.25);
      } else {
        // Idle: mouth fully closed
        infl[jawIdx] = THREE.MathUtils.lerp(infl[jawIdx], 0, 0.08);
        infl[wideIdx] = THREE.MathUtils.lerp(infl[wideIdx], 0, 0.08);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={clone} dispose={null} />
    </group>
  );
}
