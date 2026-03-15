'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, functions, db } from '@/lib/firebase';
import { getUserTier, getTierLimits } from '@/lib/userTier';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { ARCHITECT_CONFIG } from '@/lib/agents/architect';
import { DropZone } from '@/components/ui/DropZone';
import { LoginButton } from '@/components/ui/LoginButton';
import { StepIndicator } from '@/components/ui/StepIndicator';
import type { AnimationState } from '@/components/3d/Avatar';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

type LandingState = 'LANDING' | 'INTERVIEW' | 'REDIRECT';

const DEMO_MODELS = [
  { url: '/leo.glb', label: 'KANE', voiceName: 'Fenrir', facingRotationY: -Math.PI / 2 },
  { url: '/WOW.glb', label: 'WOW', voiceName: 'Aoede', facingRotationY: -Math.PI / 2 },
] as const;

interface CharacterLore {
  archetype: string;
  traits: string[];
  backstory: string;
  personality_summary: string;
  key_facts: string[];
  characterName: string;
  voiceGender: string;
}

// Manifesto principles — surfaced on the landing page
const PRINCIPLES = [
  {
    title: 'Characters With Souls',
    desc: 'Every agent has an archetype, a history, and a voice that belongs to them alone. They are not waiting for commands. They are entities with opinions, memories, and presence.',
  },
  {
    title: 'Voice Carries Emotion',
    desc: 'Real-time voice is the bridge between human intention and true understanding. Tone, rhythm, and feeling carry meaning that text alone cannot.',
  },
  {
    title: 'The Screen Delivers',
    desc: '3D avatars that breathe. Generated images that manifest from conversation. A spatial workspace of floating artifacts born from dialogue.',
  },
  {
    title: 'Memory Makes Identity',
    desc: 'An agent without memory is a stranger every time you meet. LXXI agents remember conversations, preferences, past work, and the stories you have built together.',
  },
  {
    title: 'The Forge Never Closes',
    desc: 'Creation is not a one-time event. Your partner evolves through every conversation, gains new memory, and generates new artifacts. Every session adds another layer.',
  },
] as const;

