'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { DropZone } from '@/components/ui/DropZone';
import { ActiveLoadingScreen } from '@/components/ui/ActiveLoadingScreen';
import { FloatingArtifact, getInitialPosition } from '@/components/ui/FloatingArtifact';
import type { ArtifactPosition } from '@/components/ui/FloatingArtifact';
import { SharePanel } from '@/components/ui/SharePanel';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { getOrCreateAnonymousId } from '@/lib/anonymousId';
import { isAdminUser } from '@/lib/adminWhitelist';
import { DemoLimitBanner } from '@/components/ui/DemoLimitBanner';
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
  const [voiceName, setVoiceName] = useState<string>('Aoede');
  const [showLibrary, setShowLibrary] = useState(false);

  // Dismissed floating artifacts — visual only, items persist in Firebase
  const [dismissedIndices, setDismissedIndices] = useState<Set<number>>(new Set());

  // Artifact positions — keyed by original vault index
  // Positions are calculated lazily and updated on drag
  const [artifactPositions, setArtifactPositions] = useState<Record<number, ArtifactPosition>>({});
  const positionedIndicesRef = useRef<Set<number>>(new Set());

  // Stable user ID: Firebase UID if logged in, persistent anonymous ID otherwise
  // This ensures Pinecone namespaces and Firestore vault paths always work
  const [effectiveUserId, setEffectiveUserId] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setEffectiveUserId(user?.uid || getOrCreateAnonymousId());
      setIsAdmin(isAdminUser(user?.email));
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

  const geminiConfig = useMemo(() => ({ voiceName }), [voiceName]);
  const { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, sendContext, ingestFile, demoLimitReached } = useGeminiLive(activeAgentId || '', effectiveUserId, isAdmin, geminiConfig);

  // Demo limit reached — stop session after a short delay to let final response play
  useEffect(() => {
    if (demoLimitReached && isConnected) {
      const timer = setTimeout(() => { stopSession(); }, 4000);
      return () => clearTimeout(timer);
    }
  }, [demoLimitReached, isConnected, stopSession]);

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

  // Visible floating items — filter dismissed only (no cap — user controls what stays visible)
  const visibleItems = vaultItems
    .map((item, idx) => ({ item, originalIndex: idx }))
    .filter(({ originalIndex }) => !dismissedIndices.has(originalIndex));

  const handleDismiss = (originalIndex: number) => {
    setDismissedIndices(prev => new Set(prev).add(originalIndex));
  };

  const handleClearWorkspace = () => {
    const allIndices = new Set(dismissedIndices);
    vaultItems.forEach((_, idx) => allIndices.add(idx));
    setDismissedIndices(allIndices);
    // Reset positions so cleared items don't leave ghost state
    setArtifactPositions({});
    positionedIndicesRef.current = new Set();
  };

  // Compute initial positions for new artifacts (runs when visibleItems changes)
  useEffect(() => {
    const newPositions: Record<number, ArtifactPosition> = {};
    let changed = false;

    // Count how many of each side-type already have positions
    let rightCount = 0; // images
    let leftCount = 0;  // documents, etc.

    // First pass: count already-positioned items by side
    for (const { item, originalIndex } of visibleItems) {
      if (positionedIndicesRef.current.has(originalIndex)) {
        if (item.type === 'image') rightCount++;
        else leftCount++;
      }
    }

    // Second pass: assign positions to new items
    for (const { item, originalIndex } of visibleItems) {
      if (!positionedIndicesRef.current.has(originalIndex)) {
        const sameTypeBefore = item.type === 'image' ? rightCount : leftCount;
        newPositions[originalIndex] = getInitialPosition(item, sameTypeBefore);
        positionedIndicesRef.current.add(originalIndex);
        changed = true;

        if (item.type === 'image') rightCount++;
        else leftCount++;
      }
    }

    if (changed) {
      setArtifactPositions(prev => ({ ...prev, ...newPositions }));
    }
  }, [visibleItems]);

  // Handle drag end — update stored position
  const handleDragEnd = useCallback((originalIndex: number, newPos: ArtifactPosition) => {
    setArtifactPositions(prev => ({ ...prev, [originalIndex]: newPos }));
  }, []);

  return (
    <main className="relative w-screen h-screen bg-[#050505] overflow-hidden font-mono selection:bg-[#d4af37] selection:text-black">

      {/* Top bar — minimal branding + login + vault */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/lxxi-logo.png" alt="LXXI" className="h-6 mix-blend-screen" />
          <span className="text-white/20 text-xs">WORKSPACE</span>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#d4af37] animate-pulse' : 'bg-gray-600'}`} />
        </div>
        <div className="flex items-center gap-2">
          {auth.currentUser && appState === 'LIVE' && (
            <button
              onClick={() => {
                if (isConnected) stopSession();
                setShowLibrary(true);
              }}
              className="px-3 py-1.5 text-[10px] tracking-widest uppercase text-white/30 hover:text-[#d4af37] border border-white/10 hover:border-[#d4af37]/30 rounded-lg transition-all"
            >
              VAULT
            </button>
          )}
          <LoginButton />
        </div>
      </div>

      {/* Full-screen overlays for non-LIVE states */}
      {appState === 'INGESTION' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center">
          {showLibrary ? (
            <AgentLibrary
              userId={auth.currentUser?.uid || ''}
              onSelectAgent={(selectedAgentId, url, selectedVoice) => {
                setActiveAgentId(selectedAgentId);
                setModelUrl(url);
                setVoiceName(selectedVoice);
                setAppState('LIVE');
                setShowLibrary(false);
              }}
            />
          ) : <DropZone onAwaken={handleAwaken} userId={auth.currentUser?.uid} />}
        </div>
      )}

      {appState === 'LOADING' && activeAgentId && effectiveUserId && (
        <div className="absolute inset-0 z-40">
          <ActiveLoadingScreen
            userId={effectiveUserId}
            agentId={activeAgentId}
            onComplete={(url, fetchedVoice) => {
              setModelUrl(url);
              setVoiceName(fetchedVoice);
              setAppState('LIVE');
            }}
          />
        </div>
      )}

      {/* Agent Library overlay — accessible from LIVE state via VAULT button */}
      {appState === 'LIVE' && showLibrary && auth.currentUser && (
        <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <AgentLibrary
            userId={auth.currentUser.uid}
            onSelectAgent={(selectedAgentId, url, selectedVoice) => {
              if (isConnected) stopSession();
              setActiveAgentId(selectedAgentId);
              setModelUrl(url);
              setVoiceName(selectedVoice);
              setShowLibrary(false);
            }}
            onClose={() => setShowLibrary(false)}
          />
        </div>
      )}

      {/* LIVE WORKSPACE — Fluid voice-first layout */}
      {appState === 'LIVE' && activeAgentId && modelUrl && (
        <>
          {/* Full-screen 3D Avatar */}
          <div className="absolute inset-0 z-0">
            <Scene
              modelUrl={modelUrl}
              volumeRef={volumeRef}
              animationState={animationState}
              facingRotationY={modelUrl === DEMO_MODEL_URL ? -Math.PI / 2 : 0}
              skipProceduralMotion={modelUrl !== DEMO_MODEL_URL}
            />
            {/* Subtle scanline overlay */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.12)_50%)] bg-[length:100%_4px] opacity-10" />
            {/* Bottom fade for toolbar readability */}
            <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#050505] via-[#050505]/70 to-transparent" />
          </div>

          {/* Floating artifacts — max 5 visible, draggable */}
          <div className="absolute inset-0 z-20 pointer-events-none">
            {visibleItems.map(({ item, originalIndex }, displayIndex) => (
              <FloatingArtifact
                key={originalIndex}
                item={item}
                index={displayIndex}
                total={visibleItems.length}
                isNewest={displayIndex === visibleItems.length - 1}
                position={artifactPositions[originalIndex] || { x: 0, y: 80 }}
                onDismiss={() => handleDismiss(originalIndex)}
                onDragEnd={(pos) => handleDragEnd(originalIndex, pos)}
              />
            ))}
          </div>

          {/* Demo limit banner */}
          {demoLimitReached && <DemoLimitBanner />}

          {/* Share Panel — text input + file staging + send */}
          <SharePanel
            isConnected={isConnected}
            isGenerating={isGeneratingVaultItem}
            onStart={startSession}
            onStop={stopSession}
            onClear={handleClearWorkspace}
            onSendContext={sendContext}
            onIngestFile={isAdmin ? ingestFile : undefined}
            itemCount={visibleItems.length}
          />
        </>
      )}
    </main>
  );
}
