'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame, useGraph } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import { SkeletonUtils } from 'three-stdlib';
import * as THREE from 'three';

// --- Bone category patterns ---
// Used to map arbitrary Tripo bone names to Mixamo-standard roles.
const BONE_PATTERNS: Record<string, string[]> = {
  hips:          ['hips', 'pelvis', 'hip', 'waist', 'root'],
  spine:         ['spine'],
  spine1:        ['spine1', 'spine2', 'chest'],
  spine2:        ['spine2', 'spine3', 'upperchest'],
  neck:          ['neck', 'necktwist'],
  head:          ['head'],
  leftshoulder:  ['leftshoulder', 'lclavicle', 'lcollar', 'leftcollar'],
  leftarm:       ['leftarm', 'lupperarm', 'leftupperarm', 'lshoulder'],
  leftforearm:   ['leftforearm', 'llowerarm', 'leftlowerarm', 'lforearm', 'lelbow'],
  lefthand:      ['lefthand', 'lhand', 'lwrist'],
  rightshoulder: ['rightshoulder', 'rclavicle', 'rcollar', 'rightcollar'],
  rightarm:      ['rightarm', 'rupperarm', 'rightupperarm', 'rshoulder'],
  rightforearm:  ['rightforearm', 'rlowerarm', 'rightlowerarm', 'rforearm', 'relbow'],
  righthand:     ['righthand', 'rhand', 'rwrist'],
  leftupleg:     ['leftupleg', 'lthigh', 'leftthigh', 'lupleg'],
  leftleg:       ['leftleg', 'lshin', 'leftshin', 'lcalf', 'llowerleg'],
  leftfoot:      ['leftfoot', 'lfoot', 'lankle'],
  lefttoebase:   ['lefttoebase', 'ltoe', 'lefttoe'],
  rightupleg:    ['rightupleg', 'rthigh', 'rightthigh', 'rupleg'],
  rightleg:      ['rightleg', 'rshin', 'rightshin', 'rcalf', 'rlowerleg'],
  rightfoot:     ['rightfoot', 'rfoot', 'rankle'],
  righttoebase:  ['righttoebase', 'rtoe', 'righttoe'],
  jaw:           ['jaw', 'chin', 'mouth', 'mandible'],
};

// Full Mixamo bone name prefix
const MIXAMO_PREFIX = 'mixamorig';

/**
 * Given a bone name from an unknown skeleton, return the Mixamo standard name
 * (e.g. "mixamorigHips") if we can identify the role, or null.
 */
function classifyBone(boneName: string): string | null {
  const clean = boneName.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [role, patterns] of Object.entries(BONE_PATTERNS)) {
    for (const p of patterns) {
      if (clean.includes(p)) return role;
    }
  }
  return null;
}

/**
 * Build a name mapping: { tripoBoneName: mixamoBoneName }
 * so SkeletonUtils.retargetClip can match bones across skeletons.
 */
function buildBoneNameMap(
  tripoBones: THREE.Bone[],
  mixamoBones: THREE.Bone[]
): Record<string, string> {
  const nameMap: Record<string, string> = {};

  // Index Mixamo bones by their role
  const mixamoByRole: Record<string, string> = {};
  for (const b of mixamoBones) {
    const role = classifyBone(b.name);
    if (role && !mixamoByRole[role]) mixamoByRole[role] = b.name;
  }

  // Map each Tripo bone to its Mixamo equivalent
  for (const b of tripoBones) {
    const role = classifyBone(b.name);
    if (role && mixamoByRole[role]) {
      nameMap[b.name] = mixamoByRole[role];
    }
  }

  return nameMap;
}

// Collect all bones from a scene
function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  return bones;
}

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<number>;
}

