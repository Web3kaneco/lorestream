'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { HintArrow } from '@/components/ui/HintArrow';
import { StepIndicator } from '@/components/ui/StepIndicator';
import { AgentLibrary } from '@/components/AgentLibrary';
import type { AnimationState } from '@/components/3d/Avatar';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

type LandingState = 'LANDING' | 'INTERVIEW' | 'REDIRECT';

const DEMO_MODELS = [
  { url: '/kanecov1.glb', label: 'KANE', voiceName: 'Fenrir' },
  { url: '/WOW.glb', label: 'WOW', voiceName: 'Aoede' },
] as const;

interface CharacterLore {
  archetype: string;
  traits: string[];
  backstory: string;
  personality_summary: string;
  key_facts: string[];
}

// Soul-building tips shown in the upload sidebar
const SOUL_TIPS = [
  { title: 'Give them a memory', desc: 'Tell The Architect a story from your character\'s past. Memories shape personality.' },
  { title: 'Define their voice', desc: 'How do they speak? Formal? Playful? Give examples of phrases they\'d use.' },
  { title: 'Set boundaries', desc: 'What topics matter to them? What do they avoid? Boundaries create depth.' },
  { title: 'Build the relationship', desc: 'Explain how your character sees YOU. Are you partners? Student and mentor?' },
] as const;

