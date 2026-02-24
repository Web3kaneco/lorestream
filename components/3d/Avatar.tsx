'use client';

import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { VisemeData } from '@/hooks/useGeminiLive';

// NOTE: We intentionally do NOT load or apply idlebreathing.glb animation.
// Its quaternion tracks were authored for a different model orientation
// (Beta mesh with rotation={[Math.PI/2, 0, 0]}) and cause Tripo models
// to appear upside-down/malformed. Instead we use manual bone manipulation.

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
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

  // Smoothed viseme channels (asymmetric EMA — fast attack, slow release)
  const smoothJawRef = useRef(0);
  const smoothWidthRef = useRef(0);
  const smoothVolRef = useRef(0);

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
    // Uses direct time-based blend (not per-frame exponential
    // which was too slow). easeOutCubic for natural deceleration.
    // =====================================================
    armLerpRef.current = Math.min(armLerpRef.current + delta * 2.0, 1); // ~0.5s
    const rawT = armLerpRef.current;
    const armT = 1 - Math.pow(1 - rawT, 3); // easeOutCubic: fast start, gentle settle

    if (lArmRef.current) {
      lArmRef.current.rotation.z = armT * 1.2;   // rotate down to side
      lArmRef.current.rotation.x = armT * 0.15;   // slight forward angle
    }
    if (rArmRef.current) {
      rArmRef.current.rotation.z = armT * -1.2;   // mirror
      rArmRef.current.rotation.x = armT * 0.15;
    }
    if (lForeArmRef.current) {
      lForeArmRef.current.rotation.y = armT * 0.4; // slight inward bend
    }
    if (rForeArmRef.current) {
      rForeArmRef.current.rotation.y = armT * -0.4; // mirror
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
    if (headBoneRef.current && vol > 0.05) {
      // Subtle nods on emphasis (jaw energy drives micro-nods)
      headBoneRef.current.rotation.x += jaw * 0.004;
      // Slight rhythmic tilt on syllables
      headBoneRef.current.rotation.z += Math.sin(t * 6) * jaw * 0.002;
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