export function Avatar({ modelUrl, volumeRef }: AvatarProps) {
  // Load the Tripo model (dynamic URL) and the reference idle breathing animation
  const { scene } = useGLTF(modelUrl);
  const idleGltf = useGLTF('/idlebreathing.glb');

  const groupRef = useRef<THREE.Group>(null!);

  // Core skeleton refs (on the Tripo model)
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const rootBoneRef = useRef<THREE.Bone | null>(null);
  const lArmRef = useRef<THREE.Bone | null>(null);
  const rArmRef = useRef<THREE.Bone | null>(null);
  const jawBoneRef = useRef<THREE.Bone | null>(null);

  // Synthetic mouth overlay mesh
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);

  // Smoothed volume for natural mouth movement
  const smoothVolumeRef = useRef(0);

  // Track whether we've applied the retargeted animation
  const retargetedClipRef = useRef<THREE.AnimationClip | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // Mouth geometry — created once, reused
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
    // Reset refs on model change
    headBoneRef.current = null;
    neckBoneRef.current = null;
    spineBoneRef.current = null;
    rootBoneRef.current = null;
    lArmRef.current = null;
    rArmRef.current = null;
    jawBoneRef.current = null;
    retargetedClipRef.current = null;

    if (mixerRef.current) {
      mixerRef.current.stopAllAction();
      mixerRef.current = null;
    }

    // Remove any previously attached synthetic mouth
    if (mouthMeshRef.current) {
      mouthMeshRef.current.removeFromParent();
      mouthMeshRef.current = null;
    }

    // =========================================================
    // STEP 1: Scan the Tripo model's skeleton
    // =========================================================
    console.log('--- Skeleton Bone Scan (Tripo Model) ---');
    const tripoBones = collectBones(scene);

    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();
        console.log('  Bone:', child.name);

        if (name.includes('head') && !name.includes('headtop')) {
          if (!headBoneRef.current) headBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('neck') || name.includes('necktwist')) {
          if (!neckBoneRef.current) neckBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('jaw') || name.includes('chin') || name.includes('mouth') || name.includes('mandible')) {
          if (!jawBoneRef.current) {
            jawBoneRef.current = child as THREE.Bone;
            console.log('  -> Native jaw bone found:', child.name);
          }
        }
        if (name.includes('spine') || name.includes('chest')) {
          if (!spineBoneRef.current) spineBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('pelvis') || name.includes('hip') || name.includes('waist')) {
          if (!rootBoneRef.current) rootBoneRef.current = child as THREE.Bone;
        }
        if ((name.includes('arm') || name.includes('shoulder')) && !name.includes('clavicle')) {
          if (name.startsWith('l') || name.includes('left')) {
            if (!lArmRef.current) lArmRef.current = child as THREE.Bone;
          }
          if (name.startsWith('r') || name.includes('right')) {
            if (!rArmRef.current) rArmRef.current = child as THREE.Bone;
          }
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
    // STEP 2: Retarget the idle breathing animation
    // =========================================================
    if (idleGltf.animations.length > 0 && tripoBones.length > 0) {
      const mixamoBones = collectBones(idleGltf.scene);
      const nameMap = buildBoneNameMap(tripoBones, mixamoBones);

      console.log('--- Bone Name Map (Tripo -> Mixamo) ---');
      for (const [tripoName, mixamoName] of Object.entries(nameMap)) {
        console.log(`  ${tripoName} -> ${mixamoName}`);
      }

      // The retargetClip `names` option maps TARGET bone names to SOURCE bone names.
      // Since we want to apply the Mixamo animation (source) to the Tripo skeleton (target),
      // the map needs to be: { tripoBoneName: mixamoBoneName }
      // But retargetClip's `names` does: for each target bone, look up names[targetBoneName]
      // to find the corresponding source bone. So nameMap is exactly right.

      // Find the first SkinnedMesh in the Tripo scene to get its skeleton
      let tripoSkeleton: THREE.Skeleton | null = null;
      scene.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh && !tripoSkeleton) {
          tripoSkeleton = (child as THREE.SkinnedMesh).skeleton;
        }
      });

      let mixamoSkeleton: THREE.Skeleton | null = null;
      idleGltf.scene.traverse((child) => {
        if ((child as THREE.SkinnedMesh).isSkinnedMesh && !mixamoSkeleton) {
          mixamoSkeleton = (child as THREE.SkinnedMesh).skeleton;
        }
      });

      if (tripoSkeleton && mixamoSkeleton) {
        try {
          const sourceClip = idleGltf.animations[0];
          console.log(`  Retargeting animation "${sourceClip.name}" (${sourceClip.duration.toFixed(2)}s, ${sourceClip.tracks.length} tracks)`);

          // Find the root bone name for hip tracking
          const rootRole = classifyBone(rootBoneRef.current?.name ?? '');
          const hipName = rootBoneRef.current?.name ?? 'hips';

          const retargetedClip = SkeletonUtils.retargetClip(
            tripoSkeleton,
            mixamoSkeleton,
            sourceClip,
            {
              names: nameMap,
              hip: hipName,
              fps: 30,
              useFirstFramePosition: true,
            }
          );

          console.log(`  Retargeted clip: ${retargetedClip.tracks.length} tracks`);

          // Create a mixer on the scene and play the retargeted animation
          const mixer = new THREE.AnimationMixer(scene);
          const action = mixer.clipAction(retargetedClip);
          action.play();

          mixerRef.current = mixer;
          retargetedClipRef.current = retargetedClip;
          console.log('  Idle breathing animation playing on Tripo model!');
        } catch (err) {
          console.warn('  Retargeting failed, falling back to manual pose:', err);
        }
      } else {
        console.warn('  Could not find skeletons for retargeting');
      }
    }

    // =========================================================
    // STEP 3: Create synthetic mouth overlay
    // =========================================================
    if (headBoneRef.current) {
      const headWorldScale = new THREE.Vector3();
      headBoneRef.current.getWorldScale(headWorldScale);
      const avgScale = (Math.abs(headWorldScale.x) + Math.abs(headWorldScale.y) + Math.abs(headWorldScale.z)) / 3;

      const mouthSize = Math.max(avgScale * 0.018, 0.005);
      const mouthOffsetY = -avgScale * 0.035;
      const mouthOffsetZ = avgScale * 0.055;

      console.log(`  Mouth calibration: scale=${avgScale.toFixed(4)}, size=${mouthSize.toFixed(4)}, offsetY=${mouthOffsetY.toFixed(4)}, offsetZ=${mouthOffsetZ.toFixed(4)}`);

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
        mixerRef.current = null;
      }
      if (mouthMeshRef.current) {
        mouthMeshRef.current.removeFromParent();
        mouthMeshRef.current = null;
      }
    };
  }, [scene, idleGltf, mouthGeo, mouthMat]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    // Advance the retargeted idle breathing animation
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    // --- Additional breathing emphasis (stacks on top of retargeted anim) ---
    if (spineBoneRef.current && !retargetedClipRef.current) {
      // Only apply manual breathing if retargeting failed
      const breathScale = 1 + Math.sin(t * 2) * 0.02;
      spineBoneRef.current.scale.set(1, breathScale, 1);
    }

    // --- Root bob (only if no retargeted animation) ---
    if (rootBoneRef.current && !retargetedClipRef.current) {
      rootBoneRef.current.position.y = Math.sin(t * 2) * 0.01;
    }

    // --- Neck subtle sway (additive — always) ---
    if (neckBoneRef.current) {
      const neckSway = Math.sin(t * 0.8) * 0.03;
      neckBoneRef.current.rotation.y += neckSway * 0.02; // Small additive
    }

    // --- Head idle movement (additive — always) ---
    if (headBoneRef.current) {
      const idleTiltZ = Math.sin(t * 1.2) * 0.015;
      const idleNodX = Math.sin(t * 0.7) * 0.01;
      headBoneRef.current.rotation.z += idleTiltZ * 0.02;
      headBoneRef.current.rotation.x += idleNodX * 0.02;
    }

    // --- Jaw bone animation (if native jaw exists) ---
    if (jawBoneRef.current && volumeRef?.current !== undefined) {
      const vol = Math.min(volumeRef.current / 80, 1);
      const jawOpen = vol * 0.3;
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(
        jawBoneRef.current.rotation.x, jawOpen, 0.4
      );
    }

    // --- Mouth overlay animation ---
    if (mouthMeshRef.current && volumeRef?.current !== undefined) {
      const rawVol = Math.min(volumeRef.current / 80, 1);
      smoothVolumeRef.current = THREE.MathUtils.lerp(smoothVolumeRef.current, rawVol, 0.35);
      const vol = smoothVolumeRef.current;

      const baseSize = mouthMeshRef.current.userData.baseSize || mouthMeshRef.current.scale.x;
      if (!mouthMeshRef.current.userData.baseSize) {
        mouthMeshRef.current.userData.baseSize = mouthMeshRef.current.scale.x;
      }

      if (vol > 0.03) {
        const openY = baseSize * (0.3 + vol * 1.4);
        const openX = baseSize * (1.0 + vol * 0.3);
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(
          mouthMeshRef.current.scale.y, openY, 0.4
        );
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(
          mouthMeshRef.current.scale.x, openX, 0.3
        );
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.9, 0.3);
      } else {
        const closedY = baseSize * 0.08;
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(
          mouthMeshRef.current.scale.y, closedY, 0.15
        );
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(
          mouthMeshRef.current.scale.x, baseSize, 0.15
        );
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.6, 0.1);
      }
    }

    // --- Lock the arms (only if retargeting didn't handle them) ---
    if (!retargetedClipRef.current) {
      if (lArmRef.current) lArmRef.current.rotation.z = 1.2;
      if (rArmRef.current) rArmRef.current.rotation.z = -1.2;
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}
