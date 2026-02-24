'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Avatar } from './Avatar';
import type { VisemeData } from '@/hooks/useGeminiLive';


// 1. Give Scene its own guest list so it can accept the data from page.tsx!
interface SceneProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
}

export default function Scene({ modelUrl, volumeRef }: SceneProps) {
  return (
    <Canvas camera={{ position: [0, 1.5, 4], fov: 50 }}>
      <Environment preset="city" />
      <Suspense fallback={null}>
         {/* 2. Pass the data straight down into your flawless Avatar component */}
         <Avatar modelUrl={modelUrl} volumeRef={volumeRef} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />
    </Canvas>
  );
}