'use client';

import { useEffect, useState, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ActiveLoadingProps {
  userId: string;
  agentId: string;
  onComplete: (url: string, voiceName: string) => void;
}

const TIMEOUT_WARNING_SECONDS = 300; // 5 minutes

export function ActiveLoadingScreen({ userId, agentId, onComplete }: ActiveLoadingProps) {
  const [agentData, setAgentData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Stable ref for onComplete — prevents listener churn from inline arrow functions
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Elapsed time counter
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Firestore real-time listener with error handling
  useEffect(() => {
    if (!userId || !agentId) return;
    const unsub = onSnapshot(
      doc(db, `users/${userId}/agents/${agentId}`),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setAgentData(data);

          if (data.extrusionStatus === 'complete') {
            onCompleteRef.current(data.model3dUrl || "", data.voiceName || "Aoede");
          }

          if (data.extrusionStatus === 'error' || data.extrusionStatus === 'failed') {
            setError(data.extrusionError || "3D generation failed. Please try again.");
          }
        }
      },
      (err) => {
        console.error("[LOADING] Firestore listener error:", err);
        setError("Connection lost. Please refresh the page.");
      }
    );
    return () => unsub();
  }, [userId, agentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full bg-black text-white p-10 pointer-events-auto z-50">
        <div className="text-red-400 text-5xl mb-6">!</div>
        <h2 className="text-2xl font-bold text-red-400 mb-4">Something went wrong</h2>
        <p className="text-neutral-400 mb-8 text-center max-w-md">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-medium transition-colors"
        >
          Refresh Page
        </button>
      </div>
    );
  }

  const showTimeWarning = elapsedSeconds >= TIMEOUT_WARNING_SECONDS;

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-black text-white p-10 pointer-events-auto z-50">
      <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-cyan-400 mb-8"></div>
      <h2 className="text-3xl font-bold animate-pulse mb-4">
        {agentData?.extrusionStatus === 'animating'
          ? 'Animating Idle Pose...'
          : agentData?.extrusionStatus === 'rigging'
            ? 'Rigging Skeleton...'
            : 'Synthesizing 3D DNA...'}
      </h2>
      <p className="text-sm text-neutral-500 mb-2">
        {agentData?.extrusionStatus === 'animating'
          ? 'Baking idle animation for natural pose'
          : agentData?.extrusionStatus === 'rigging'
            ? 'Attaching Mixamo skeleton for animation'
            : 'Generating 3D model from image'}
      </p>

      {elapsedSeconds >= 30 && (
        <p className="text-xs text-neutral-600 mb-8">
          {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
        </p>
      )}
      {elapsedSeconds < 30 && <div className="mb-12" />}

      {showTimeWarning && (
        <p className="text-sm text-amber-400 mb-8 text-center max-w-md">
          Generation is taking longer than expected. You may want to refresh and try again.
        </p>
      )}

      {agentData?.extrusionWarning === 'rigging_failed' && (
        <p className="text-xs text-amber-500 mb-4">
          Note: Rigging step was skipped — model may have limited animation.
        </p>
      )}

      <div className="w-full max-w-md space-y-6 text-left">
        <div className="border border-neutral-800 p-4 rounded-lg bg-neutral-900/50">
          <p className="text-sm text-neutral-500 uppercase tracking-widest">Identified Archetype</p>
          {agentData?.characterName && (
            <p className="text-2xl font-bold text-white mb-1">{agentData.characterName}</p>
          )}
          <p className="text-xl font-mono text-cyan-300">
            {agentData?.archetype || "Scanning..."}
          </p>
        </div>

        <div className="border border-neutral-800 p-4 rounded-lg bg-neutral-900/50">
          <p className="text-sm text-neutral-500 uppercase tracking-widest mb-2">Extracted Traits</p>
          {agentData?.traits?.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {agentData.traits.map((trait: string, i: number) => (
                <span key={i} className="px-3 py-1 bg-neutral-800 rounded-full text-sm font-medium">
                  {trait}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-neutral-600 animate-pulse">Extracting visual metadata...</p>
          )}
        </div>

        <div className="border border-neutral-800 p-4 rounded-lg bg-neutral-900/50 min-h-[100px]">
          <p className="text-sm text-neutral-500 uppercase tracking-widest">Lore Origin</p>
          <p className="text-md text-neutral-300 italic mt-2">
            {agentData?.funFact ? `"${agentData.funFact}"` : "Decoding memories..."}
          </p>
        </div>
      </div>
    </div>
  );
}
