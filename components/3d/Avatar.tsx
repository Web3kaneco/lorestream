'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

// ARM POSE STRATEGY (in priority order):
// 1. If the loaded Tripo model has its own animation (from animate_retarget),
//    extract arm quaternions from frame 0 — no shoulder compensation needed
//    since the animation was made for THIS model's exact skeleton.
// 2. Fallback: use idlebreathing.glb as a reference, with shoulder-compensated
//    quaternion math to account for different skeleton proportions.

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
}

// Bones we care about for arm pose extraction.
// When using the model's own animation (retargeted idle), we apply these directly.
// When falling back to the external reference, shoulders are used for compensation
// math but never applied to the model.
const ARM_BONE_NAMES = new Set([
  'mixamorigLeftArm', 'mixamorigRightArm',
  'mixamorigLeftForeArm', 'mixamorigRightForeArm',
]);
const SHOULDER_BONE_NAMES = new Set([
  'mixamorigLeftShoulder', 'mixamorigRightShoulder',
]);
// All bones we extract from animations (arms + shoulders for compensation)
// Note: Array.from() used instead of spread to avoid needing downlevelIteration
const ALL_POSE_BONES = new Set(
  (Array.from(ARM_BONE_NAMES) as string[]).concat(Array.from(SHOULDER_BONE_NAMES))
);

