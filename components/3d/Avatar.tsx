'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

// ARM POSE STRATEGY (in priority order):
// 1. If the loaded model has its own animation (from animate_retarget or Mixamo),
//    extract arm quaternions from frame 0 — no shoulder compensation needed
//    since the animation was made for THIS model's exact skeleton.
// 2. Fallback: use idlebreathing.glb as a reference, with shoulder-compensated
//    quaternion math to account for different skeleton proportions.

export type AnimationState = 'idle' | 'speaking' | 'thinking' | 'greeting';

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
}

// Bones we care about for arm pose extraction.
const ARM_BONE_NAMES = new Set([
  'mixamorigLeftArm', 'mixamorigRightArm',
  'mixamorigLeftForeArm', 'mixamorigRightForeArm',
]);
const SHOULDER_BONE_NAMES = new Set([
  'mixamorigLeftShoulder', 'mixamorigRightShoulder',
]);
const ALL_POSE_BONES = new Set(
  (Array.from(ARM_BONE_NAMES) as string[]).concat(Array.from(SHOULDER_BONE_NAMES))
);

// Fallback blend factors (module-scope to avoid per-frame allocation)
const FALLBACK_ARM_BLEND = 0.15;
const FALLBACK_FOREARM_BLEND = 0.10;

// Animation clip name → state mapping keywords
const CLIP_STATE_KEYWORDS: Record<AnimationState, string[]> = {
  idle: ['idle', 'breathing', 'standing', 'rest'],
  speaking: ['talk', 'speak', 'gesture', 'conversation', 'explain'],
  thinking: ['think', 'look', 'scratch', 'weight', 'shift', 'wonder'],
  greeting: ['wave', 'greet', 'salute', 'nod', 'hello', 'welcome'],
};

// Crossfade duration in seconds
const CROSSFADE_DURATION = 0.4;

/**
 * Categorize animation clips by matching clip names to AnimationState keywords.
 * Falls back to first clip for any unmatched state.
 */
function categorizeClips(clips: THREE.AnimationClip[]): Map<AnimationState, THREE.AnimationClip> {
  const map = new Map<AnimationState, THREE.AnimationClip>();
  if (clips.length === 0) return map;

  // Try to match each state to a clip
  for (const [state, keywords] of Object.entries(CLIP_STATE_KEYWORDS) as [AnimationState, string[]][]) {
    for (const clip of clips) {
      const clipNameLower = clip.name.toLowerCase();
      if (keywords.some(kw => clipNameLower.includes(kw))) {
        map.set(state, clip);
        break;
      }
    }
  }

  // Fill any missing states with the first clip as fallback
  const fallback = clips[0];
  const allStates: AnimationState[] = ['idle', 'speaking', 'thinking', 'greeting'];
  for (const state of allStates) {
    if (!map.has(state)) {
      map.set(state, fallback);
    }
  }

  return map;
}

