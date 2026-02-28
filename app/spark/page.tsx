'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { TUTOR_CONFIG } from '@/lib/agents/tutor';
import { useTheme } from '@/lib/theme';
import { VoiceOrb } from '@/components/ui/VoiceOrb';
import { ChalkboardCard } from '@/components/ui/ChalkboardCard';
import type { AnimationState } from '@/components/3d/Avatar';
import { useGLTF } from '@react-three/drei';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

// Preload tutor model at module load time — instant display when session starts
useGLTF.preload('/WOW.glb');

type Subject = 'general' | 'math' | 'spanish' | 'science';

const SUBJECT_LABELS: Record<Subject, string> = {
  general: 'Ask Anything',
  math: 'Math',
  spanish: 'Spanish',
  science: 'Science'
};

export default function SparkPage() {
  const router = useRouter();
  const { setMode } = useTheme();
  const [subject, setSubject] = useState<Subject>('general');
  const [hasStarted, setHasStarted] = useState(false);
  const [chalkboardItems, setChalkboardItems] = useState<{ problem: string; hint: string; difficulty: 'easy' | 'medium' | 'hard' }[]>([]);
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set spark theme on mount
  useEffect(() => {
    setMode('spark');
  }, [setMode]);

  // Wrap TUTOR_CONFIG with chalkboard callback
  const handleSparkToolCallback = useCallback((toolName: string, args: any) => {
    if (toolName === 'displayChalkboard') {
      setChalkboardItems(prev => [...prev, args]);
    }
  }, []);

  const sparkConfig = useMemo(() => ({
    ...TUTOR_CONFIG,
    onToolCallback: handleSparkToolCallback
  }), [handleSparkToolCallback]);

  const {
    isConnected,
    startSession,
    stopSession,
    volumeRef,
    transcripts
  } = useGeminiLive('tutor_demo', 'anonymous', sparkConfig);

  // Poll volumeRef at 4Hz to derive animationState
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

  const handleStart = () => {
    setHasStarted(true);
    startSession();
  };

  const handleEnd = () => {
    stopSession();
    setHasStarted(false);
  };

  const handleBack = () => {
    stopSession();
    setMode('prime');
    router.push('/');
  };

  // Pre-session landing
  if (!hasStarted) {
    return (
      <main className="relative w-screen h-screen overflow-hidden flex flex-col items-center justify-center"
            style={{ backgroundColor: 'var(--bg-primary)', fontFamily: 'var(--font-primary)' }}>

        {/* Top bar */}
        <div className="absolute top-6 left-6 z-50">
          <button onClick={handleBack} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            &larr; Back to LXXI
          </button>
        </div>

        {/* Hero */}
        <div className="relative z-10 text-center max-w-lg px-6">
          <div className="text-6xl mb-4">🦁</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Leo&apos;s Learning Lab
          </h1>
          <p className="text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
            Your friendly AI tutor is ready to help you learn!
          </p>

          {/* Subject pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-8">
            {(Object.keys(SUBJECT_LABELS) as Subject[]).map((s) => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className={`px-5 py-2 rounded-full text-sm font-medium transition-all ${
                  subject === s
                    ? 'text-white shadow-lg'
                    : 'hover:opacity-80'
                }`}
                style={{
                  backgroundColor: subject === s ? 'var(--accent)' : 'var(--bg-panel)',
                  color: subject === s ? '#000' : 'var(--text-secondary)',
                  border: `1px solid ${subject === s ? 'var(--accent)' : 'var(--border)'}`
                }}
              >
                {SUBJECT_LABELS[s]}
              </button>
            ))}
          </div>

          <button
            onClick={handleStart}
            className="px-10 py-4 text-lg font-bold rounded-xl transition-all hover:scale-105 active:scale-95"
            style={{
              backgroundColor: 'var(--accent)',
              color: '#000',
              boxShadow: '0 4px 20px var(--panel-shadow)'
            }}
          >
            Start Learning! 🚀
          </button>
        </div>
      </main>
    );
  }

  // Active tutoring session
  return (
    <main className="relative w-screen h-screen overflow-hidden flex flex-col"
          style={{ backgroundColor: 'var(--bg-primary)', fontFamily: 'var(--font-primary)' }}>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            &larr;
          </button>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            🦁 Leo&apos;s Learning Lab
          </h1>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'animate-pulse' : ''}`}
               style={{ backgroundColor: isConnected ? 'var(--accent)' : 'var(--text-muted)' }} />
        </div>

        <div className="flex items-center gap-3">
          {/* Subject tabs */}
          <div className="hidden md:flex gap-1 p-1 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            {(Object.keys(SUBJECT_LABELS) as Subject[]).map((s) => (
              <button
                key={s}
                onClick={() => setSubject(s)}
                className="px-3 py-1 rounded-md text-xs font-medium transition-all"
                style={{
                  backgroundColor: subject === s ? 'var(--accent)' : 'transparent',
                  color: subject === s ? '#000' : 'var(--text-muted)'
                }}
              >
                {SUBJECT_LABELS[s]}
              </button>
            ))}
          </div>

          <button
            onClick={handleEnd}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all hover:opacity-80"
            style={{
              backgroundColor: 'transparent',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.3)'
            }}
          >
            End Lesson
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left: 3D Avatar */}
        <div className="md:w-2/5 relative min-h-[250px] md:min-h-0 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
          <div className="absolute inset-0">
            <Scene modelUrl="/WOW.glb" volumeRef={volumeRef} animationState={animationState} />
          </div>
          {/* Mobile voice orb fallback */}
          <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2">
            <VoiceOrb volumeRef={volumeRef} isActive={isConnected} />
          </div>
        </div>

        {/* Right: Whiteboard / Content Area */}
        <div className="md:w-3/5 flex flex-col">
          {/* Chalkboard display — latest math problem */}
          {chalkboardItems.length > 0 && (
            <div className="px-6 pt-4">
              <ChalkboardCard {...chalkboardItems[chalkboardItems.length - 1]} />
            </div>
          )}

          {/* Whiteboard panel */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg mx-auto space-y-4">
              {transcripts.length === 0 && chalkboardItems.length === 0 && (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">📚</div>
                  <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                    Leo is getting ready...
                  </p>
                  <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                    Start talking! Ask a question or say what you want to learn.
                  </p>
                </div>
              )}

              {transcripts.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.speaker === 'USER' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${
                      msg.speaker === 'USER'
                        ? 'rounded-br-sm'
                        : msg.speaker === 'SYSTEM'
                          ? 'text-xs italic'
                          : 'rounded-bl-sm'
                    }`}
                    style={{
                      backgroundColor: msg.speaker === 'USER'
                        ? 'var(--accent)'
                        : msg.speaker === 'SYSTEM'
                          ? 'transparent'
                          : 'var(--bg-panel)',
                      color: msg.speaker === 'USER'
                        ? '#000'
                        : msg.speaker === 'SYSTEM'
                          ? 'var(--text-muted)'
                          : 'var(--text-primary)',
                      border: msg.speaker === 'AGENT' ? `1px solid var(--border)` : 'none',
                      boxShadow: msg.speaker !== 'SYSTEM' ? '0 1px 3px var(--panel-shadow)' : 'none'
                    }}
                  >
                    {msg.speaker === 'AGENT' && <span className="font-bold mr-1">🦁</span>}
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom status bar */}
          <div className="px-6 py-3 border-t flex items-center justify-between"
               style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'animate-pulse' : ''}`}
                   style={{ backgroundColor: isConnected ? '#22c55e' : 'var(--text-muted)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {isConnected ? 'Leo is listening...' : 'Session ended'}
              </span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {transcripts.length} messages
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
