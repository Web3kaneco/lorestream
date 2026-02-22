'use client';

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

interface AvatarProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<number>;
}

export function Avatar({ modelUrl, volumeRef }: AvatarProps) {
  const { scene, animations } = useGLTF(modelUrl);
  const { actions } = useAnimations(animations, scene);
  const jawBoneRef = useRef<THREE.Bone | null>(null);

  useEffect(() => {
    // Find the Jaw or Head bone in the Tripo3D auto-rig
    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();
        if (name.includes('head') || name.includes('jaw') || name.includes('mouth')) {
          if (!jawBoneRef.current) jawBoneRef.current = child as THREE.Bone;
        }
      }
    });

    if (actions && Object.keys(actions).length > 0) {
      const idleAction = actions[Object.keys(actions)[0]];
      idleAction?.play();
    }
  }, [scene, actions]);

  // The 60FPS Render Loop
  useFrame(() => {
    if (jawBoneRef.current && volumeRef?.current !== undefined) {
      // Convert volume (0 to ~100) to a slight rotation angle
      const targetRotation = Math.min(volumeRef.current / 100, 1) * 0.5;
      
      // Use math interpolation (lerp) so the jaw moves smoothly, not jittery
      jawBoneRef.current.rotation.x = THREE.MathUtils.lerp(jawBoneRef.current.rotation.x, targetRotation, 0.5);
    }
  });

  return (
    <group position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} />
    </group>
  );
}