export function Avatar({ modelUrl, volumeRef, animationState = 'idle' }: AvatarProps) {
  // Load the model (rigged with Mixamo skeleton)
  // IMPORTANT: animations live on the gltf root, NOT on scene.animations
  const { scene, animations: modelAnimations } = useGLTF(modelUrl);

  // Load the idle breathing animation as a REFERENCE for arm pose quaternions.
  // We do NOT play this animation — we only read frame-0 quaternions for arm bones.
  const idleGltf = useGLTF('/idlebreathing.glb');

  const groupRef = useRef<THREE.Group>(null!);

  // Bone refs (for breathing, head, neck)
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const rootBoneRef = useRef<THREE.Bone | null>(null);
  const jawBoneRef = useRef<THREE.Bone | null>(null);

  // Full mouth rig: lip bone refs (from Blender add_mouth_rig.py)
  const lipTopRef = useRef<THREE.Bone | null>(null);
  const lipBottomRef = useRef<THREE.Bone | null>(null);
  const lipTopLRef = useRef<THREE.Bone | null>(null);
  const lipTopRRef = useRef<THREE.Bone | null>(null);
  const lipBottomLRef = useRef<THREE.Bone | null>(null);
  const lipBottomRRef = useRef<THREE.Bone | null>(null);
  const lipsLRef = useRef<THREE.Bone | null>(null);
  const lipsRRef = useRef<THREE.Bone | null>(null);
  const hasFullMouthRigRef = useRef(false);

  // Raw reference quaternions extracted from idlebreathing.glb (shoulders + arms + forearms)
  const armPoseRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  // T-pose quaternions captured on first render frame
  const armInitRef = useRef<Map<string, THREE.Quaternion> | null>(null);
  // Final target quaternions for arm/forearm bones (computed once on first frame)
  const armTargetRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  const targetComputedRef = useRef(false);
  // True if the model came with its own animation; false = using external reference
  const usingOwnAnimRef = useRef(false);

  // Synthetic mouth overlay (only used when no full mouth rig)
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);

  // Smoothed viseme channels (asymmetric EMA — fast attack, slow release)
  const smoothJawRef = useRef(0);
  const smoothWidthRef = useRef(0);
  const smoothVolRef = useRef(0);

  // Track the arm pose slerp progress (for smooth transition out of T-pose)
  const armLerpRef = useRef(0);

  // Original root bone Y position (for additive breathing bob)
  const rootOrigYRef = useRef<number | null>(null);

  // Base rotations for head/neck (captured on first frame, used as anchors)
  const headBaseRotRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const neckBaseRotRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // Base rotations for lip bones (captured on first frame)
  const lipsLBaseRotRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const lipsRBaseRotRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // AnimationMixer + clip management
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const hasRetargetAnimRef = useRef(false);
  const clipMapRef = useRef<Map<AnimationState, THREE.AnimationClip>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const currentAnimStateRef = useRef<AnimationState>('idle');

  // Mouth geometry — created once (for synthetic fallback only)
  const mouthGeo = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 16, 8);
    geo.scale(1.5, 0.6, 0.5);
    return geo;
  }, []);

  const mouthMat = useMemo(() => {
    return new THREE.MeshBasicMaterial({
      color: 0x1a0a0a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
  }, []);

  // =========================================================
  // EFFECT 1: Scan the model's skeleton for bones
  // Detects both Tripo and Mixamo naming conventions, plus
  // exact-match mouth bones from Blender add_mouth_rig.py
  // =========================================================
  useEffect(() => {
    headBoneRef.current = null;
    neckBoneRef.current = null;
    spineBoneRef.current = null;
    rootBoneRef.current = null;
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

    console.log('--- Skeleton Bone Scan ---');

    // Exact-name lookup for Blender mouth rig bones (from add_mouth_rig.py)
    const mouthBoneMap: Record<string, React.MutableRefObject<THREE.Bone | null>> = {
      'lip.T': lipTopRef,
      'lip.B': lipBottomRef,
      'lip.T.L': lipTopLRef,
      'lip.T.R': lipTopRRef,
      'lip.B.L': lipBottomLRef,
      'lip.B.R': lipBottomRRef,
      'lips.L': lipsLRef,
      'lips.R': lipsRRef,
    };

    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();
        console.log('  Bone:', child.name);

        if (name.includes('head') && !name.includes('headtop') && !name.includes('head_end')) {
          if (!headBoneRef.current) headBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('neck') && !name.includes('necklace')) {
          if (!neckBoneRef.current) neckBoneRef.current = child as THREE.Bone;
        }
        if (name === 'jaw' || name.includes('jaw') || name.includes('chin') || name.includes('mandible')) {
          if (!jawBoneRef.current) {
            jawBoneRef.current = child as THREE.Bone;
            console.log('  -> Native jaw bone found:', child.name);
          }
        }
        // Fuzzy lip bone detection (for models not rigged by our scripts)
        if ((name.includes('lips') || name.includes('lip')) && !name.includes('headtop')) {
          if (name.includes('.l') || name.includes('_l') || name.includes('left')) {
            if (!lipsLRef.current) {
              lipsLRef.current = child as THREE.Bone;
              console.log('  -> Lips.L bone found (fuzzy):', child.name);
            }
          }
          if (name.includes('.r') || name.includes('_r') || name.includes('right')) {
            if (!lipsRRef.current) {
              lipsRRef.current = child as THREE.Bone;
              console.log('  -> Lips.R bone found (fuzzy):', child.name);
            }
          }
        }
        if (name.includes('spine') || name.includes('chest') || name === 'waist') {
          if (!spineBoneRef.current) spineBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('hips') || name.includes('pelvis') || name === 'hip' || name === 'root') {
          if (!rootBoneRef.current) rootBoneRef.current = child as THREE.Bone;
        }

        // Exact match for Blender mouth rig bones (overrides fuzzy matches)
        const mouthRef = mouthBoneMap[child.name];
        if (mouthRef) {
          mouthRef.current = child as THREE.Bone;
          console.log('  -> Mouth bone found (exact):', child.name);
        }
      }
    });

    // Determine if we have a full mouth rig (jaw + both lip corners at minimum)
    hasFullMouthRigRef.current = !!(jawBoneRef.current && lipsLRef.current && lipsRRef.current);

    console.log('--- Bone Mapping Result ---');
    console.log('  Head:', headBoneRef.current?.name ?? 'MISSING');
    console.log('  Neck:', neckBoneRef.current?.name ?? 'MISSING');
    console.log('  Jaw:', jawBoneRef.current?.name ?? 'MISSING');
    console.log('  Lips.L:', lipsLRef.current?.name ?? 'MISSING');
    console.log('  Lips.R:', lipsRRef.current?.name ?? 'MISSING');
    console.log('  lip.T:', lipTopRef.current?.name ?? '-');
    console.log('  lip.B:', lipBottomRef.current?.name ?? '-');
    console.log('  Spine:', spineBoneRef.current?.name ?? 'MISSING');
    console.log('  Root:', rootBoneRef.current?.name ?? 'MISSING');
    console.log('  Full Mouth Rig:', hasFullMouthRigRef.current ? 'YES — native lip animation' : 'NO — will use synthetic mouth');
  }, [scene]);

  // =========================================================
  // EFFECT 2: Set up animations (AnimationMixer + clip map)
  // Supports multi-clip models with categorization & crossfade
  // =========================================================
  useEffect(() => {
    // Reset animation state
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current.uncacheRoot(scene);
      mixerRef.current = null;
    }
    hasRetargetAnimRef.current = false;
    currentActionRef.current = null;
    currentAnimStateRef.current = 'idle';
    clipMapRef.current = new Map();
    armPoseRef.current = new Map();
    armInitRef.current = null;
    armTargetRef.current = new Map();
    targetComputedRef.current = false;
    armLerpRef.current = 0;
    rootOrigYRef.current = null;

    console.log(`--- Animation Detection ---`);
    console.log(`  modelAnimations: ${modelAnimations ? modelAnimations.length : 'null/undefined'} clips`);

    if (modelAnimations && modelAnimations.length > 0) {
      // Log all available clips
      for (const clip of modelAnimations) {
        console.log(`  Clip: "${clip.name}" (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
      }

      const mixer = new THREE.AnimationMixer(scene);
      mixerRef.current = mixer;
      hasRetargetAnimRef.current = true;

      // Categorize clips by name → AnimationState
      const clipMap = categorizeClips(modelAnimations);
      clipMapRef.current = clipMap;

      console.log(`  Clip map:`);
      clipMap.forEach((clip, state) => {
        console.log(`    ${state} → "${clip.name}"`);
      });

      // Start with idle clip
      const idleClip = clipMap.get('idle') || modelAnimations[0];
      const action = mixer.clipAction(idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      currentActionRef.current = action;
      currentAnimStateRef.current = 'idle';

      console.log(`  AnimationMixer playing — starting with "${idleClip.name}"`);
    } else {
      console.log(`  No animations — using fallback reference for arms`);

      const poseMap = new Map<string, THREE.Quaternion>();
      if (idleGltf.animations.length > 0) {
        const refClip = idleGltf.animations[0];
        for (const track of refClip.tracks) {
          const dotMatch = track.name.match(/^(.+)\.(\w+)$/);
          if (!dotMatch) continue;
          const boneName = dotMatch[1];
          const property = dotMatch[2];
          if (property === 'quaternion' && ALL_POSE_BONES.has(boneName)) {
            poseMap.set(boneName, new THREE.Quaternion(
              track.values[0], track.values[1], track.values[2], track.values[3]
            ));
          }
        }
        console.log(`  Extracted ${poseMap.size} arm/shoulder bones from reference`);
      }
      armPoseRef.current = poseMap;
    }

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current.uncacheRoot(scene);
        mixerRef.current = null;
      }
    };
  }, [scene, modelAnimations, idleGltf]);

  // =========================================================
  // EFFECT 3: Handle animationState changes — crossfade clips
  // Only fires when animationState prop changes from parent
  // =========================================================
  useEffect(() => {
    if (!mixerRef.current || clipMapRef.current.size === 0) return;
    if (animationState === currentAnimStateRef.current) return;

    const targetClip = clipMapRef.current.get(animationState);
    if (!targetClip) return;

    const mixer = mixerRef.current;
    const prevAction = currentActionRef.current;
    const nextAction = mixer.clipAction(targetClip);

    // Configure loop: greeting plays once then we auto-return to idle
    if (animationState === 'greeting') {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Infinity);
    }

    // Crossfade from current to next
    nextAction.reset();
    if (prevAction) {
      nextAction.crossFadeFrom(prevAction, CROSSFADE_DURATION, true);
    }
    nextAction.play();

    currentActionRef.current = nextAction;
    currentAnimStateRef.current = animationState;

    console.log(`  Animation crossfade: → ${animationState} ("${targetClip.name}")`);

    // For greeting: auto-return to idle after clip finishes
    if (animationState === 'greeting') {
      const onFinished = (e: { action: THREE.AnimationAction }) => {
        if (e.action === nextAction) {
          mixer.removeEventListener('finished', onFinished);
          // Crossfade back to idle
          const idleClip = clipMapRef.current.get('idle');
          if (idleClip) {
            const idleAction = mixer.clipAction(idleClip);
            idleAction.reset();
            idleAction.setLoop(THREE.LoopRepeat, Infinity);
            idleAction.crossFadeFrom(nextAction, CROSSFADE_DURATION, true);
            idleAction.play();
            currentActionRef.current = idleAction;
            currentAnimStateRef.current = 'idle';
          }
        }
      };
      mixer.addEventListener('finished', onFinished);
    }
  }, [animationState]);

  // =========================================================
  // EFFECT 4: Create synthetic mouth overlay (ONLY for models without full mouth rig)
  // =========================================================
  useEffect(() => {
    if (mouthMeshRef.current) {
      mouthMeshRef.current.removeFromParent();
      mouthMeshRef.current = null;
    }

    // Full mouth rig detected — skip synthetic mouth entirely
    if (hasFullMouthRigRef.current) {
      console.log('  Full mouth rig active — skipping synthetic mouth');
      return;
    }

    if (!headBoneRef.current) return;

    const headWorldScale = new THREE.Vector3();
    headBoneRef.current.getWorldScale(headWorldScale);
    const avgScale = (Math.abs(headWorldScale.x) + Math.abs(headWorldScale.y) + Math.abs(headWorldScale.z)) / 3;

    const mouthSize = Math.max(avgScale * 0.04, 0.008);
    const mouthOffsetY = -avgScale * 0.04;
    const mouthOffsetZ = avgScale * 0.07;

    console.log(`  Mouth calibration: scale=${avgScale.toFixed(4)}, size=${mouthSize.toFixed(4)}`);

    const mouthMesh = new THREE.Mesh(mouthGeo, mouthMat);
    mouthMesh.name = 'SyntheticMouth';
    mouthMesh.scale.set(mouthSize, mouthSize * 0.1, mouthSize);
    mouthMesh.position.set(0, mouthOffsetY, mouthOffsetZ);
    mouthMesh.renderOrder = 1;

    headBoneRef.current.add(mouthMesh);
    mouthMeshRef.current = mouthMesh;
    console.log('  Synthetic mouth attached to head bone');

    return () => {
      if (mouthMeshRef.current) {
        mouthMeshRef.current.removeFromParent();
        mouthMeshRef.current = null;
      }
      mouthGeo.dispose();
      mouthMat.dispose();
    };
  }, [scene, mouthGeo, mouthMat]);

  useFrame(({ clock }, delta) => {
    // Early exit if nothing to animate
    if (!headBoneRef.current && !neckBoneRef.current && !mixerRef.current && !spineBoneRef.current) return;

    const t = clock.getElapsedTime();

    // =======================================================
    // LAYER 1: AnimationMixer (retarget body animation)
    // Plays the active animation clip — body sway, arms, etc.
    // Must happen FIRST so subsequent layers can override.
    // =======================================================
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // =======================================================
    // LAYER 2: Fallback arm pose (ONLY when no retarget anim)
    // Gently nudges arms from T-pose using idlebreathing.glb.
    // When the mixer is playing, it handles arms — skip this.
    // =======================================================
    if (!hasRetargetAnimRef.current) {
      // Capture T-pose quaternions on first frame
      if (armPoseRef.current.size > 0 && !targetComputedRef.current) {
        const initMap = new Map<string, THREE.Quaternion>();
        armPoseRef.current.forEach((_, boneName) => {
          const bone = scene.getObjectByName(boneName) as THREE.Bone | undefined;
          if (bone) initMap.set(boneName, bone.quaternion.clone());
        });
        if (initMap.size > 0) {
          armInitRef.current = initMap;
          const armOnly = new Map<string, THREE.Quaternion>();
          armPoseRef.current.forEach((q, name) => {
            if (ARM_BONE_NAMES.has(name)) armOnly.set(name, q);
          });
          armTargetRef.current = armOnly;
          targetComputedRef.current = true;
        }
      }

      // Slerp arm bones from T-pose to targets
      if (armTargetRef.current.size > 0 && armInitRef.current) {
        armLerpRef.current = Math.min(armLerpRef.current + delta * 1.5, 1);
        const armT = 1 - Math.pow(1 - armLerpRef.current, 3);
        armTargetRef.current.forEach((targetQ, boneName) => {
          const bone = scene.getObjectByName(boneName) as THREE.Bone | undefined;
          const initQ = armInitRef.current!.get(boneName);
          if (bone && initQ) {
            const blend = boneName.includes('ForeArm') ? FALLBACK_FOREARM_BLEND : FALLBACK_ARM_BLEND;
            bone.quaternion.copy(initQ).slerp(targetQ, armT * blend);
          }
        });
      }
    }

    // =======================================================
    // LAYER 3: Breathing + root bob
    // Spine breathing always runs (retarget doesn't touch spine).
    // Root bob only when no retarget (retarget handles root).
    // =======================================================
    if (spineBoneRef.current) {
      const breathScale = 1 + Math.sin(t * 2) * 0.008;
      spineBoneRef.current.scale.set(1, breathScale, 1);
    }
    if (!hasRetargetAnimRef.current && rootBoneRef.current) {
      if (rootOrigYRef.current === null) {
        rootOrigYRef.current = rootBoneRef.current.position.y;
      }
      rootBoneRef.current.position.y = rootOrigYRef.current + Math.sin(t * 2) * 0.005;
    }

    // --- Capture base rotations on first frame (anchor for all oscillation) ---
    if (neckBoneRef.current && neckBaseRotRef.current === null) {
      neckBaseRotRef.current = {
        x: neckBoneRef.current.rotation.x,
        y: neckBoneRef.current.rotation.y,
        z: neckBoneRef.current.rotation.z,
      };
    }
    if (headBoneRef.current && headBaseRotRef.current === null) {
      headBaseRotRef.current = {
        x: headBoneRef.current.rotation.x,
        y: headBoneRef.current.rotation.y,
        z: headBoneRef.current.rotation.z,
      };
    }

    // --- Neck subtle sway (absolute from base — no drift) ---
    if (neckBoneRef.current && neckBaseRotRef.current) {
      neckBoneRef.current.rotation.y = neckBaseRotRef.current.y + Math.sin(t * 0.8) * 0.015;
    }

    // --- Head idle movement (absolute from base — no drift) ---
    if (headBoneRef.current && headBaseRotRef.current) {
      headBoneRef.current.rotation.z = headBaseRotRef.current.z + Math.sin(t * 1.2) * 0.008;
      headBoneRef.current.rotation.x = headBaseRotRef.current.x + Math.sin(t * 0.7) * 0.005;
    }

    // =====================================================
    // FREQUENCY-DRIVEN LIP SYNC
    // jawOpen  → vertical mouth opening (vowels, voiced sounds)
    // mouthWidth → horizontal spread (fricatives: s, sh, ee, f)
    // volume → overall gating (is the AI speaking at all?)
    //
    // Asymmetric smoothing: mouth opens fast, closes slowly
    // — this mimics natural speech where articulation is sharp
    //   but the jaw doesn't snap shut between syllables.
    // =====================================================
    const viseme = volumeRef.current;
    const jawTarget = viseme.jawOpen;
    const widthTarget = viseme.mouthWidth;
    const volTarget = viseme.volume;

    // Asymmetric EMA: fast attack (0.5), slow release (0.12)
    const jawAlpha = jawTarget > smoothJawRef.current ? 0.5 : 0.12;
    smoothJawRef.current += (jawTarget - smoothJawRef.current) * jawAlpha;

    const widthAlpha = widthTarget > smoothWidthRef.current ? 0.4 : 0.15;
    smoothWidthRef.current += (widthTarget - smoothWidthRef.current) * widthAlpha;

    const volAlpha = volTarget > smoothVolRef.current ? 0.45 : 0.1;
    smoothVolRef.current += (volTarget - smoothVolRef.current) * volAlpha;

    const jaw = smoothJawRef.current;
    const width = smoothWidthRef.current;
    const vol = smoothVolRef.current;

    // --- Jaw bone animation (if native jaw exists) ---
    if (jawBoneRef.current) {
      // Use higher amplitude when full mouth rig is present (lips complement the jaw)
      const jawAmplitude = hasFullMouthRigRef.current ? 0.45 : 0.35;
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(
        jawBoneRef.current.rotation.x, jaw * jawAmplitude, 0.4
      );
    }

    // --- Full mouth rig: frequency-driven lip bone animation ---
    if (hasFullMouthRigRef.current) {
      // Capture lip bone base rotations on first frame
      if (lipsLRef.current && lipsLBaseRotRef.current === null) {
        lipsLBaseRotRef.current = {
          x: lipsLRef.current.rotation.x,
          y: lipsLRef.current.rotation.y,
          z: lipsLRef.current.rotation.z,
        };
      }
      if (lipsRRef.current && lipsRBaseRotRef.current === null) {
        lipsRBaseRotRef.current = {
          x: lipsRRef.current.rotation.x,
          y: lipsRRef.current.rotation.y,
          z: lipsRRef.current.rotation.z,
        };
      }

      // Lips.L: width drives Y rotation (spread outward), jaw drives Z (open pull)
      if (lipsLRef.current && lipsLBaseRotRef.current) {
        const targetY = lipsLBaseRotRef.current.y + (-width * 0.12);
        const targetZ = lipsLBaseRotRef.current.z + (jaw * 0.06);
        lipsLRef.current.rotation.y = THREE.MathUtils.lerp(
          lipsLRef.current.rotation.y, targetY, 0.35
        );
        lipsLRef.current.rotation.z = THREE.MathUtils.lerp(
          lipsLRef.current.rotation.z, targetZ, 0.3
        );
      }

      // Lips.R: mirror of lips.L (positive Y instead of negative)
      if (lipsRRef.current && lipsRBaseRotRef.current) {
        const targetY = lipsRBaseRotRef.current.y + (width * 0.12);
        const targetZ = lipsRBaseRotRef.current.z + (jaw * 0.06);
        lipsRRef.current.rotation.y = THREE.MathUtils.lerp(
          lipsRRef.current.rotation.y, targetY, 0.35
        );
        lipsRRef.current.rotation.z = THREE.MathUtils.lerp(
          lipsRRef.current.rotation.z, targetZ, 0.3
        );
      }

      // Extended lip bones (from add_mouth_rig.py): position-based animation
      if (vol > 0.02) {
        // Upper lip rises slightly on open vowels ("ah", "oh")
        if (lipTopRef.current) {
          lipTopRef.current.position.y = THREE.MathUtils.lerp(
            lipTopRef.current.position.y, jaw * 0.002, 0.3
          );
        }
        // Lower lip drops with jaw (reinforces jaw bone)
        if (lipBottomRef.current) {
          lipBottomRef.current.position.y = THREE.MathUtils.lerp(
            lipBottomRef.current.position.y, -jaw * 0.001, 0.3
          );
        }
        // Side lip segments follow their corner with reduced intensity
        const cornerSpread = (width - 0.3) * 0.003;
        if (lipTopLRef.current) {
          lipTopLRef.current.position.x = THREE.MathUtils.lerp(
            lipTopLRef.current.position.x, cornerSpread * 0.5, 0.2
          );
        }
        if (lipTopRRef.current) {
          lipTopRRef.current.position.x = THREE.MathUtils.lerp(
            lipTopRRef.current.position.x, -cornerSpread * 0.5, 0.2
          );
        }
        if (lipBottomLRef.current) {
          lipBottomLRef.current.position.x = THREE.MathUtils.lerp(
            lipBottomLRef.current.position.x, cornerSpread * 0.5, 0.2
          );
        }
        if (lipBottomRRef.current) {
          lipBottomRRef.current.position.x = THREE.MathUtils.lerp(
            lipBottomRRef.current.position.x, -cornerSpread * 0.5, 0.2
          );
        }
      }
    }

    // --- Conversational head gestures (driven by speech energy) ---
    // These are layered ON TOP of the idle movement set above (absolute, not additive)
    if (headBoneRef.current && headBaseRotRef.current && vol > 0.05) {
      // Subtle nods on emphasis (jaw energy drives micro-nods)
      headBoneRef.current.rotation.x += jaw * 0.008;
      // Slight rhythmic tilt on syllables
      headBoneRef.current.rotation.z += Math.sin(t * 6) * jaw * 0.004;
    }

    // --- Synthetic mouth overlay — frequency-driven viseme shapes ---
    // ONLY renders when no full mouth rig is present (fallback for simple models)
    if (mouthMeshRef.current && !hasFullMouthRigRef.current) {
      const base = mouthMeshRef.current.userData.baseSize || mouthMeshRef.current.scale.x;
      if (!mouthMeshRef.current.userData.baseSize) {
        mouthMeshRef.current.userData.baseSize = base;
      }

      if (vol > 0.02) {
        // ============ ACTIVE SPEECH ============
        const openY = base * (0.15 + jaw * 2.0);
        const openX = base * (0.7 + width * 0.8 + jaw * 0.2);
        const openZ = base * (0.7 + jaw * 0.5 - width * 0.15);

        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, openY, 0.5);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, openX, 0.4);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, openZ, 0.35);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.92, 0.3);
      } else {
        // ============ SILENT — relaxed closed mouth ============
        const closedY = base * 0.05;
        const closedX = base * 0.7;
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, closedY, 0.08);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, closedX, 0.08);
        mouthMeshRef.current.scale.z = THREE.MathUtils.lerp(mouthMeshRef.current.scale.z, base, 0.08);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.5, 0.04);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}
