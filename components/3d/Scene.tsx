'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Avatar } from './Avatar';
import type { AnimationState } from './Avatar';
import type { VisemeData } from '@/hooks/useGeminiLive';


// 1. Give Scene its own guest list so it can accept the data from page.tsx!
interface SceneProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
}

export default function Scene({ modelUrl, volumeRef, animationState }: SceneProps) {
  return (
    <Canvas
    // 🚀 Push the Z position closer (e.g., from 5 down to 2 or 3)
    // 🚀 Raise the Y position to frame his torso/head (e.g., 1 or 1.5)
    camera={{ position: [0, 1.2, 2.5], fov: 45 }}
    className="w-full h-full"
  >
      {/* Local HDR file — avoids CDN fetches that CSP blocks */}
      <Environment files="/hdri/potsdamer_platz_1k.hdr" />
      <Suspense fallback={null}>
         {/* key={modelUrl} forces full remount per model — this is CRITICAL
             because drei's useAnimations reuses the same AnimationMixer via useState.
             On model switch, the mixer's PropertyBinding cache (keyed by rootUuid+trackName)
             retains stale bindings pointing to the OLD clone's bones. Fresh mount = fresh mixer. */}
         <Avatar key={modelUrl} modelUrl={modelUrl} volumeRef={volumeRef} animationState={animationState} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />
    </Canvas>
  );
}
