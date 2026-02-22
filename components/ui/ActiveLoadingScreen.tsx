'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface ActiveLoadingProps {
  userId: string;
  agentId: string;
  onComplete: (url: string) => void;
}

export function ActiveLoadingScreen({ userId, agentId, onComplete }: ActiveLoadingProps) {
  const [agentData, setAgentData] = useState<any>(null);

  useEffect(() => {
    // Open a real-time listener to Firestore
    const unsub = onSnapshot(doc(db, `users/${userId}/agents/${agentId}`), (docSnapshot) => {
      if (docSnapshot.exists()) {
        const data = docSnapshot.data();
        setAgentData(data);
        
        // When the Cloud Task finishes Tripo3D generation, it sets this flag
        if (data.extrusionStatus === 'complete') {
          onComplete(data.model3dUrl ||""); // Tells page.tsx to switch to the 'LIVE' view
        }
      }
    });
    return () => unsub();
  }, [userId, agentId, onComplete]);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-black text-white p-10 pointer-events-auto z-50">
      <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-cyan-400 mb-8"></div>
      <h2 className="text-3xl font-bold animate-pulse mb-12">Synthesizing 3D DNA...</h2>

      <div className="w-full max-w-md space-y-6 text-left">
        <div className="border border-neutral-800 p-4 rounded-lg bg-neutral-900/50">
          <p className="text-sm text-neutral-500 uppercase tracking-widest">Identified Archetype</p>
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