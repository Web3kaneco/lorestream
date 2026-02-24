'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// NOTE: We intentionally do NOT load or apply idlebreathing.glb animation.
// Its quaternion tracks were authored for a different model orientation
// (Beta mesh with rotation={[Math.PI/2, 0, 0]}) and cause Tripo models
// to appear upside-down/malformed. Instead we use manual bone manipulation.

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<number>;
}

export function Avatar({ modelUrl, volumeRef }: AvatarProps) {
  // Load the Tripo model (rigged with Mixamo skeleton via animate_rig)
  const { scene } = useGLTF(modelUrl);

  const groupRef = useRef<THREE.Group>(null!);

  // Bone refs
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const neckBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const rootBoneRef = useRef<THREE.Bone | null>(null);
  const lArmRef = useRef<THREE.Bone | null>(null);
  const rArmRef = useRef<THREE.Bone | null>(null);
  const lForeArmRef = useRef<THREE.Bone | null>(null);
  const rForeArmRef = useRef<THREE.Bone | null>(null);
  const jawBoneRef = useRef<THREE.Bone | null>(null);

  // Synthetic mouth overlay
  const mouthMeshRef = useRef<THREE.Mesh | null>(null);
  const smoothVolumeRef = useRef(0);

  // Track the arm pose lerp progress (for smooth transition out of T-pose)
  const armLerpRef = useRef(0);

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
    lArmRef.current = null;
    rArmRef.current = null;
    lForeArmRef.current = null;
    rForeArmRef.current = null;
    jawBoneRef.current = null;
    armLerpRef.current = 0;

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
        // Left Arm (upper — skip clavicle/shoulder, skip forearm)
        if (name.includes('leftarm') && !name.includes('fore')) {
          if (!lArmRef.current) lArmRef.current = child as THREE.Bone;
        }
        // Right Arm (upper)
        if (name.includes('rightarm') && !name.includes('fore')) {
          if (!rArmRef.current) rArmRef.current = child as THREE.Bone;
        }
        // Left ForeArm
        if (name.includes('leftforearm')) {
          if (!lForeArmRef.current) lForeArmRef.current = child as THREE.Bone;
        }
        // Right ForeArm
        if (name.includes('rightforearm')) {
          if (!rForeArmRef.current) rForeArmRef.current = child as THREE.Bone;
        }
      }
    });

    console.log('--- Bone Mapping Result ---');
    console.log('  Head:', headBoneRef.current?.name ?? 'MISSING');
    console.log('  Neck:', neckBoneRef.current?.name ?? 'MISSING');
    console.log('  Jaw:', jawBoneRef.current?.name ?? 'MISSING (will create synthetic mouth)');
    console.log('  Spine:', spineBoneRef.current?.name ?? 'MISSING');
    console.log('  Root:', rootBoneRef.current?.name ?? 'MISSING');
    console.log('  L Arm:', lArmRef.current?.name ?? 'MISSING');
    console.log('  R Arm:', rArmRef.current?.name ?? 'MISSING');
    console.log('  L ForeArm:', lForeArmRef.current?.name ?? 'MISSING');
    console.log('  R ForeArm:', rForeArmRef.current?.name ?? 'MISSING');

    // =========================================================
    // STEP 2: Create synthetic mouth overlay
    // =========================================================
    if (headBoneRef.current) {
      const headWorldScale = new THREE.Vector3();
      headBoneRef.current.getWorldScale(headWorldScale);
      const avgScale = (Math.abs(headWorldScale.x) + Math.abs(headWorldScale.y) + Math.abs(headWorldScale.z)) / 3;

      const mouthSize = Math.max(avgScale * 0.018, 0.005);
      const mouthOffsetY = -avgScale * 0.035;
      const mouthOffsetZ = avgScale * 0.055;

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
      if (mouthMeshRef.current) {
        mouthMeshRef.current.removeFromParent();
        mouthMeshRef.current = null;
      }
    };
  }, [scene, mouthGeo, mouthMat]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();

    // =====================================================
    // IDLE ARM POSE — arms down at sides, slight bend
    // Smooth lerp from T-pose on first load.
    // =====================================================
    armLerpRef.current = Math.min(armLerpRef.current + delta * 0.8, 1); // ~1.25s to reach full pose
    const armT = armLerpRef.current;

    if (lArmRef.current) {
      // Left upper arm: rotate down to side (Z), slight forward angle (X)
      lArmRef.current.rotation.z = THREE.MathUtils.lerp(lArmRef.current.rotation.z, 1.15, armT * 0.08);
      lArmRef.current.rotation.x = THREE.MathUtils.lerp(lArmRef.current.rotation.x, 0.15, armT * 0.08);
    }
    if (rArmRef.current) {
      // Right upper arm: mirror
      rArmRef.current.rotation.z = THREE.MathUtils.lerp(rArmRef.current.rotation.z, -1.15, armT * 0.08);
      rArmRef.current.rotation.x = THREE.MathUtils.lerp(rArmRef.current.rotation.x, 0.15, armT * 0.08);
    }
    if (lForeArmRef.current) {
      // Left forearm: slight bend inward
      lForeArmRef.current.rotation.y = THREE.MathUtils.lerp(lForeArmRef.current.rotation.y, 0.35, armT * 0.06);
    }
    if (rForeArmRef.current) {
      // Right forearm: slight bend inward (mirror)
      rForeArmRef.current.rotation.y = THREE.MathUtils.lerp(rForeArmRef.current.rotation.y, -0.35, armT * 0.06);
    }

    // --- Manual breathing (sine-wave chest expansion + subtle root bob) ---
    if (spineBoneRef.current) {
      const breathScale = 1 + Math.sin(t * 2) * 0.02;
      spineBoneRef.current.scale.set(1, breathScale, 1);
    }
    if (rootBoneRef.current) {
      rootBoneRef.current.position.y = Math.sin(t * 2) * 0.01;
    }

    // --- Neck subtle sway (additive, always) ---
    if (neckBoneRef.current) {
      neckBoneRef.current.rotation.y += Math.sin(t * 0.8) * 0.0006;
    }

    // --- Head idle movement (additive, always) ---
    if (headBoneRef.current) {
      headBoneRef.current.rotation.z += Math.sin(t * 1.2) * 0.0003;
      headBoneRef.current.rotation.x += Math.sin(t * 0.7) * 0.0002;
    }

    // --- Jaw bone animation (if native jaw exists) ---
    if (jawBoneRef.current && volumeRef?.current !== undefined) {
      const vol = Math.min(volumeRef.current / 80, 1);
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(
        jawBoneRef.current.rotation.x, vol * 0.3, 0.4
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
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, openY, 0.4);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, openX, 0.3);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.9, 0.3);
      } else {
        const closedY = baseSize * 0.08;
        mouthMeshRef.current.scale.y = THREE.MathUtils.lerp(mouthMeshRef.current.scale.y, closedY, 0.15);
        mouthMeshRef.current.scale.x = THREE.MathUtils.lerp(mouthMeshRef.current.scale.x, baseSize, 0.15);
        mouthMat.opacity = THREE.MathUtils.lerp(mouthMat.opacity, 0.6, 0.1);
      }
    }
  });

  return (
    <group ref={groupRef} position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}
