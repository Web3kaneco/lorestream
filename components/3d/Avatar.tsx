'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<number>;
}

export function Avatar({ modelUrl, volumeRef }: AvatarProps) {
  const { scene } = useGLTF(modelUrl);
  
  // We need refs for the different body parts to animate them!
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const rootBoneRef = useRef<THREE.Bone | null>(null);

  useEffect(() => {
    // 1. Hunt down the specific bones in the Tripo3D rig
    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();

        // Find Head (For talking)
        if (name.includes('head')) {
          if (!headBoneRef.current) headBoneRef.current = child as THREE.Bone;
        }
        // Find Spine/Chest (For breathing expansion)
        if (name.includes('spine') || name.includes('chest')) {
          if (!spineBoneRef.current) spineBoneRef.current = child as THREE.Bone;
        }
        // Find Root/Pelvis (For breathing up/down bob)
        if (name.includes('pelvis') || name.includes('hip') || name.includes('waist')) {
          if (!rootBoneRef.current) rootBoneRef.current = child as THREE.Bone;
        }

        // --- 2. THE BONE CRACKER: Drop the T-Pose! ---
        if (name.includes('l_upperarm') || name.includes('leftarm')) {
           child.rotation.z = 1.2; // Drops the left arm down to his side
        }
        if (name.includes('r_upperarm') || name.includes('rightarm')) {
           child.rotation.z = -1.2; // Drops the right arm down to his side
        }
      }
    });
  }, [scene]);

  // The 60FPS Render Loop (The Magic Happens Here)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // --- A. PROCEDURAL IDLE BREATHING ---
    if (spineBoneRef.current) {
      // Makes the chest slowly expand and contract using a Sine wave
      const breathScale = 1 + Math.sin(t * 2) * 0.02;
      spineBoneRef.current.scale.set(1, breathScale, 1);
    }
    if (rootBoneRef.current) {
      // Makes the entire body subtly bob up and down
      rootBoneRef.current.position.y = Math.sin(t * 2) * 0.01;
    }

    // --- B. AUDIO-REACTIVE TALKING ---
    if (headBoneRef.current && volumeRef?.current !== undefined) {
      // 1. The Head Nod
      const targetRotation = Math.min(volumeRef.current / 100, 1) * 0.15;
      headBoneRef.current.rotation.x = THREE.MathUtils.lerp(headBoneRef.current.rotation.x, targetRotation, 0.5);
      
      // 2. The "Jaw Drop" Illusion (Squash & Stretch)
      const targetStretch = 1 + (Math.min(volumeRef.current / 100, 1) * 0.08);
      headBoneRef.current.scale.y = THREE.MathUtils.lerp(headBoneRef.current.scale.y, targetStretch, 0.5);
    }
  });

  return (
    <group position={[0, -1, 0]}>
      {/* Added rotation to force him to face the camera! */}
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}