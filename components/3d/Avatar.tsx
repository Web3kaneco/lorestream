'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

export type AnimationState = 'idle' | 'speaking' | 'thinking' | 'greeting';

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

export function Avatar({ modelUrl, volumeRef, animationState = 'idle' }: AvatarProps) {
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
    const realClips = animations
      .filter(clip => clip.duration > MIN_CLIP_DURATION)
      .map(clip => clip.clone());

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
  }, [clone, animations]);

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

  // Pre-computed arm relaxation quaternions (rotate arms down from T-pose)
  const armFixL = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.85), []);
  const armFixR = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.85), []);
  const forearmFixL = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3), []);
  const forearmFixR = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.3), []);

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

  // Synthetic mouth (for models without jaw/lip bones)
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const mouthGeo = useMemo(() => { const g = new THREE.SphereGeometry(1, 16, 8); g.scale(1.5, 0.6, 0.5); return g; }, []);
  const mouthMat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x1a0a0a, transparent: true, opacity: 0.85, depthWrite: false }), []);

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

    // SkinnedMesh diagnostics
    let skinnedCount = 0;
    clone.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
        const sm = child as THREE.SkinnedMesh;
        skinnedCount++;
        console.log(`  SkinnedMesh: "${sm.name}" bones=${sm.skeleton?.bones.length ?? 0} bindMode=${sm.bindMode}`);
      }
    });

    console.log(`%c[AVATAR] ${allBoneNames.length} bones, ${skinnedCount} SkinnedMesh(es)`, 'color: #d4af37; font-weight: bold');
    console.log(`  Head=${headBoneRef.current?.name ?? 'MISS'} Neck=${neckBoneRef.current?.name ?? 'MISS'} Jaw=${jawBoneRef.current?.name ?? 'MISS'}`);
    console.log(`  Arms: L=${armLRef.current?.name ?? 'MISS'} R=${armRRef.current?.name ?? 'MISS'} ForeL=${forearmLRef.current?.name ?? 'MISS'} ForeR=${forearmRRef.current?.name ?? 'MISS'}`);
    console.log(`  MouthRig=${hasFullMouthRigRef.current ? 'FULL' : 'NONE'}`);
    console.log(`  All bones: ${allBoneNames.join(', ')}`);
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
  // EFFECT 4: Synthetic mouth (fallback for models without jaw/lip)
  // ============================================================
  useEffect(() => {
    if (mouthMeshRef.current) { mouthMeshRef.current.removeFromParent(); mouthMeshRef.current = null; }
    if (hasFullMouthRigRef.current || !headBoneRef.current) return;

    const ws = new THREE.Vector3();
    headBoneRef.current.getWorldScale(ws);
    const avgS = (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3;
    const sz = Math.max(avgS * 0.04, 0.008);

    const m = new THREE.Mesh(mouthGeo, mouthMat);
    m.name = 'SyntheticMouth';
    m.scale.set(sz, sz * 0.1, sz);
    m.position.set(0, -avgS * 0.04, avgS * 0.07);
    m.renderOrder = 1;

    headBoneRef.current.add(m);
    mouthMeshRef.current = m;

    return () => {
      if (mouthMeshRef.current) { mouthMeshRef.current.removeFromParent(); mouthMeshRef.current = null; }
    };
  }, [clone, mouthGeo, mouthMat]);

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
    // T-POSE ARM FIX — applied AFTER mixer so we override
    // =======================================
    if (armLRef.current && armLRestQ.current) {
      armLRef.current.quaternion.copy(armLRestQ.current).multiply(armFixL);
    }
    if (armRRef.current && armRRestQ.current) {
      armRRef.current.quaternion.copy(armRRestQ.current).multiply(armFixR);
    }
    if (forearmLRef.current && forearmLRestQ.current) {
      forearmLRef.current.quaternion.copy(forearmLRestQ.current).multiply(forearmFixL);
    }
    if (forearmRRef.current && forearmRRestQ.current) {
      forearmRRef.current.quaternion.copy(forearmRRestQ.current).multiply(forearmFixR);
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
      // Check skeleton state on first diagnostic
      if (diagFrameRef.current === 1) {
        clone.traverse(c => {
          if ((c as THREE.SkinnedMesh).isSkinnedMesh) {
            const sm = c as THREE.SkinnedMesh;
            const skel = sm.skeleton;
            console.log(`%c[AVATAR] Runtime: boneTexture=${!!skel?.boneTexture} bones=${skel?.bones.length}`,
              'color: #00ff00; font-weight: bold');
          }
        });
      }
      console.log(`[AVATAR] f=${diagFrameRef.current} vol=${vol.toFixed(3)} jaw=${smoothJawRef.current.toFixed(3)} armL.q(${laQ})`);
    }

    // =======================================
    // FREQUENCY-DRIVEN LIP SYNC
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

    // Synthetic mouth overlay (for models without mouth bones)
    if (mouthMeshRef.current && !hasFullMouthRigRef.current) {
      const base = mouthMeshRef.current.userData.baseSize || mouthMeshRef.current.scale.x;
      if (!mouthMeshRef.current.userData.baseSize) mouthMeshRef.current.userData.baseSize = base;

      if (vol > 0.02) {
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, base * (0.15 + jaw * 2.0), 0.5);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, base * (0.7 + width * 0.8 + jaw * 0.2), 0.4);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, base * (0.7 + jaw * 0.5 - width * 0.15), 0.35);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.92, 0.3);
      } else {
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, base * 0.05, 0.08);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, base * 0.7, 0.08);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, base, 0.08);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.5, 0.04);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={clone} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}
