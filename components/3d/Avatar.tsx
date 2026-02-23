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
  
  const headBoneRef = useRef<THREE.Bone | null>(null);
  const spineBoneRef = useRef<THREE.Bone | null>(null);
  const rootBoneRef = useRef<THREE.Bone | null>(null);
  
  const lArmRef = useRef<THREE.Bone | null>(null);
  const rArmRef = useRef<THREE.Bone | null>(null);

  useEffect(() => {
    scene.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        const name = child.name.toLowerCase();

        if (name.includes('head')) {
          if (!headBoneRef.current) headBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('spine') || name.includes('chest')) {
          if (!spineBoneRef.current) spineBoneRef.current = child as THREE.Bone;
        }
        if (name.includes('pelvis') || name.includes('hip') || name.includes('waist')) {
          if (!rootBoneRef.current) rootBoneRef.current = child as THREE.Bone;
        }
        
        // 🦴 THE CLAVICLE BYPASS: We strictly ignore the collarbone so we catch the real arm!
        if ((name.includes('arm') || name.includes('shoulder')) && !name.includes('clavicle')) {
            console.log("🎯 REAL ARM FOUND:", name);
            if (name.startsWith('l') || name.includes('left')) {
                if (!lArmRef.current) lArmRef.current = child as THREE.Bone;
            }
            if (name.startsWith('r') || name.includes('right')) {
                if (!rArmRef.current) rArmRef.current = child as THREE.Bone;
            }
        }
      }
    });
  }, [scene]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (spineBoneRef.current) {
      const breathScale = 1 + Math.sin(t * 2) * 0.02;
      spineBoneRef.current.scale.set(1, breathScale, 1);
    }
    if (rootBoneRef.current) {
      rootBoneRef.current.position.y = Math.sin(t * 2) * 0.01;
    }

    if (headBoneRef.current && volumeRef?.current !== undefined) {
      const targetRotation = Math.min(volumeRef.current / 100, 1) * 0.15;
      headBoneRef.current.rotation.x = THREE.MathUtils.lerp(headBoneRef.current.rotation.x, targetRotation, 0.5);
      
      const targetStretch = 1 + (Math.min(volumeRef.current / 100, 1) * 0.08);
      headBoneRef.current.scale.y = THREE.MathUtils.lerp(headBoneRef.current.scale.y, targetStretch, 0.5);
    }

    // Lock the arms down!
    if (lArmRef.current) {
        lArmRef.current.rotation.z = 1.2; 
    }
    if (rArmRef.current) {
        rArmRef.current.rotation.z = -1.2;
    }
  });

  return (
    <group position={[0, -1, 0]}>
      <primitive object={scene} dispose={null} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}