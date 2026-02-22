'use client';

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { DropZone } from '@/components/ui/DropZone';
import { ActiveLoadingScreen } from '@/components/ui/ActiveLoadingScreen';
import { UIOverlay } from '@/components/ui/UIOverlay';
import { LiveControls } from '@/components/ui/LiveControls';
import { useGeminiLive } from '@/hooks/useGeminiLive';
import dynamic from 'next/dynamic';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

export default function LoreStreamApp() {
  const [appState, setAppState] = useState<'INGESTION' | 'LOADING' | 'LIVE'>('INGESTION');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string>('');

  // The Brain is mounted at the top level!
  const { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef } = useGeminiLive(activeAgentId || '', auth.currentUser?.uid || '');

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

  return (
    <main className="relative w-screen h-screen bg-neutral-900 overflow-hidden text-white">
      <div className={`absolute inset-0 z-10 flex ${appState === 'LIVE' ? 'pointer-events-none' : 'pointer-events-auto'}`}>
        
        {appState === 'INGESTION' && (
           <DropZone onAwaken={handleAwaken} />
        )}

        {appState === 'LOADING' && activeAgentId && (
           <ActiveLoadingScreen 
             userId={auth.currentUser!.uid} 
             agentId={activeAgentId} 
             onComplete={(url) => {
               setModelUrl(url); // Save the Tripo3D model URL
               setAppState('LIVE');
             }} 
           />
        )}

        {appState === 'LIVE' && activeAgentId && (
           <>
             <div className="w-2/3 h-full flex flex-col justify-end p-12 pointer-events-none">
                <div className="pointer-events-auto mb-10">
                  <LiveControls 
                    isConnected={isConnected}
                    isGeneratingVaultItem={isGeneratingVaultItem}
                    startSession={startSession}
                    stopSession={stopSession}
                  />
                </div>
             </div>

             <div className="w-1/3 h-full bg-black/70 backdrop-blur-xl border-l border-white/10 p-6 pointer-events-auto shadow-2xl">
               <UIOverlay vaultItems={vaultItems} /> 
             </div>
           </>
        )}
      </div>

      {appState === 'LIVE' && activeAgentId && modelUrl && (
        <div className="absolute inset-0 z-0">
          <Scene modelUrl={modelUrl} volumeRef={volumeRef} />
        </div>
      )}
    </main>
  );
}