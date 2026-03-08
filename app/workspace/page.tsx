'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { DropZone } from '@/components/ui/DropZone';
import { ActiveLoadingScreen } from '@/components/ui/ActiveLoadingScreen';
import { FloatingArtifact } from '@/components/ui/FloatingArtifact';
import { SharePanel } from '@/components/ui/SharePanel';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { getOrCreateAnonymousId } from '@/lib/anonymousId';
import type { AnimationState } from '@/components/3d/Avatar';
import dynamic from 'next/dynamic';
import { LoginButton } from '@/components/ui/LoginButton';
import { AgentLibrary } from '@/components/AgentLibrary';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

// Default demo model — WOW with female voice and mouth morphs
const DEMO_MODEL_URL = '/WOW.glb';

// Wrap in Suspense boundary for useSearchParams (Next.js 14 requirement)
export default function WorkspaceWrapper() {
  return (
    <Suspense fallback={
      <main className="w-screen h-screen bg-[#050505] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#d4af37]" />
      </main>
    }>
      <WorkspacePage />
    </Suspense>
  );
}

function WorkspacePage() {
  const searchParams = useSearchParams();
  const paramAgentId = searchParams.get('agentId');

  // If no agentId, skip ingestion and go straight to LIVE with demo model
  const [appState, setAppState] = useState<'INGESTION' | 'LOADING' | 'LIVE'>(
    paramAgentId ? 'LOADING' : 'LIVE'
  );
  const [activeAgentId, setActiveAgentId] = useState<string | null>(paramAgentId || 'demo_wow');
  const [modelUrl, setModelUrl] = useState<string>(paramAgentId ? '' : DEMO_MODEL_URL);
  const [showLibrary, setShowLibrary] = useState(false);

  // Dismissed floating artifacts — visual only, items persist in Firebase
  const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(new Set());

  // Stable user ID: Firebase UID if logged in, persistent anonymous ID otherwise
  // This ensures Pinecone namespaces and Firestore vault paths always work
  const [effectiveUserId, setEffectiveUserId] = useState<string>('');
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setEffectiveUserId(user?.uid || getOrCreateAnonymousId());
    });
    return () => unsubscribe();
  }, []);

  // Handle URL params for agent pre-selection
  useEffect(() => {
    if (paramAgentId && !activeAgentId) {
      setActiveAgentId(paramAgentId);
      setAppState('LOADING');
    }
  }, [paramAgentId, activeAgentId]);

  const { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, sendContext } = useGeminiLive(activeAgentId || '', effectiveUserId);

  // Derive animationState from connection + volume + generation state
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);

    if (!isConnected) {
      setAnimationState('idle');
      return;
    }

    animTimerRef.current = setInterval(() => {
      if (isGeneratingVaultItem) {
        setAnimationState('thinking');
      } else {
        const vol = volumeRef.current?.volume || 0;
        setAnimationState(vol > 0.05 ? 'speaking' : 'idle');
      }
    }, 250);

    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [isConnected, isGeneratingVaultItem, volumeRef]);

  const handleAwaken = async (data: any) => {
    if (!auth.currentUser) {
      alert("You must be logged in to awaken an Agent.");
      return;
    }

    const newAgentId = `agent_${Date.now()}`;
    setActiveAgentId(newAgentId);
    setAppState('LOADING');

    try {
      const enqueue3DTask = httpsCallable(functions, 'enqueue3DTask');
      if (data.type === 'image') {
        await enqueue3DTask({ imageBase64: data.base64, agentId: newAgentId });
      } else if (data.type === 'nft') {
        await enqueue3DTask({ contract: data.contract, tokenId: data.tokenId, agentId: newAgentId });
      }
    } catch (error) {
      console.error("Failed to trigger the Forge:", error);
      setAppState('INGESTION');
    }
  };

  // Visible floating items — filter dismissed, take last 5
  const visibleItems = vaultItems
    .map((item, idx) => ({ item, originalIndex: idx }))
    .filter(({ originalIndex }) => !dismissedIndices.has(originalIndex))
    .slice(-5);

  const handleDismiss = (originalIndex: number) => {
    setDismissedIndices(prev => new Set(prev).add(originalIndex));
  };

  const handleClearWorkspace = () => {
    const allIndices = new Set(dismissedIndices);
    vaultItems.forEach((_, idx) => allIndices.add(idx));
    setDismissedIndices(allIndices);
  };

  return (
    <main className="relative w-screen h-screen bg-[#050505] overflow-hidden font-mono selection:bg-[#d4af37] selection:text-black">

      {/* Top bar — minimal branding + login */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[#d4af37] text-sm font-bold tracking-widest">LXXI</span>
          <span className="text-white/20 text-xs">WORKSPACE</span>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#d4af37] animate-pulse' : 'bg-gray-600'}`} />
        </div>
        <LoginButton />
      </div>

      {/* Full-screen overlays for non-LIVE states */}
      {appState === 'INGESTION' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center">
          {showLibrary ? (
            <AgentLibrary
              userId={auth.currentUser?.uid || ''}
              onSelectAgent={(selectedAgentId, url) => {
                setActiveAgentId(selectedAgentId);
                setModelUrl(url);
                setAppState('LIVE');
                setShowLibrary(false);
              }}
            />
          ) : <DropZone onAwaken={handleAwaken} userId={auth.currentUser?.uid} />}
        </div>
      )}

      {appState === 'LOADING' && activeAgentId && (
        <div className="absolute inset-0 z-40">
          <ActiveLoadingScreen
            userId={auth.currentUser?.uid || ''}
            agentId={activeAgentId}
            onComplete={(url) => {
              setModelUrl(url);
              setAppState('LIVE');
            }}
          />
        </div>
      )}

      {/* LIVE WORKSPACE — Fluid voice-first layout */}
      {appState === 'LIVE' && activeAgentId && modelUrl && (
        <>
          {/* Full-screen 3D Avatar */}
          <div className="absolute inset-0 z-0">
            <Scene modelUrl={modelUrl} volumeRef={volumeRef} animationState={animationState} />
            {/* Subtle scanline overlay */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.12)_50%)] bg-[length:100%_4px] opacity-10" />
            {/* Bottom fade for toolbar readability */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050505] via-[#050505]/70 to-transparent" />
          </div>

          {/* Floating artifacts — max 5 visible */}
          <div className="absolute inset-0 z-20 pointer-events-none">
            {visibleItems.map(({ item, originalIndex }, displayIndex) => (
              <FloatingArtifact
                key={originalIndex}
                item={item}
                index={displayIndex}
                total={visibleItems.length}
                isNewest={displayIndex === visibleItems.length - 1}
                onDismiss={() => handleDismiss(originalIndex)}
              />
            ))}
          </div>

          {/* Share Panel — text input + file staging + send */}
          <SharePanel
            isConnected={isConnected}
            isGenerating={isGeneratingVaultItem}
            onStart={startSession}
            onStop={stopSession}
            onClear={handleClearWorkspace}
            onSendContext={sendContext}
            itemCount={visibleItems.length}
          />
        </>
      )}
    </main>
  );
}