export function Avatar({ modelUrl, volumeRef }: AvatarProps) {
  // Load the Tripo model (rigged with Mixamo skeleton via animate_rig)
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

  // Raw reference quaternions extracted from idlebreathing.glb (shoulders + arms + forearms)
  const armPoseRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  // T-pose quaternions captured on first render frame
  const armInitRef = useRef<Map<string, THREE.Quaternion> | null>(null);
  // Final target quaternions for arm/forearm bones (computed once on first frame)
  const armTargetRef = useRef<Map<string, THREE.Quaternion>>(new Map());
  const targetComputedRef = useRef(false);
  // True if the model came with its own animation (from retarget); false = using external reference
  const usingOwnAnimRef = useRef(false);

  // Synthetic mouth overlay
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

  // AnimationMixer — plays the retarget animation for body sway + arms down
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const hasRetargetAnimRef = useRef(false);

  // Mouth geometry — created once
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

  useEffect(() => {
    // Reset everything on model change
    headBoneRef.current = null;
    neckBoneRef.current = null;
    spineBoneRef.current = null;
    rootBoneRef.current = null;
    jawBoneRef.current = null;
    armPoseRef.current = new Map();
    armInitRef.current = null;
    armTargetRef.current = new Map();
    headBaseRotRef.current = null;
    neckBaseRotRef.current = null;
    targetComputedRef.current = false;

    // Clean up previous mixer
    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current.uncacheRoot(scene);
      mixerRef.current = null;
    }
    hasRetargetAnimRef.current = false;
    armLerpRef.current = 0;
    rootOrigYRef.current = null;

    if (mouthMeshRef.current) {
      mouthMeshRef.current.removeFromParent();
      mouthMeshRef.current = null;
    }

    // =========================================================
    // STEP 1: Scan the Tripo model's skeleton
    // =========================================================
    console.log('--- Skeleton Bone Scan (Tripo Model) ---');

    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();
        console.log('  Bone:', child.name);

        // Head (skip HeadTop_End)
        if (name.includes('head') && !name.includes('headtop') && !name.includes('head_end')) {
          if (!headBoneRef.current) headBoneRef.current = child as THREE.Bone;
        }
        // Neck
        if (name.includes('neck')) {
          if (!neckBoneRef.current) neckBoneRef.current = child as THREE.Bone;
        }
        // Jaw
        if (name.includes('jaw') || name.includes('chin') || name.includes('mandible')) {
          if (!jawBoneRef.current) {
            jawBoneRef.current = child as THREE.Bone;
            console.log('  -> Native jaw bone found:', child.name);
          }
        }
        // Spine (first spine bone for breathing)
        if (name.includes('spine') || name.includes('chest')) {
          if (!spineBoneRef.current) spineBoneRef.current = child as THREE.Bone;
        }
        // Root/Hips
        if (name.includes('hips') || name.includes('pelvis') || name.includes('hip') || name.includes('waist')) {
          if (!rootBoneRef.current) rootBoneRef.current = child as THREE.Bone;
        }
      }
    });

    console.log('--- Bone Mapping Result ---');
    console.log('  Head:', headBoneRef.current?.name ?? 'MISSING');
    console.log('  Neck:', neckBoneRef.current?.name ?? 'MISSING');
    console.log('  Jaw:', jawBoneRef.current?.name ?? 'MISSING (will create synthetic mouth)');
    console.log('  Spine:', spineBoneRef.current?.name ?? 'MISSING');
    console.log('  Root:', rootBoneRef.current?.name ?? 'MISSING');

    // =========================================================
    // STEP 2: Set up animation
    //
    // PRIORITY 1: If the model has a retarget animation, PLAY it
    //   via AnimationMixer. On Tripo's site, the idle animation
    //   shows the character standing with arms down. We play the
    //   whole clip as a looping animation — body sway, arms, etc.
    //
    // PRIORITY 2 (fallback): If no retarget animation exists,
    //   extract arm pose from idlebreathing.glb reference and
    //   apply with gentle slerp blend.
    // =========================================================
    console.log(`--- Animation Detection ---`);
    console.log(`  modelAnimations: ${modelAnimations ? modelAnimations.length : 'null/undefined'} clips`);

    if (modelAnimations && modelAnimations.length > 0) {
      // PLAY the retarget animation directly via AnimationMixer
      const clip = modelAnimations[0];
      console.log(`  Setting up AnimationMixer for "${clip.name}" (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
      for (const track of clip.tracks) {
        console.log(`    Track: ${track.name} (${Math.floor(track.values.length / 4)} keyframes)`);
      }

      const mixer = new THREE.AnimationMixer(scene);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();

      mixerRef.current = mixer;
      hasRetargetAnimRef.current = true;
      console.log(`  ✅ AnimationMixer playing — retarget animation active`);
    } else {
      console.log(`  ⚠️ No animations — using fallback reference for arms`);

      // FALLBACK: Extract arm quaternions from idlebreathing.glb
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

    // =========================================================
    // STEP 3: Create synthetic mouth overlay
    // =========================================================
    if (headBoneRef.current) {
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
    }

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current.uncacheRoot(scene);
        mixerRef.current = null;
      }
      if (mouthMeshRef.current) {
        mouthMeshRef.current.removeFromParent();
        mouthMeshRef.current = null;
      }
    };
  }, [scene, modelAnimations, idleGltf, mouthGeo, mouthMat]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    // =======================================================
    // LAYER 1: AnimationMixer (retarget body animation)
    // Plays the Tripo idle animation — body sway, arms down.
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
      const FALLBACK_ARM_BLEND = 0.15;
      const FALLBACK_FOREARM_BLEND = 0.10;

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
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(
        jawBoneRef.current.rotation.x, jaw * 0.35, 0.4
      );
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
    if (mouthMeshRef.current) {
      const base = mouthMeshRef.current.userData.baseSize || mouthMeshRef.current.scale.x;
      if (!mouthMeshRef.current.userData.baseSize) {
        mouthMeshRef.current.userData.baseSize = base;
      }

      if (vol > 0.02) {
        // ============ ACTIVE SPEECH ============
        // Jaw openness drives vertical scale (how open the mouth is)
        //   "ah" = high jaw → tall opening
        //   "mm" = low jaw → narrow slit
        const openY = base * (0.15 + jaw * 2.0);

        // Mouth width drives horizontal scale (spread vs pursed)
        //   "ee"/"ss" = high width → wide mouth
        //   "oo"/"oh" = low width → narrow/rounded
        const openX = base * (0.7 + width * 0.8 + jaw * 0.2);

        // Depth variation for 3D shape (rounded vs flat)
        //   High jaw + low width → deep rounded ("oh")
        //   Low jaw + high width → shallow flat ("ee")
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