export default function LandingPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<LandingState>('LANDING');
  const [characterLore, setCharacterLore] = useState<CharacterLore | null>(null);
  const [newAgentId, setNewAgentId] = useState<string | null>(null);
  const [showVault, setShowVault] = useState(false);
  const [demoModelIdx, setDemoModelIdx] = useState(1); // WOW = default (female voice + mouth morphs)
  const [uploadReady, setUploadReady] = useState(false);
  const [imageUploaded, setImageUploaded] = useState(false);
  const [isGenerating3D, setIsGenerating3D] = useState(false);

  // Derive animationState from connection + volume
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const pendingVoiceRestartRef = useRef(false);

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
      setUploadReady(true);

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
    }
  }, []);

  // Architect config with callback + per-model voice
  const architectConfig = useMemo(() => ({
    ...ARCHITECT_CONFIG,
    voiceName: DEMO_MODELS[demoModelIdx].voiceName,
    onToolCallback: handleArchitectToolCallback
  }), [handleArchitectToolCallback, demoModelIdx]);

  const {
    isConnected,
    startSession,
    stopSession,
    volumeRef,
    transcripts
  } = useGeminiLive('architect_demo', auth.currentUser?.uid || 'anonymous', architectConfig);

  // Poll volumeRef at 4Hz to derive animationState (ref can't trigger re-renders)
  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);

    if (!isConnected) {
      setAnimationState('idle');
      return;
    }

    animTimerRef.current = setInterval(() => {
      const vol = volumeRef.current?.volume || 0;
      setAnimationState(vol > 0.05 ? 'speaking' : 'idle');
    }, 250);

    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [isConnected, volumeRef]);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  // Auto-restart session after model switch (for voice change)
  // Gemini Live voice is set during WebSocket setup — can't change mid-session.
  // So we stop + restart the session when the user switches models.
  useEffect(() => {
    if (pendingVoiceRestartRef.current && !isConnected && pageState === 'INTERVIEW') {
      pendingVoiceRestartRef.current = false;
      const timer = setTimeout(() => startSession(), 500);
      return () => clearTimeout(timer);
    }
  }, [isConnected, pageState, startSession]);

  const handleBeginInterview = async () => {
    if (!auth.currentUser) {
      alert("Please log in first to begin your creation.");
      return;
    }
    setPageState('INTERVIEW');
    setTimeout(() => startSession(), 300);
  };

  // Upload triggers 3D generation but does NOT redirect — user stays to keep building soul
  const handleUploadComplete = async (data: any) => {
    if (!auth.currentUser) return;

    const agentId = newAgentId || `agent_${Date.now()}`;
    if (!newAgentId) setNewAgentId(agentId);

    setImageUploaded(true);
    setIsGenerating3D(true);

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

    // Trigger 3D generation in background
    try {
      const enqueue3DTask = httpsCallable(functions, 'enqueue3DTask');
      if (data.type === 'image') {
        await enqueue3DTask({ imageBase64: data.base64, agentId });
      }
    } catch (error) {
      console.error("[LANDING] Failed to trigger 3D generation:", error);
      setIsGenerating3D(false);
      return;
    }

    // DON'T redirect — let the user keep talking to The Architect
  };

  const handleGoToWorkspace = () => {
    const agentId = newAgentId || '';
    stopSession();
    setPageState('REDIRECT');
    router.push(`/workspace?agentId=${agentId}`);
  };

  // Derive current step for StepIndicator
  const currentStep: 1 | 2 | 3 = isGenerating3D ? 3 : imageUploaded ? 2 : characterLore ? 2 : 1;

  // --- LANDING STATE ---
  if (pageState === 'LANDING') {
    return (
      <main className="relative w-screen h-screen overflow-hidden flex flex-col items-center justify-center"
            style={{ backgroundColor: '#050505' }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.06)_0%,transparent_70%)] animate-pulse" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.03)_0%,transparent_50%)]" />

        <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
          <ModeSwitcher />
          <LoginButton />
        </div>

        {showVault ? (
          <div className="relative z-10 w-full max-w-4xl px-6">
            <button
              onClick={() => setShowVault(false)}
              className="text-sm text-white/40 hover:text-white/70 transition-colors mb-4"
            >
              &larr; Back
            </button>
            <AgentLibrary
              userId={auth.currentUser?.uid || ''}
              onSelectAgent={(agentId) => {
                router.push(`/workspace?agentId=${agentId}`);
              }}
            />
          </div>
        ) : (
          <div className="relative z-10 text-center max-w-2xl px-6">
            <h1 className="text-7xl md:text-8xl font-bold text-white mb-1 tracking-tight"
                style={{ fontFamily: 'var(--font-heading)' }}>
              LXXI
            </h1>
            <p className="text-xs tracking-[0.3em] uppercase text-white/30 mb-2">
              Seventy-One
            </p>
            <p className="text-base text-white/40 mb-14 font-light italic">
              Voice is for Vibe &middot; Screen is for Substance
            </p>

            <div className="relative inline-block">
              <HintArrow
                text="Start here — describe your character with voice"
                direction="down"
                dismissKey="hint_forge_arrow"
                className="absolute -top-14 left-1/2 -translate-x-1/2"
              />
              <button
                onClick={handleBeginInterview}
                className="group relative px-10 py-4 text-black font-bold text-lg rounded-lg transition-all"
                style={{
                  backgroundColor: '#d4af37',
                  boxShadow: '0 0 30px rgba(212,175,55,0.3)'
                }}
              >
                Enter the Forge
                <span className="absolute inset-0 rounded-lg bg-[#d4af37]/20 animate-ping opacity-20 group-hover:opacity-0" />
              </button>
              <p className="text-[11px] text-white/25 mt-2 font-mono">
                Create a character through voice conversation
              </p>
            </div>

            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                onClick={() => router.push('/manifesto')}
                className="text-sm text-white/50 hover:text-[#d4af37] transition-colors tracking-[0.15em] uppercase"
              >
                Read the Manifesto
              </button>
              <button
                onClick={() => router.push('/workspace')}
                className="text-sm text-white/25 hover:text-[#d4af37]/60 transition-colors"
              >
                Skip to Workspace &rarr;
                <span className="block text-[10px] text-white/15 mt-0.5">Browse existing characters</span>
              </button>
              {auth.currentUser && (
                <button
                  onClick={() => setShowVault(true)}
                  className="text-sm text-white/25 hover:text-[#d4af37]/60 transition-colors"
                >
                  Open the Vault &rarr;
                  <span className="block text-[10px] text-white/15 mt-0.5">View your creations</span>
                </button>
              )}
            </div>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#d4af37]/20 to-transparent" />
      </main>
    );
  }

  // --- INTERVIEW STATE (merged with Upload — user stays here) ---
  if (pageState === 'INTERVIEW') {
    return (
      <main className="relative w-screen h-screen overflow-hidden flex flex-col"
            style={{ backgroundColor: '#050505' }}>
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 z-50">
          <button
            onClick={() => { stopSession(); setPageState('LANDING'); }}
            className="px-3 py-1.5 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            &larr; Back
          </button>

          <StepIndicator currentStep={currentStep} />

          <div className="flex items-center gap-3">
            {isGenerating3D && (
              <button
                onClick={handleGoToWorkspace}
                className="px-4 py-1.5 text-xs font-bold rounded bg-[#d4af37] text-black hover:bg-[#c9a030] transition-colors"
              >
                Enter Workspace &rarr;
              </button>
            )}
            <LoginButton />
          </div>
        </div>

        {/* Main content: centered avatar with sidebars */}
        <div className="flex-1 flex items-stretch px-3 pb-3 gap-3 overflow-hidden">

          {/* LEFT SIDEBAR: Transcript + Controls */}
          <div className="w-72 flex flex-col gap-2 flex-shrink-0">
            <div className="text-xs text-[#d4af37]/50 flex items-center gap-2 px-1">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#d4af37] animate-pulse' : 'bg-gray-600'}`} />
              THE ARCHITECT {isConnected ? '// LISTENING' : '// STANDBY'}
            </div>

            {/* Voice Orb (shows when no 3D model visible on mobile) */}
            <div className="md:hidden">
              <VoiceOrb volumeRef={volumeRef} isActive={isConnected} />
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto border border-white/10 rounded-lg bg-black/30 p-3 space-y-2 min-h-0">
              {transcripts.length === 0 && (
                <div className="space-y-3">
                  <p className="text-white/30 text-xs leading-relaxed">
                    The Architect will ask about your character. Speak naturally &mdash; describe who they are, their world, and what makes them unique.
                  </p>
                  <HintArrow
                    text="Your conversation appears here"
                    direction="down"
                    dismissKey="hint_transcript"
                    className="mx-auto"
                  />
                </div>
              )}
              {transcripts.map((msg, idx) => (
                <div key={idx} className={`text-xs leading-relaxed ${msg.speaker === 'USER' ? 'text-[#d4af37]' : msg.speaker === 'SYSTEM' ? 'text-amber-400/60' : 'text-white/70'}`}>
                  <span className="font-bold text-white/40 mr-1.5">{msg.speaker === 'USER' ? 'You' : msg.speaker === 'SYSTEM' ? 'SYS' : 'Architect'}:</span>
                  {msg.text}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              {!isConnected ? (
                <button
                  onClick={startSession}
                  className="flex-1 px-4 py-2.5 text-black font-bold text-sm rounded-lg transition-all"
                  style={{ backgroundColor: '#d4af37' }}
                >
                  Start Conversation
                </button>
              ) : (
                <button
                  onClick={stopSession}
                  className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white/60 font-medium rounded-lg transition-all border border-white/10 text-xs"
                >
                  End Conversation
                </button>
              )}
            </div>

            {characterLore && (
              <div className="text-[10px] text-[#d4af37]/60 text-center animate-pulse">
                Character lore captured!
              </div>
            )}
          </div>

          {/* CENTER: 3D Avatar — hero, fills available space */}
          <div className="flex-1 relative rounded-xl overflow-hidden border border-[#d4af37]/10 bg-black/40">
            {/* Hint arrow ABOVE avatar */}
            <HintArrow
              text="Meet The Architect — your character guide"
              direction="down"
              dismissKey="hint_architect_avatar"
              className="absolute top-3 left-1/2 -translate-x-1/2 z-10"
            />
            {/* Demo model toggle */}
            <div className="absolute top-3 right-3 z-10 flex gap-1">
              {DEMO_MODELS.map((m, i) => (
                <button
                  key={m.label}
                  onClick={() => {
                    if (i === demoModelIdx) return;
                    setDemoModelIdx(i);
                    // Restart session for voice change — voice is locked at setup time
                    if (isConnected) {
                      pendingVoiceRestartRef.current = true;
                      stopSession();
                    }
                  }}
                  className={`px-3 py-1 text-[10px] font-bold tracking-widest rounded transition-all ${
                    demoModelIdx === i
                      ? 'bg-[#d4af37] text-black'
                      : 'bg-white/5 text-white/30 hover:text-white/60'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <div className="absolute inset-0">
              <Scene modelUrl={DEMO_MODELS[demoModelIdx].url} volumeRef={volumeRef} animationState={animationState} />
            </div>
            {/* Scanline overlay */}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_4px] opacity-10" />
          </div>

          {/* RIGHT SIDEBAR: Upload + Soul Building */}
          <div className="w-64 flex flex-col gap-2 flex-shrink-0">
            {/* Upload section */}
            <div className={`rounded-xl p-3 border transition-all duration-500 ${
              isGenerating3D
                ? 'border-[#d4af37]/40 bg-[#d4af37]/[0.04]'
                : uploadReady
                  ? 'ring-1 ring-[#d4af37]/30 border-white/5 bg-black/30'
                  : 'border-white/5 bg-black/30'
            }`}>
              <h3 className="text-[10px] text-white/30 uppercase tracking-widest font-mono text-center mb-2">
                Character Image
              </h3>

              {/* Character summary card (compact) */}
              {characterLore && (
                <div className="p-2 border border-[#d4af37]/20 rounded-lg bg-[#d4af37]/[0.03] mb-2">
                  <p className="text-xs text-white font-bold mb-1">{characterLore.archetype}</p>
                  <div className="flex flex-wrap gap-1">
                    {characterLore.traits.slice(0, 3).map((trait, i) => (
                      <span key={i} className="px-1.5 py-0.5 bg-[#d4af37]/10 border border-[#d4af37]/20 rounded-full text-[9px] text-[#d4af37]">
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {isGenerating3D ? (
                /* 3D generation in progress — show status */
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#d4af37]" />
                  <p className="text-[11px] text-[#d4af37]/60 font-mono">Synthesizing 3D DNA...</p>
                  <p className="text-[9px] text-white/25">Keep talking — build your soul while we work</p>
                </div>
              ) : imageUploaded ? (
                <div className="flex flex-col items-center gap-2 py-3">
                  <div className="text-[#d4af37] text-xl">✓</div>
                  <p className="text-[10px] text-[#d4af37]/60">Image uploaded</p>
                </div>
              ) : (
                <>
                  <DropZone onAwaken={handleUploadComplete} userId={auth.currentUser?.uid} />
                  <p className="text-[9px] text-white/15 text-center mt-1.5 leading-relaxed">
                    Upload while talking — no need to wait
                  </p>
                </>
              )}
            </div>

            {/* Soul Building Tips */}
            <div className="flex-1 overflow-y-auto rounded-xl p-3 border border-white/5 bg-black/20 min-h-0">
              <h3 className="text-[10px] text-[#d4af37]/40 uppercase tracking-widest font-mono mb-3">
                Build Your Soul
              </h3>
              <p className="text-[10px] text-white/25 mb-3 leading-relaxed">
                The best AI agents feel like teammates. Here&apos;s how to create one with real depth:
              </p>
              <div className="space-y-2.5">
                {SOUL_TIPS.map((tip, i) => (
                  <div key={i} className="group">
                    <div className="flex items-start gap-2">
                      <span className="text-[#d4af37]/30 text-[10px] font-bold mt-0.5 flex-shrink-0">{i + 1}.</span>
                      <div>
                        <p className="text-[11px] text-white/50 font-medium leading-tight">{tip.title}</p>
                        <p className="text-[9px] text-white/20 leading-relaxed mt-0.5">{tip.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Working together section */}
              <div className="mt-4 pt-3 border-t border-white/5">
                <h4 className="text-[10px] text-[#d4af37]/30 uppercase tracking-widest font-mono mb-2">
                  You + AI = Team
                </h4>
                <p className="text-[9px] text-white/20 leading-relaxed">
                  Think of your agent as a creative partner. The more context you give — memories, preferences, communication style — the more they&apos;ll feel like a real collaborator. Memory isn&apos;t just data storage: it&apos;s what makes the relationship grow over time.
                </p>
              </div>
            </div>

            {/* Go to workspace button (appears after 3D generation starts) */}
            {isGenerating3D && (
              <button
                onClick={handleGoToWorkspace}
                className="w-full px-4 py-2.5 text-black font-bold text-sm rounded-lg transition-all"
                style={{
                  backgroundColor: '#d4af37',
                  boxShadow: '0 0 15px rgba(212,175,55,0.25)'
                }}
              >
                Enter Workspace &rarr;
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // --- REDIRECT STATE ---
  return (
    <main className="w-screen h-screen flex items-center justify-center"
          style={{ backgroundColor: '#050505' }}>
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#d4af37] mx-auto mb-4" />
        <p className="text-white/40 text-sm">Entering the workspace...</p>
      </div>
    </main>
  );
}
