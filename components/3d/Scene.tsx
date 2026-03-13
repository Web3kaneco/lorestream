'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls } from '@react-three/drei';
import { Avatar } from './Avatar';
import type { AnimationState } from './Avatar';
import type { VisemeData } from '@/hooks/useGeminiLive';


interface SceneProps {
  modelUrl: string;
  volumeRef: React.MutableRefObject<VisemeData>;
  animationState?: AnimationState;
  /** Base Y rotation in radians — corrects model facing direction */
  facingRotationY?: number;
  /** Skip procedural hip/spine/neck/head additive motion — for models with full idle animation baked in */
  skipProceduralMotion?: boolean;
}

export default function Scene({ modelUrl, volumeRef, animationState, facingRotationY, skipProceduralMotion }: SceneProps) {
  return (
    <Canvas
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
         <Avatar key={modelUrl} modelUrl={modelUrl} volumeRef={volumeRef} animationState={animationState} facingRotationY={facingRotationY} skipProceduralMotion={skipProceduralMotion} />
      </Suspense>
      <OrbitControls enableZoom={false} enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} minPolarAngle={Math.PI / 3} />
    </Canvas>
  );
}
