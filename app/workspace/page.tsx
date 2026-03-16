'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { DropZone } from '@/components/ui/DropZone';
import { ActiveLoadingScreen } from '@/components/ui/ActiveLoadingScreen';
import { FloatingArtifact, getInitialPosition } from '@/components/ui/FloatingArtifact';
import type { ArtifactPosition } from '@/components/ui/FloatingArtifact';
import { SharePanel } from '@/components/ui/SharePanel';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { getOrCreateAnonymousId } from '@/lib/anonymousId';
import { getUserTier, getTierLimits } from '@/lib/userTier';
import type { UserTier } from '@/lib/userTier';
import { DemoLimitBanner } from '@/components/ui/DemoLimitBanner';
import type { AnimationState } from '@/components/3d/Avatar';
import type { StagedFile } from '@/types/lxxi';
import dynamic from 'next/dynamic';
import { LoginButton } from '@/components/ui/LoginButton';
import { AgentLibrary } from '@/components/AgentLibrary';
import { ArtifactVault } from '@/components/ui/ArtifactVault';
import type { VaultItem } from '@/types/lxxi';

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
  const router = useRouter();
  const paramAgentId = searchParams.get('agentId');

  // If no agentId, skip ingestion and go straight to LIVE with demo model
  const [appState, setAppState] = useState<'INGESTION' | 'LOADING' | 'LIVE'>(
    paramAgentId ? 'LOADING' : 'LIVE'
  );
  const [activeAgentId, setActiveAgentId] = useState<string | null>(paramAgentId || 'demo_wow');
  const [modelUrl, setModelUrl] = useState<string>(paramAgentId ? '' : DEMO_MODEL_URL);
  const [voiceName, setVoiceName] = useState<string>('Aoede');
  const [showLibrary, setShowLibrary] = useState(false);
  const [showArtifactVault, setShowArtifactVault] = useState(false);

  // Dismissed floating artifacts — persisted in localStorage per agent so they
  // don't reappear on page reload. Keyed by item ID (Firestore doc ID or fallback).
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Helper to get a stable key for a vault item (Firestore ID or content-based fallback)
  const getItemKey = useCallback((item: any): string => {
    if (item.id) return item.id;
    return `${item.type}_${item.createdAt || 0}`;
  }, []);

  // Load dismissed IDs from localStorage when agent changes
  useEffect(() => {
    if (!activeAgentId) return;
    try {
      const stored = localStorage.getItem(`lxxi_dismissed_${activeAgentId}`);
      if (stored) {
        setDismissedIds(new Set(JSON.parse(stored)));
      } else {
        setDismissedIds(new Set());
      }
    } catch { setDismissedIds(new Set()); }
  }, [activeAgentId]);

  // Persist dismissals to localStorage whenever they change
  const saveDismissals = useCallback((ids: Set<string>) => {
    if (!activeAgentId) return;
    try {
      localStorage.setItem(`lxxi_dismissed_${activeAgentId}`, JSON.stringify(Array.from(ids)));
    } catch { /* localStorage full — ignore */ }
  }, [activeAgentId]);

  // Artifact positions — keyed by original vault index
  // Positions are calculated lazily and updated on drag
  const [artifactPositions, setArtifactPositions] = useState<Record<number, ArtifactPosition>>({});
  const positionedIndicesRef = useRef<Set<number>>(new Set());

  // Stable user ID: Firebase UID if logged in, persistent anonymous ID otherwise
  // This ensures Pinecone namespaces and Firestore vault paths always work
  const [effectiveUserId, setEffectiveUserId] = useState<string>('');
  const [userTier, setUserTier] = useState<UserTier>('demo');
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setEffectiveUserId(user?.uid || getOrCreateAnonymousId());
      setUserTier(getUserTier(user?.email, !!user));
    });
    return () => unsubscribe();
  }, []);
  const tierLimits = getTierLimits(userTier);

  // Handle URL params for agent pre-selection
  useEffect(() => {
    if (paramAgentId && !activeAgentId) {
      setActiveAgentId(paramAgentId);
      setAppState('LOADING');
    }
  }, [paramAgentId, activeAgentId]);

  const geminiConfig = useMemo(() => ({ voiceName }), [voiceName]);
  const { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, sendContext, ingestFile, addVaultItem, demoLimitReached } = useGeminiLive(activeAgentId || '', effectiveUserId, userTier, geminiConfig);

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

  // Wrap sendContext to intercept image uploads:
  // 1. Send to Gemini as inlineData (existing behavior)
  // 2. Upload to Firebase Storage for persistent URL
  // 3. Add to vault as floating artifact
  // 4. Notify Gemini with the URL so it can use referenceImageUrls
  const handleSendContext = useCallback((text: string, attachments: StagedFile[]) => {
    console.log(`[WORKSPACE] handleSendContext called: text="${text.substring(0, 50)}", attachments=${attachments.length}, types=${attachments.map(a => a.mimeType).join(',')}`);
    const sent = sendContext(text, attachments);
    if (!sent) {
      console.warn('[WORKSPACE] sendContext returned false — session may not be active');
      return false;
    }

    // Process image attachments in background — don't block the send
    const imageAttachments = attachments.filter(a => a.mimeType.startsWith('image/'));
    console.log(`[WORKSPACE] Image attachments to process: ${imageAttachments.length}`);
    if (imageAttachments.length > 0) {
      (async () => {
        for (const img of imageAttachments) {
          try {
            let imageUrl: string;

            if (auth.currentUser) {
              // Logged in: upload to Firebase Storage for a persistent URL
              const { uploadBase64Image } = await import('@/lib/storageUtils');
              const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
              imageUrl = await uploadBase64Image(auth.currentUser.uid, dataUrl, `upload_${Date.now()}_${img.name}`);
            } else {
              // Not logged in: use data URL directly (SSRF whitelist allows data:image/)
              imageUrl = `data:${img.mimeType};base64,${img.base64}`;
            }

            // Add to vault so it appears as a floating artifact
            addVaultItem({
              type: 'image' as const,
              prompt: `Uploaded: ${img.name}`,
              url: imageUrl,
              rationale: 'User upload',
              createdAt: Date.now()
            });

            // Notify Gemini so the agent can reference this URL in future image generation
            sendContext(
              `[SYSTEM: Image "${img.name}" has been uploaded and stored. URL: ${imageUrl} — When the user asks you to use, reference, or incorporate this image in new creations, include this URL in your referenceImageUrls array when calling create_vault_artifact.]`,
              []
            );

            console.log(`[WORKSPACE] Uploaded image "${img.name}" to storage, URL available for referenceImageUrls`);
          } catch (err) {
            console.error('[WORKSPACE] Failed to persist uploaded image:', err);
          }
        }
      })();
    }

    return true;
  }, [sendContext, addVaultItem]);

  // Reference a vault artifact — sends context to Gemini so the agent knows about it
  const handleReferenceArtifact = useCallback((item: VaultItem) => {
    if (!isConnected) {
      console.warn('[WORKSPACE] Cannot reference artifact — session not active');
      return;
    }

    if (item.type === 'image' && 'url' in item) {
      sendContext(
        `[SYSTEM: User is referencing a previously created image. URL: ${item.url}. Prompt: "${item.prompt || 'Image'}". Include this URL in referenceImageUrls when the user asks to modify, remix, or build upon this image.]`,
        []
      );
      console.log(`[WORKSPACE] Referenced image artifact: "${item.prompt}"`);
    } else if (item.type === 'document' && 'title' in item) {
      const preview = ('content' in item ? item.content || '' : '').substring(0, 500);
      sendContext(
        `[SYSTEM: User is referencing a previously created document. Title: "${item.title}". Content preview: ${preview}. The user wants to discuss or iterate on this document.]`,
        []
      );
      console.log(`[WORKSPACE] Referenced document artifact: "${item.title}"`);
    }

    // Close vault after referencing
    setShowArtifactVault(false);
  }, [isConnected, sendContext]);

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

  // Maximum floating artifacts visible at once — prevents screen flooding.
  // All items remain in the VAULT panel for browsing; only the newest show as floating cards.
  const MAX_FLOATING = 5;

  // Visible floating items — take the newest MAX_FLOATING first, THEN remove dismissed.
  // This prevents the "cycling" bug where dismissing an item shifts the window and
  // pulls in an older item that the user never asked to see.
  const visibleItems = useMemo(() => {
    const allMapped = vaultItems.map((item, idx) => ({ item, originalIndex: idx }));
    // Fix the window to the newest MAX_FLOATING items regardless of dismissals
    const newestWindow = allMapped.slice(-MAX_FLOATING);
    // Then hide any the user explicitly dismissed
    return newestWindow.filter(({ item }) => !dismissedIds.has(getItemKey(item)));
  }, [vaultItems, dismissedIds, getItemKey]);

  const handleDismiss = useCallback((originalIndex: number) => {
    const item = vaultItems[originalIndex];
    if (!item) return;
    const key = getItemKey(item);
    setDismissedIds(prev => {
      const next = new Set(prev).add(key);
      saveDismissals(next);
      return next;
    });
  }, [vaultItems, getItemKey, saveDismissals]);

  const handleClearWorkspace = useCallback(() => {
    const allKeys = new Set(dismissedIds);
    vaultItems.forEach(item => allKeys.add(getItemKey(item)));
    setDismissedIds(allKeys);
    saveDismissals(allKeys);
    // Reset positions so cleared items don't leave ghost state
    setArtifactPositions({});
    positionedIndicesRef.current = new Set();
  }, [vaultItems, dismissedIds, getItemKey, saveDismissals]);

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
          {tierLimits.soulsLibrary && appState === 'LIVE' && (
            <button
              onClick={() => {
                if (isConnected) stopSession();
                setShowLibrary(true);
              }}
              className="px-3 py-1.5 text-[10px] tracking-widest uppercase text-white/30 hover:text-[#d4af37] border border-white/10 hover:border-[#d4af37]/30 rounded-lg transition-all"
            >
              SOULS
            </button>
          )}
          <LoginButton onLogout={() => {
            if (isConnected) stopSession();
            router.push('/');
          }} />
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
              onClose={() => setShowLibrary(false)}
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
            onCancel={() => {
              // Bail out to demo workspace with default model
              setActiveAgentId('demo_wow');
              setModelUrl(DEMO_MODEL_URL);
              setVoiceName('Aoede');
              setAppState('LIVE');
            }}
          />
        </div>
      )}

      {/* Agent Library overlay — accessible from LIVE state via SOULS button */}
      {appState === 'LIVE' && showLibrary && auth.currentUser && (
        <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center overflow-y-auto">
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
          {demoLimitReached && <DemoLimitBanner tier={userTier} />}

          {/* Artifact Vault — slide-up panel above SharePanel */}
          {showArtifactVault && (
            <ArtifactVault
              items={vaultItems}
              onReference={handleReferenceArtifact}
              onClose={() => setShowArtifactVault(false)}
            />
          )}

          {/* Share Panel — text input + file staging + send */}
          <SharePanel
            isConnected={isConnected}
            isGenerating={isGeneratingVaultItem}
            onStart={startSession}
            onStop={stopSession}
            onClear={handleClearWorkspace}
            onSendContext={handleSendContext}
            onIngestFile={tierLimits.memoryIngestion ? ingestFile : undefined}
            onOpenVault={() => setShowArtifactVault(prev => !prev)}
            itemCount={vaultItems.length}
          />
        </>
      )}
    </main>
  );
}
