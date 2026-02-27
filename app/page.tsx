'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, functions, db } from '@/lib/firebase';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { ARCHITECT_CONFIG } from '@/lib/agents/architect';
import { DropZone } from '@/components/ui/DropZone';
import { LoginButton } from '@/components/ui/LoginButton';
import { ModeSwitcher } from '@/components/ui/ModeSwitcher';
import { VoiceOrb } from '@/components/ui/VoiceOrb';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

type LandingState = 'LANDING' | 'INTERVIEW' | 'UPLOAD' | 'REDIRECT';

interface CharacterLore {
  archetype: string;
  traits: string[];
  backstory: string;
  personality_summary: string;
  key_facts: string[];
}

export default function LandingPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<LandingState>('LANDING');
  const [characterLore, setCharacterLore] = useState<CharacterLore | null>(null);
  const [newAgentId, setNewAgentId] = useState<string | null>(null);

  // Handle the save_new_agent_lore tool callback from Architect
  const handleArchitectToolCallback = useCallback(async (toolName: string, args: any) => {
    if (toolName === 'save_new_agent_lore') {
      const lore: CharacterLore = {
        archetype: args.archetype || 'Unknown Entity',
        traits: args.traits || [],
        backstory: args.backstory || '',
        personality_summary: args.personality_summary || '',
        key_facts: args.key_facts || []
      };
      setCharacterLore(lore);

      // Pre-create agent doc in Firestore if user is logged in
      const userId = auth.currentUser?.uid;
      if (userId) {
        const agentId = `agent_${Date.now()}`;
        setNewAgentId(agentId);
        try {
          await setDoc(doc(db, `users/${userId}/agents/${agentId}`), {
            archetype: lore.archetype,
            traits: lore.traits,
            funFact: lore.backstory,
            extrusionStatus: 'pending',
            createdAt: serverTimestamp()
          });
          await setDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`), {
            current_lore_summary: lore.personality_summary,
            key_facts: lore.key_facts,
            last_updated: serverTimestamp()
          });
        } catch (err) {
          console.error("[ARCHITECT] Failed to save lore to Firestore:", err);
        }
      }

      // Transition to upload after a brief delay (let the Architect finish speaking)
      setTimeout(() => setPageState('UPLOAD'), 3000);
    }
  }, []);

  // Architect config with callback wired in
  const architectConfig = useMemo(() => ({
    ...ARCHITECT_CONFIG,
    onToolCallback: handleArchitectToolCallback
  }), [handleArchitectToolCallback]);

  const {
    isConnected,
    startSession,
    stopSession,
    volumeRef,
    transcripts
  } = useGeminiLive('architect_demo', auth.currentUser?.uid || 'anonymous', architectConfig);

  const handleBeginInterview = async () => {
    if (!auth.currentUser) {
      alert("Please log in first to begin your creation.");
      return;
    }
    setPageState('INTERVIEW');
    // Small delay to let the state transition render before starting session
    setTimeout(() => startSession(), 300);
  };

  const handleUploadComplete = async (data: any) => {
    if (!auth.currentUser) return;

    const agentId = newAgentId || `agent_${Date.now()}`;
    if (!newAgentId) setNewAgentId(agentId);

    // If lore wasn't saved yet (user skipped interview), create basic agent doc
    if (!characterLore) {
      try {
        await setDoc(doc(db, `users/${auth.currentUser.uid}/agents/${agentId}`), {
          archetype: 'Unknown Entity',
          traits: [],
          funFact: '',
          extrusionStatus: 'pending',
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.error("[LANDING] Failed to create agent doc:", err);
      }
    }

    // Trigger 3D generation
    try {
      const enqueue3DTask = httpsCallable(functions, 'enqueue3DTask');
      if (data.type === 'image') {
        await enqueue3DTask({ imageBase64: data.base64, agentId });
      } else if (data.type === 'nft') {
        await enqueue3DTask({ contract: data.contract, tokenId: data.tokenId, agentId });
      }
    } catch (error) {
      console.error("[LANDING] Failed to trigger 3D generation:", error);
      return;
    }

    // Clean up and redirect
    setPageState('REDIRECT');
    stopSession();
    router.push(`/workspace?agentId=${agentId}`);
  };

  // --- LANDING STATE ---
  if (pageState === 'LANDING') {
    return (
      <main className="relative w-screen h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
        {/* Animated background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,211,238,0.08)_0%,transparent_70%)] animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.05)_0%,transparent_50%)]" />

        {/* Top bar */}
        <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
          <ModeSwitcher />
          <LoginButton />
        </div>

        {/* Hero */}
        <div className="relative z-10 text-center max-w-2xl px-6">
          <h1 className="text-6xl md:text-7xl font-bold text-white mb-2 tracking-tight">
            Lore<span className="text-cyan-400">Stream</span>
          </h1>
          <p className="text-lg text-white/40 mb-12 font-light">
            Breathe life into your characters
          </p>

          <button
            onClick={handleBeginInterview}
            className="group relative px-10 py-4 bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-lg rounded-lg transition-all shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:shadow-[0_0_50px_rgba(34,211,238,0.5)]"
          >
            Begin Your Creation
            <span className="absolute inset-0 rounded-lg bg-cyan-400/20 animate-ping opacity-20 group-hover:opacity-0" />
          </button>

          <div className="mt-8 flex flex-col items-center gap-3">
            <button
              onClick={() => router.push('/workspace')}
              className="text-sm text-white/30 hover:text-white/60 transition-colors"
            >
              Skip to Workspace &rarr;
            </button>
          </div>
        </div>

        {/* Bottom decorative line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
      </main>
    );
  }

  // --- INTERVIEW STATE ---
  if (pageState === 'INTERVIEW') {
    return (
      <main className="relative w-screen h-screen bg-black overflow-hidden flex flex-col">
        {/* Top bar */}
        <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
          <button
            onClick={() => { stopSession(); setPageState('LANDING'); }}
            className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            &larr; Back
          </button>
          <LoginButton />
        </div>

        {/* Main content: Avatar + Transcript */}
        <div className="flex-1 flex flex-col md:flex-row items-stretch p-6 pt-20 gap-6">
          {/* 3D Avatar Panel */}
          <div className="flex-1 relative rounded-xl overflow-hidden border border-cyan-500/20 bg-black/50 min-h-[300px]">
            <div className="absolute top-3 left-3 text-xs text-cyan-400/50 z-10 flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-cyan-400 animate-pulse' : 'bg-gray-600'}`} />
              THE ARCHITECT {isConnected ? '// LISTENING' : '// STANDBY'}
            </div>
            <div className="absolute inset-0">
              <Scene modelUrl="/architect.glb" volumeRef={volumeRef} />
            </div>
            {/* Scanline overlay */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_4px] opacity-20" />
          </div>

          {/* Transcript + Controls */}
          <div className="w-full md:w-96 flex flex-col gap-4">
            {/* Voice Orb (shows when no 3D model visible on mobile) */}
            <div className="md:hidden">
              <VoiceOrb volumeRef={volumeRef} isActive={isConnected} />
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto border border-white/10 rounded-lg bg-black/30 p-4 space-y-3 min-h-[200px]">
              {transcripts.length === 0 && (
                <p className="text-white/20 text-sm italic">Waiting for The Architect to speak...</p>
              )}
              {transcripts.map((msg, idx) => (
                <div key={idx} className={`text-sm ${msg.speaker === 'USER' ? 'text-cyan-300' : msg.speaker === 'SYSTEM' ? 'text-amber-400/60' : 'text-white/80'}`}>
                  <span className="font-bold text-white/40 mr-2">{msg.speaker === 'USER' ? 'You' : msg.speaker === 'SYSTEM' ? 'SYS' : 'Architect'}:</span>
                  {msg.text}
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              {!isConnected ? (
                <button
                  onClick={startSession}
                  className="flex-1 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-black font-bold rounded-lg transition-all"
                >
                  Start Conversation
                </button>
              ) : (
                <button
                  onClick={() => { setPageState('UPLOAD'); }}
                  className="flex-1 px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-medium rounded-lg transition-all border border-white/20"
                >
                  Ready to Upload Image &rarr;
                </button>
              )}
            </div>

            {characterLore && (
              <div className="text-xs text-cyan-400/60 text-center animate-pulse">
                Character lore captured! Ready to move on.
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // --- UPLOAD STATE ---
  if (pageState === 'UPLOAD') {
    return (
      <main className="relative w-screen h-screen bg-black overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute top-6 left-6 z-50">
          <button
            onClick={() => setPageState('INTERVIEW')}
            className="px-4 py-2 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            &larr; Back to Interview
          </button>
        </div>
        <div className="absolute top-6 right-6 z-50">
          <LoginButton />
        </div>

        <div className="relative z-10 w-full max-w-2xl px-6">
          {/* Character summary card */}
          {characterLore && (
            <div className="mb-8 p-6 border border-cyan-500/30 rounded-xl bg-black/50">
              <h3 className="text-sm text-cyan-400/60 uppercase tracking-widest mb-2">Character Captured</h3>
              <p className="text-2xl text-white font-bold mb-3">{characterLore.archetype}</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {characterLore.traits.map((trait, i) => (
                  <span key={i} className="px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-xs text-cyan-300">
                    {trait}
                  </span>
                ))}
              </div>
              <p className="text-sm text-white/50 italic">&quot;{characterLore.backstory}&quot;</p>
            </div>
          )}

          <h2 className="text-3xl font-bold text-white text-center mb-2">
            Now show me what they look like
          </h2>
          <p className="text-white/40 text-center mb-8">
            Upload an image of your character to bring them into 3D
          </p>

          <DropZone onAwaken={handleUploadComplete} />
        </div>
      </main>
    );
  }

  // --- REDIRECT STATE ---
  return (
    <main className="w-screen h-screen bg-black flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400 mx-auto mb-4" />
        <p className="text-white/40 text-sm">Entering the workspace...</p>
      </div>
    </main>
  );
}