export default function LandingPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<LandingState>('LANDING');
  const [characterLore, setCharacterLore] = useState<CharacterLore | null>(null);
  const [newAgentId, setNewAgentId] = useState<string | null>(null);
  const [demoModelIdx, setDemoModelIdx] = useState(1); // WOW = default
  const [uploadReady, setUploadReady] = useState(false);
  const [imageUploaded, setImageUploaded] = useState(false);
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [extrusionComplete, setExtrusionComplete] = useState(false);

  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const pendingVoiceRestartRef = useRef(false);

  // State-tracking refs for Architect context awareness
  const sendContextRef = useRef<((text: string, attachments: any[]) => boolean) | null>(null);
  const imageUploadNotifiedRef = useRef(false);
  const loreSavedNotifiedRef = useRef(false);
  const extrusionStatusNotifiedRef = useRef<string>('');
  const extrusionUnsubRef = useRef<(() => void) | null>(null);
  const imageUploadedRef = useRef(false);     // mirror for callback access
  const isGenerating3DRef = useRef(false);    // mirror for callback access

  // Handle the save_new_agent_lore tool callback from Architect
  const handleArchitectToolCallback = useCallback(async (toolName: string, args: any) => {
    if (toolName === 'save_new_agent_lore') {
      const lore: CharacterLore = {
        archetype: args.archetype || 'Unknown Entity',
        traits: args.traits || [],
        backstory: args.backstory || '',
        personality_summary: args.personality_summary || '',
        key_facts: args.key_facts || [],
        characterName: args.character_name || '',
        voiceGender: args.voice_gender || 'female'
      };
      setCharacterLore(lore);
      setUploadReady(true);

      const userId = auth.currentUser?.uid;
      if (userId) {
        const agentId = `agent_${Date.now()}`;
        setNewAgentId(agentId);
        try {
          await setDoc(doc(db, `users/${userId}/agents/${agentId}`), {
            archetype: lore.archetype,
            traits: lore.traits,
            funFact: lore.backstory,
            characterName: lore.characterName,
            voiceName: lore.voiceGender === 'male' ? 'Fenrir' : 'Aoede',
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

      // Notify Architect that lore has been saved
      if (!loreSavedNotifiedRef.current && sendContextRef.current) {
        loreSavedNotifiedRef.current = true;
        const hasImage = imageUploadedRef.current || isGenerating3DRef.current;
        if (hasImage) {
          sendContextRef.current(
            '[SYSTEM: Lore saved. The character soul has been captured and saved. The image is already uploaded and 3D is being generated. Keep the conversation going naturally until 3D is complete.]',
            []
          );
        } else {
          sendContextRef.current(
            '[SYSTEM: Lore saved. The character soul has been captured and saved. BUT the user has NOT uploaded an image yet. Recommend they upload a full-body image using the upload area in the right-hand corner of the screen. Full body works best.]',
            []
          );
        }
      }
    }
  }, []);

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
    transcripts,
    sendContext
  } = useGeminiLive('architect_demo', auth.currentUser?.uid || 'anonymous', 'demo', architectConfig);

  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);
    if (!isConnected) { setAnimationState('idle'); return; }
    animTimerRef.current = setInterval(() => {
      const vol = volumeRef.current?.volume || 0;
      setAnimationState(vol > 0.05 ? 'speaking' : 'idle');
    }, 250);
    return () => { if (animTimerRef.current) clearInterval(animTimerRef.current); };
  }, [isConnected, volumeRef]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  useEffect(() => {
    if (pendingVoiceRestartRef.current && !isConnected && pageState === 'INTERVIEW') {
      pendingVoiceRestartRef.current = false;
      const timer = setTimeout(() => startSession(), 500);
      return () => clearTimeout(timer);
    }
  }, [isConnected, pageState, startSession]);

  // Keep refs in sync for callback access
  useEffect(() => { sendContextRef.current = sendContext; }, [sendContext]);
  useEffect(() => { imageUploadedRef.current = imageUploaded; }, [imageUploaded]);
  useEffect(() => { isGenerating3DRef.current = isGenerating3D; }, [isGenerating3D]);

  // Firestore listener for 3D generation progress — sends status updates to Architect
  useEffect(() => {
    const userId = auth.currentUser?.uid;
    if (!userId || !newAgentId || !isGenerating3D) return;

    if (extrusionUnsubRef.current) extrusionUnsubRef.current();

    const unsub = onSnapshot(
      doc(db, `users/${userId}/agents/${newAgentId}`),
      (docSnapshot) => {
        if (!docSnapshot.exists()) return;
        const data = docSnapshot.data();
        const status = data.extrusionStatus as string;

        if (status === 'complete') {
          setExtrusionComplete(true);
        }

        if (status && status !== extrusionStatusNotifiedRef.current) {
          extrusionStatusNotifiedRef.current = status;

          const statusMessages: Record<string, string> = {
            generating: '[SYSTEM: 3D status: generating. The 3D model is being generated from the uploaded image. Keep building the soul.]',
            rigging: '[SYSTEM: 3D status: rigging. The 3D model is now being rigged with a skeleton for animation. Give the user a quick update.]',
            animating: '[SYSTEM: 3D status: animating. Animation is being applied to the 3D model. Almost done! Let the user know.]',
            complete: '[SYSTEM: 3D status: complete. The 3D model is fully generated, rigged, and animated. If lore has already been saved, tell the user they can hit "Enter Workspace" to meet their character — it has been a pleasure building with them. If lore is NOT saved yet, keep the interview going.]',
            error: `[SYSTEM: 3D status: error. There was a problem generating the 3D model: ${data.extrusionError || 'Unknown error'}. Suggest the user try a different image.]`,
          };

          const message = statusMessages[status];
          if (message && sendContextRef.current) {
            sendContextRef.current(message, []);
          }
        }
      },
      (err) => {
        console.error('[FORGE] Firestore extrusion listener error:', err);
      }
    );

    extrusionUnsubRef.current = unsub;
    return () => unsub();
  }, [newAgentId, isGenerating3D]);

  const handleBeginInterview = async () => {
    if (!auth.currentUser) {
      alert("Please log in first to begin your creation.");
      return;
    }

    // Check Forge character limit for non-admin users
    const tier = getUserTier(auth.currentUser.email, true);
    const forgeLimits = getTierLimits(tier);
    if (forgeLimits.forgeLimit > 0) {
      try {
        const agentsRef = collection(db, `users/${auth.currentUser.uid}/agents`);
        const q = query(agentsRef, where('extrusionStatus', '==', 'complete'));
        const snapshot = await getDocs(q);
        if (snapshot.size >= forgeLimits.forgeLimit) {
          alert(`You've reached your character limit (${forgeLimits.forgeLimit}). Contact the team for expanded access.`);
          return;
        }
      } catch (e) {
        console.warn("[FORGE] Could not check agent count:", e);
        // Allow through on error — don't block creation due to Firestore issues
      }
    }

    setPageState('INTERVIEW');
    setTimeout(() => startSession(), 300);
  };

  const handleUploadComplete = async (data: any) => {
    if (!auth.currentUser) return;
    const agentId = newAgentId || `agent_${Date.now()}`;
    if (!newAgentId) setNewAgentId(agentId);
    setImageUploaded(true);
    setIsGenerating3D(true);

    // Notify Architect about the image upload
    if (!imageUploadNotifiedRef.current && sendContextRef.current) {
      imageUploadNotifiedRef.current = true;
      sendContextRef.current(
        '[SYSTEM: Image uploaded. The user has uploaded a character image and 3D generation is starting. Acknowledge this warmly and keep building the soul.]',
        []
      );
    }

    if (!characterLore) {
      try {
        await setDoc(doc(db, `users/${auth.currentUser.uid}/agents/${agentId}`), {
          archetype: 'Unknown Entity', traits: [], funFact: '',
          extrusionStatus: 'pending', createdAt: serverTimestamp()
        });
      } catch (err) {
        console.error("[LANDING] Failed to create agent doc:", err);
      }
    }

    try {
      const enqueue3DTask = httpsCallable(functions, 'enqueue3DTask');
      if (data.type === 'image') {
        await enqueue3DTask({ imageBase64: data.base64, agentId });
      }
    } catch (error) {
      console.error("[LANDING] Failed to trigger 3D generation:", error);
      setIsGenerating3D(false);
    }
  };

  const handleGoToWorkspace = () => {
    const agentId = newAgentId || '';
    stopSession();
    setPageState('REDIRECT');
    router.push(`/workspace?agentId=${agentId}`);
  };

  const currentStep: 1 | 2 | 3 = isGenerating3D ? 3 : imageUploaded ? 2 : characterLore ? 2 : 1;

  // =====================================================================
  //  LANDING STATE — Hero + Manifesto + Two Paths
  // =====================================================================
  if (pageState === 'LANDING') {
    return (
      <main className="relative w-screen min-h-screen overflow-y-auto overflow-x-hidden flex flex-col"
            style={{ backgroundColor: '#050505' }}>

        {/* Ambient glow — absolute so it doesn't block scroll */}
        <div className="absolute inset-0 pointer-events-none z-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(212,175,55,0.05)_0%,transparent_60%)]" />
        </div>

        {/* Top bar */}
        <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4"
             style={{ backgroundColor: 'rgba(5,5,5,0.8)', backdropFilter: 'blur(12px)' }}>
          <img src="/lxxi-logo.png" alt="LXXI" className="h-6 mix-blend-screen" />
          <LoginButton onLogout={() => { setPageState('LANDING'); }} />
        </div>

        {/* ── HERO ── */}
        <section className="relative z-10 flex flex-col items-center pt-16 pb-20 px-6 text-center">
          <img src="/lxxi-logo.png" alt="LXXI" className="h-28 md:h-40 mix-blend-screen mb-4" />
          <h1 className="text-xs md:text-sm tracking-[0.3em] uppercase text-white/30 font-mono mb-3">
            Your Memory. Your Partner. Presence in Every Dimension.
          </h1>
          <p className="text-lg md:text-xl text-white/50 font-light max-w-md leading-relaxed">
            Voice is for Vibe. Screen is for Substance.
          </p>
          <p className="text-sm text-white/25 mt-3 max-w-lg leading-relaxed">
            LXXI closes the gap between solo and entrepreneurial. A partner that never disconnects.
            Live vision, true memory, and a spatial workspace that sees you, knows you, and builds with you. Forever.
          </p>
        </section>

        {/* ── TWO PATHS: Prime & Spark ── */}
        <section className="relative z-10 max-w-5xl mx-auto w-full px-6 pb-20">
          <div className="grid md:grid-cols-2 gap-5 items-stretch">

            {/* PRIME — The Forge */}
            <div className="group relative rounded-2xl border border-[#d4af37]/20 p-8 transition-all hover:border-[#d4af37]/40 flex flex-col"
                 style={{ backgroundColor: 'rgba(212,175,55,0.03)' }}>
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(212,175,55,0.06)_0%,transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10 flex flex-col flex-1">
                <span className="text-[10px] tracking-[0.3em] uppercase text-[#d4af37]/50 font-mono">Prime</span>
                <h2 className="text-2xl font-bold text-white mt-1 mb-3">The Forge</h2>
                <p className="text-sm text-white/40 leading-relaxed mb-4">
                  Build a partner with a soul. Speak to The Architect to shape your agent&apos;s personality,
                  history, and voice. Upload an image to generate their 3D avatar. Then enter the spatial
                  workspace where your partner sees your world through your camera, remembers everything
                  you have built together, and works alongside you in real time.
                </p>
                <p className="text-xs text-white/25 leading-relaxed mb-6 italic">
                  A trial lawyer loads a judge&apos;s complete ruling history and argues their upcoming case out loud.
                  A clothing designer holds fabric samples to the camera and watches generated designs appear instantly.
                  A founder thinks out loud and builds with someone who is fully present and never starts from zero.
                </p>

                <div className="space-y-2.5 mb-8">
                  <div className="flex items-start gap-3">
                    <span className="text-[#d4af37] text-sm mt-0.5">1.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Describe</span> — Speak to The Architect. Define who your partner is, what they know, and how they think.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[#d4af37] text-sm mt-0.5">2.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Upload</span> — Give them a face. Drop an image to generate a 3D avatar with presence and personality.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-[#d4af37] text-sm mt-0.5">3.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Create</span> — Enter the workspace. Your partner sees your world, remembers your history, and builds alongside you from day one.</p>
                  </div>
                </div>

                <div className="mt-auto pt-4">
                  <button
                    onClick={handleBeginInterview}
                    className="w-full py-3.5 text-black font-bold text-sm rounded-lg transition-all"
                    style={{ backgroundColor: '#d4af37', boxShadow: '0 0 25px rgba(212,175,55,0.25)' }}
                  >
                    Enter the Forge
                  </button>
                </div>
                <button
                  onClick={() => router.push('/workspace')}
                  className="w-full mt-2 py-1.5 text-[10px] text-white/20 hover:text-white/40 transition-colors text-center"
                >
                  Skip to Workspace (demo)
                </button>
              </div>
            </div>

            {/* SPARK — Leo's Learning Lab */}
            <div className="group relative rounded-2xl border border-amber-400/15 p-8 transition-all hover:border-amber-400/30 flex flex-col"
                 style={{ backgroundColor: 'rgba(251,191,36,0.02)' }}>
              <div className="absolute inset-0 rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(251,191,36,0.05)_0%,transparent_70%)] opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative z-10 flex flex-col flex-1">
                <span className="text-[10px] tracking-[0.3em] uppercase text-amber-400/50 font-mono">Spark</span>
                <h2 className="text-2xl font-bold text-white mt-1 mb-3">Leo&apos;s Learning Lab</h2>
                <p className="text-sm text-white/40 leading-relaxed mb-6">
                  A persistent learning partner for students and curious minds. Leo uses live voice
                  conversation and a visual chalkboard to teach math, science, Spanish, and anything
                  you want to explore. He remembers your learning journey, adapts to your pace, and grows
                  smarter about how you think the longer you work together.
                </p>

                <div className="space-y-2.5 mb-8">
                  <div className="flex items-start gap-3">
                    <span className="text-amber-400 text-sm mt-0.5">1.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Voice-first learning</span> — Talk through problems the way you would with a real tutor who knows your history.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-amber-400 text-sm mt-0.5">2.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Visual chalkboard</span> — Watch math problems, hints, and explanations appear live as you speak.</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <span className="text-amber-400 text-sm mt-0.5">3.</span>
                    <p className="text-xs text-white/35 leading-relaxed"><span className="text-white/60 font-medium">Any subject, any pace</span> — Math, science, language, or pure curiosity. Leo remembers where you left off.</p>
                  </div>
                </div>

                <div className="mt-auto pt-4">
                  <button
                    onClick={() => router.push('/spark')}
                    className="w-full py-3.5 font-bold text-sm rounded-lg transition-all text-black"
                    style={{ backgroundColor: '#d4af37', boxShadow: '0 0 25px rgba(212,175,55,0.25)' }}
                  >
                    Start Learning
                  </button>
                </div>
                {/* Spacer to match Forge card which has a "Skip" link below */}
                <div className="mt-2 py-1.5 text-[10px] invisible">spacer</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── MANIFESTO PRINCIPLES ── */}
        <section className="relative z-10 max-w-4xl mx-auto w-full px-6 pb-20">
          <div className="text-center mb-10">
            <p className="text-[10px] tracking-[0.4em] uppercase text-[#d4af37]/40 font-mono mb-2">
              The Manifesto
            </p>
            <h2 className="text-2xl md:text-3xl font-bold text-white/80">
              What We Believe
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            {PRINCIPLES.map((p, i) => (
              <div key={i} className={`p-5 rounded-xl border border-white/5 bg-white/[0.02] ${i === 4 ? 'sm:col-span-2' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="text-[#d4af37]/40 text-xs font-bold mt-1 flex-shrink-0">{i < 4 ? `0${i + 1}` : 'V.'}</span>
                  <div>
                    <h3 className="text-sm font-bold text-white/70 mb-1">{p.title}</h3>
                    <p className="text-xs text-white/30 leading-relaxed">{p.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <button
              onClick={() => router.push('/manifesto')}
              className="text-xs text-white/20 hover:text-[#d4af37]/60 transition-colors tracking-widest uppercase"
            >
              Read the Full Manifesto &rarr;
            </button>
          </div>
        </section>

        {/* Bottom line */}
        <div className="h-px bg-gradient-to-r from-transparent via-[#d4af37]/15 to-transparent" />
      </main>
    );
  }

  // =====================================================================
  //  INTERVIEW STATE — Clean, no hint arrows
  // =====================================================================
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
            {isGenerating3D && (characterLore || extrusionComplete) && (
              <button
                onClick={handleGoToWorkspace}
                className={`px-4 py-1.5 text-xs font-bold rounded transition-colors ${
                  extrusionComplete
                    ? 'bg-[#d4af37] text-black hover:bg-[#c9a030] animate-pulse'
                    : 'bg-[#d4af37] text-black hover:bg-[#c9a030]'
                }`}
              >
                Enter Workspace &rarr;
              </button>
            )}
            <LoginButton onLogout={() => { stopSession(); setPageState('LANDING'); }} />
          </div>
        </div>

        {/* Main content: avatar center with sidebars */}
        <div className="flex-1 flex items-stretch px-3 pb-3 gap-3 overflow-hidden">

          {/* LEFT: Transcript + Controls */}
          <div className="w-72 flex flex-col gap-2 flex-shrink-0">
            <div className="text-xs text-[#d4af37]/50 flex items-center gap-2 px-1">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-[#d4af37] animate-pulse' : 'bg-gray-600'}`} />
              THE ARCHITECT {isConnected ? '// LISTENING' : '// STANDBY'}
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto border border-white/10 rounded-lg bg-black/30 p-3 space-y-2 min-h-0">
              {transcripts.length === 0 && (
                <p className="text-white/30 text-xs leading-relaxed">
                  The Architect will guide you. Speak naturally &mdash; describe who your character is, their world, and what makes them unique.
                </p>
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

          {/* CENTER: 3D Avatar */}
          <div className="flex-1 relative rounded-xl overflow-hidden border border-[#d4af37]/10 bg-black/40">
            {/* Demo model toggle */}
            <div className="absolute top-3 right-3 z-10 flex gap-1">
              {DEMO_MODELS.map((m, i) => (
                <button
                  key={m.label}
                  onClick={() => {
                    if (i === demoModelIdx) return;
                    setDemoModelIdx(i);
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
              <Scene modelUrl={DEMO_MODELS[demoModelIdx].url} volumeRef={volumeRef} animationState={animationState} facingRotationY={DEMO_MODELS[demoModelIdx].facingRotationY} cameraPosition={[0, 0.3, 2.2]} cameraTarget={[0, -0.15, 0]} />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.15)_50%)] bg-[length:100%_4px] opacity-10" />
          </div>

          {/* RIGHT: Upload + Soul Building */}
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

              {characterLore && (
                <div className="p-2 border border-[#d4af37]/20 rounded-lg bg-[#d4af37]/[0.03] mb-2">
                  {characterLore.characterName && (
                    <p className="text-sm text-[#d4af37] font-bold mb-0.5">{characterLore.characterName}</p>
                  )}
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

              {isGenerating3D && extrusionComplete ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="text-[#d4af37] text-3xl">&#10003;</div>
                  <p className="text-[11px] text-[#d4af37] font-mono font-bold">3D Avatar Ready!</p>
                  <p className="text-[9px] text-white/40">Hit &quot;Enter Workspace&quot; to meet your character</p>
                </div>
              ) : isGenerating3D ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#d4af37]" />
                  <p className="text-[11px] text-[#d4af37]/60 font-mono">Synthesizing 3D DNA...</p>
                  <p className="text-[9px] text-white/25">Keep talking — build your soul while we work</p>
                </div>
              ) : imageUploaded ? (
                <div className="flex flex-col items-center gap-2 py-3">
                  <div className="text-[#d4af37] text-xl">&#10003;</div>
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

            {/* Soul Building Guide */}
            <div className="flex-1 overflow-y-auto rounded-xl p-3 border border-white/5 bg-black/20 min-h-0">
              <h3 className="text-[10px] text-[#d4af37]/40 uppercase tracking-widest font-mono mb-3">
                Build Your Soul
              </h3>
              <p className="text-[10px] text-white/25 mb-3 leading-relaxed">
                The best AI agents feel like teammates. Here&apos;s how to create depth:
              </p>
              <div className="space-y-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-[#d4af37]/30 text-[10px] font-bold mt-0.5">1.</span>
                  <div>
                    <p className="text-[11px] text-white/50 font-medium leading-tight">Give them a memory</p>
                    <p className="text-[9px] text-white/20 leading-relaxed mt-0.5">Share a story from their past. Memories shape personality.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#d4af37]/30 text-[10px] font-bold mt-0.5">2.</span>
                  <div>
                    <p className="text-[11px] text-white/50 font-medium leading-tight">Define their voice</p>
                    <p className="text-[9px] text-white/20 leading-relaxed mt-0.5">How do they speak? Formal? Playful? Give examples.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#d4af37]/30 text-[10px] font-bold mt-0.5">3.</span>
                  <div>
                    <p className="text-[11px] text-white/50 font-medium leading-tight">Set boundaries</p>
                    <p className="text-[9px] text-white/20 leading-relaxed mt-0.5">What topics matter? What do they avoid? Boundaries create depth.</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-[#d4af37]/30 text-[10px] font-bold mt-0.5">4.</span>
                  <div>
                    <p className="text-[11px] text-white/50 font-medium leading-tight">Build the relationship</p>
                    <p className="text-[9px] text-white/20 leading-relaxed mt-0.5">How does your character see you? Partners? Mentor and student?</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Go to workspace button — shows when lore saved OR 3D complete */}
            {isGenerating3D && (characterLore || extrusionComplete) && (
              <button
                onClick={handleGoToWorkspace}
                className={`w-full px-4 py-2.5 text-black font-bold text-sm rounded-lg transition-all ${extrusionComplete ? 'animate-pulse' : ''}`}
                style={{ backgroundColor: '#d4af37', boxShadow: '0 0 15px rgba(212,175,55,0.25)' }}
              >
                Enter Workspace &rarr;
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  // =====================================================================
  //  REDIRECT STATE
  // =====================================================================
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
