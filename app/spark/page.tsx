'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import { TUTOR_CONFIG } from '@/lib/agents/tutor';
import { useTheme } from '@/lib/theme';
import { VoiceOrb } from '@/components/ui/VoiceOrb';
import { ChalkboardCard } from '@/components/ui/ChalkboardCard';
import { CountingVisual } from '@/components/ui/CountingVisual';
import {
  loadLearnerProfile,
  createLearnerProfile,
  startLearnerSession,
  recordProblemAttempt,
  buildLearnerContext,
  saveLearnerProfile,
  type LearnerProfile,
  type SubjectProgress,
} from '@/lib/learnerProfile';
import type { AnimationState } from '@/components/3d/Avatar';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

type Subject = 'general' | 'math' | 'spanish' | 'science';

const SUBJECT_LABELS: Record<Subject, string> = {
  general: 'Ask Anything',
  math: 'Math',
  spanish: 'Spanish',
  science: 'Science'
};

interface LearningVisual {
  url: string;
  prompt: string;
  subject: string;
  concept: string;
  createdAt: number;
}

export default function SparkPage() {
  const router = useRouter();
  const { setMode } = useTheme();
  const [subject, setSubject] = useState<Subject>('general');
  const [hasStarted, setHasStarted] = useState(false);
  const [chalkboardItems, setChalkboardItems] = useState<{ problem: string; hint: string; difficulty: 'easy' | 'medium' | 'hard' }[]>([]);
  const [learningVisuals, setLearningVisuals] = useState<LearningVisual[]>([]);
  const [animationState, setAnimationState] = useState<AnimationState>('idle');
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevSubjectRef = useRef<Subject>(subject);
  const sendContextRef = useRef<((text: string, attachments: any[]) => boolean) | null>(null);

  // Set spark theme on mount + load learner profile
  useEffect(() => {
    setMode('spark');
    const profile = loadLearnerProfile();
    if (profile) setLearnerProfile(profile);
  }, [setMode]);

  // Track when progress was last recorded — used to delay chalkboard transitions
  const lastProgressTimeRef = useRef(0);

  // Tool callback handler — chalkboard, visuals, progress tracking, name saving
  const handleSparkToolCallback = useCallback((toolName: string, args: any) => {
    if (toolName === 'displayChalkboard') {
      const timeSinceProgress = Date.now() - lastProgressTimeRef.current;
      if (timeSinceProgress < 1000) {
        // Arrived right after record_progress (same tool batch) — delay the
        // chalkboard transition so Leo has time to celebrate the correct answer.
        // Without this delay, the screen would jump to the next problem instantly
        // while Leo is still saying "Great job!"
        console.log(`[SPARK] Delaying chalkboard transition (${timeSinceProgress}ms since progress)`);
        setTimeout(() => {
          setChalkboardItems([args]);
          setLearningVisuals([]);
        }, 4000);
      } else {
        setChalkboardItems([args]);
        setLearningVisuals([]);
      }
    } else if (toolName === 'create_learning_visual') {
      // Math visuals are handled by the programmatic CountingVisual component
      // (renders exact emoji counts instantly). Only show AI images for non-math.
      if (args.subject !== 'math') {
        setLearningVisuals([args as LearningVisual]);
      }
    } else if (toolName === 'record_progress') {
      lastProgressTimeRef.current = Date.now();
      // Track progress in learner profile
      const { subject: subj, correct, topic } = args;
      const validSubject = (['math', 'spanish', 'science', 'general'].includes(subj) ? subj : 'general') as keyof SubjectProgress;
      const updated = recordProblemAttempt(validSubject, correct, topic);
      if (updated) setLearnerProfile(updated);

      // Clear the screen immediately when the student answers correctly.
      // This prevents the OLD problem from staying visible while Leo celebrates
      // and transitions to a new problem. The new chalkboard will appear when
      // displayChalkboard fires for the next question.
      if (correct) {
        console.log('[SPARK] Correct answer — clearing screen for celebration');
        setChalkboardItems([]);
        setLearningVisuals([]);
      }
    } else if (toolName === 'save_learner_name') {
      // Save the learner's name
      const { name } = args;
      let profile = loadLearnerProfile();
      if (!profile) {
        profile = createLearnerProfile(name);
      } else {
        profile.name = name;
        saveLearnerProfile(profile);
      }
      setLearnerProfile(profile);
      console.log(`[LEARNER] Name saved: ${name}`);
    }
  }, []);

  // Build subject context
  const SUBJECT_CONTEXT: Record<Subject, string> = useMemo(() => ({
    general: '',
    math: '\n\nSUBJECT FOCUS: MATH. Say a quick hi (use their name if known), then jump straight into an easy math problem. Call displayChalkboard AND create_learning_visual together. Say "What do you think?" then STOP and WAIT for the child to answer. Do NOT keep talking. When they answer correctly, count using plain numbers (1, 2, 3...) — NEVER name specific objects like apples or stars. Call record_progress, celebrate, then immediately give a new problem.',
    spanish: '\n\nSUBJECT FOCUS: SPANISH. Greet in Spanish, translate, then start teaching vocabulary with visual flashcards. Say the word, show the image, ask the child to repeat it, then STOP and WAIT for them. Call record_progress after each attempt.',
    science: '\n\nSUBJECT FOCUS: SCIENCE. Share a fun fact, then ask "Want to know why?" and STOP. Wait for the child. Use visual aids for diagrams. Call record_progress after each question.'
  }), []);

  // Build the full system instruction with learner context
  const learnerContext = useMemo(() => {
    if (!learnerProfile) return '\n\nNO STUDENT PROFILE — this is a new student. Ask their name first! Say: "Hey there! I\'m Leo, your learning buddy! What\'s your name?" Then wait for their answer and call save_learner_name with their name.';
    return '\n\n' + buildLearnerContext(learnerProfile);
  }, [learnerProfile]);

  const sparkConfig = useMemo(() => ({
    ...TUTOR_CONFIG,
    systemInstruction: (TUTOR_CONFIG.systemInstruction || '') + learnerContext + SUBJECT_CONTEXT[subject],
    onToolCallback: handleSparkToolCallback
  }), [handleSparkToolCallback, subject, SUBJECT_CONTEXT, learnerContext]);

  const {
    isConnected,
    startSession,
    stopSession,
    volumeRef,
    transcripts,
    sendContext
  } = useGeminiLive('tutor_demo', 'anonymous', false, sparkConfig);

  // Keep sendContextRef up to date for subject switching
  useEffect(() => {
    sendContextRef.current = sendContext;
  }, [sendContext]);

  // Auto-trigger greeting when session connects — reduces initial delay
  // Without this, Leo waits for the student to speak first, which feels sluggish
  const hasGreetedRef = useRef(false);
  useEffect(() => {
    if (isConnected && hasStarted && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      // Brief delay to let WebSocket stabilize, then send greeting prompt
      const timer = setTimeout(() => {
        if (sendContextRef.current) {
          const name = learnerProfile?.name;
          const subjectName = SUBJECT_LABELS[subject];
          const prompt = name
            ? `[SYSTEM: Session started. ${name} is ready for ${subjectName}. Greet them BY NAME warmly, then immediately present a ${subjectName.toLowerCase()} problem with displayChalkboard.]`
            : `[SYSTEM: Session started. This is a new student. Ask their name first — say "Hey there! I'm Leo! What's your name?" and WAIT for their answer.]`;
          sendContextRef.current(prompt, []);
          console.log('[SPARK] Auto-greeting sent to reduce initial delay');
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (!isConnected) {
      hasGreetedRef.current = false; // Reset for next session
    }
  }, [isConnected, hasStarted, learnerProfile, subject]);

  // When subject changes MID-SESSION, send a context message to Gemini
  useEffect(() => {
    if (!isConnected || !hasStarted) return;
    if (prevSubjectRef.current === subject) return;

    const prev = prevSubjectRef.current;
    prevSubjectRef.current = subject;

    // Send a text message to Gemini about the subject change
    const name = learnerProfile?.name || 'the student';
    const subjectName = SUBJECT_LABELS[subject];
    const message = `[SYSTEM: ${name} wants to switch from ${SUBJECT_LABELS[prev]} to ${subjectName}. Present a NEW ${subjectName.toLowerCase()} problem IMMEDIATELY. Call displayChalkboard with a new problem AND create_learning_visual with a matching image. Do this right now.]`;

    if (sendContextRef.current) {
      const sent = sendContextRef.current(message, []);
      if (sent) {
        console.log(`[SPARK] Subject switched: ${prev} -> ${subject}`);
        // Clear stale content
        setChalkboardItems([]);
        setLearningVisuals([]);
      }
    }
  }, [subject, isConnected, hasStarted, learnerProfile]);

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
    prevSubjectRef.current = subject;
    // Record session start
    const updated = startLearnerSession();
    if (updated) setLearnerProfile(updated);
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

  // Latest learning visual for display
  const latestVisual = learningVisuals.length > 0 ? learningVisuals[learningVisuals.length - 1] : null;

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

        {/* Quick-start hero */}
        <div className="relative z-10 text-center max-w-lg px-6">
          <h1 className="text-4xl md:text-5xl font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            Leo&apos;s Learning Lab
          </h1>

          {/* Welcome back message */}
          {learnerProfile && (
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Welcome back, <strong>{learnerProfile.name}</strong>!
              {learnerProfile.totalSessions > 0 && ` Session #${learnerProfile.totalSessions + 1}`}
            </p>
          )}

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
            Start Learning
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
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            Leo&apos;s Learning Lab
          </h1>
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'animate-pulse' : ''}`}
               style={{ backgroundColor: isConnected ? 'var(--accent)' : 'var(--text-muted)' }} />
        </div>

        <div className="flex items-center gap-3">
          {/* Subject tabs — clickable mid-session to switch topics */}
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

          {/* Learner info badge */}
          {learnerProfile && (
            <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-xs" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
              <span>{learnerProfile.name}</span>
              {learnerProfile.progress[subject as keyof SubjectProgress]?.streak > 0 && (
                <span style={{ color: 'var(--accent)' }}>
                  {learnerProfile.progress[subject as keyof SubjectProgress].streak} streak
                </span>
              )}
            </div>
          )}

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
        {/* Left: 3D Avatar — facingRotationY corrects model orientation */}
        <div className="md:w-2/5 relative min-h-[250px] md:min-h-0 border-b md:border-b-0 md:border-r" style={{ borderColor: 'var(--border)' }}>
          <div className="absolute inset-0">
            <Scene
              modelUrl="/leo.glb"
              volumeRef={volumeRef}
              animationState={animationState}
              facingRotationY={-Math.PI / 2}
            />
          </div>
          {/* Mobile voice orb fallback */}
          <div className="md:hidden absolute bottom-4 left-1/2 -translate-x-1/2">
            <VoiceOrb volumeRef={volumeRef} isActive={isConnected} />
          </div>
        </div>

        {/* Right: Whiteboard / Content Area */}
        <div className="md:w-3/5 flex flex-col">
          {/* Chalkboard display — latest problem */}
          {chalkboardItems.length > 0 && (
            <div className="px-6 pt-4">
              <ChalkboardCard {...chalkboardItems[chalkboardItems.length - 1]} />
            </div>
          )}

          {/* Math counting visual — programmatic, exact counts, renders instantly */}
          {chalkboardItems.length > 0 && (
            <div className="px-6 pt-3">
              <CountingVisual problem={chalkboardItems[chalkboardItems.length - 1].problem} />
            </div>
          )}

          {/* Learning visual display — AI-generated image (Spanish, Science only) */}
          {latestVisual && (
            <div className="px-6 pt-4">
              <div className="rounded-2xl overflow-hidden shadow-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
                <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                  <span className="text-xs font-bold tracking-wide" style={{ color: 'var(--accent)' }}>
                    {latestVisual.subject.toUpperCase()}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                    Visual Aid
                  </span>
                </div>
                <div className="p-4 flex flex-col items-center gap-3">
                  <img
                    src={latestVisual.url}
                    alt={latestVisual.concept}
                    className="max-h-48 rounded-lg object-contain"
                  />
                  <p className="text-sm font-medium text-center" style={{ color: 'var(--text-secondary)' }}>
                    {latestVisual.concept}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Whiteboard panel — voice-only, no transcript */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-lg mx-auto space-y-4">
              {chalkboardItems.length === 0 && learningVisuals.length === 0 && (
                <div className="text-center py-12">
                  <div className="w-12 h-12 mx-auto mb-4 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: 'var(--accent)' }}>
                      <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                    Leo is getting ready...
                  </p>
                  <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
                    Start talking! Ask a question or say what you want to learn.
                  </p>
                </div>
              )}
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
