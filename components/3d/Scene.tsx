'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { Avatar } from './Avatar';
import { Suspense } from 'react';

interface SceneProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<number>;
}

export default function Scene({ modelUrl, volumeRef }: SceneProps) {
  return (
    <Canvas camera={{ position: [0, 1.5, 4], fov: 50 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.5} castShadow />
      <Environment preset="city" />
      <Suspense fallback={null}>
         <Avatar modelUrl={modelUrl} volumeRef={volumeRef} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />
    </Canvas>
  );
}