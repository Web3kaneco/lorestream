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
import { LoginButton } from '@/components/ui/LoginButton';
import { AgentLibrary } from '@/components/AgentLibrary'; // adjust path as needed

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

export default function LoreStreamApp() {
  const [appState, setAppState] = useState<'INGESTION' | 'LOADING' | 'LIVE'>('INGESTION');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string>('');
  
  const [showLibrary, setShowLibrary] = useState(false);

  // The Brain is mounted at the top level
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
      
      {/* --- TOP RIGHT CORNER: VAULT & LOGIN --- */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
        {appState === 'INGESTION' && (
           <button 
             onClick={() => setShowLibrary(!showLibrary)}
             className="px-4 py-2 bg-gray-800 text-cyan-400 border border-gray-700 rounded hover:border-cyan-500 transition-all font-bold shadow-lg"
           >
             {showLibrary ? "← Back to Forge" : "Open Vault"}
           </button>
        )}
        <LoginButton />
      </div>

      <div className={`absolute inset-0 z-10 flex ${appState === 'LIVE' ? 'pointer-events-none' : 'pointer-events-auto'}`}>
        
        {appState === 'INGESTION' && (
           showLibrary ? (
             <AgentLibrary 
               userId={auth.currentUser?.uid || ''} 
               onSelectAgent={(selectedAgentId, url) => {
                 setActiveAgentId(selectedAgentId);
                 setModelUrl(url);
                 setAppState('LIVE'); 
                 setShowLibrary(false);
               }} 
             />
           ) : (
             <DropZone onAwaken={handleAwaken} />
           )
        )}

        {appState === 'LOADING' && activeAgentId && (
           <ActiveLoadingScreen 
             userId={auth.currentUser?.uid || ''} 
             agentId={activeAgentId} 
             onComplete={(url) => {
               setModelUrl(url); 
               setAppState('LIVE');
             }} 
           />
        )}

        {appState === 'LIVE' && activeAgentId && (
           <>
             {/* THE FIX: Moved the UI to the bottom-center of the 3D space! */}
             <div className="absolute inset-y-0 left-0 w-2/3 flex flex-col items-center justify-end pb-12 pointer-events-none z-20">
                <div className="pointer-events-auto">
                  <LiveControls 
                    isConnected={isConnected}
                    isGeneratingVaultItem={isGeneratingVaultItem}
                    startSession={startSession}
                    stopSession={stopSession}
                  />
                </div>
             </div>

             <div className="absolute inset-y-0 right-0 w-1/3 bg-black/70 backdrop-blur-xl border-l border-white/10 p-6 pointer-events-auto shadow-2xl z-20">
               <UIOverlay vaultItems={vaultItems} /> 
             </div>
           </>
        )} 
      </div> {/* <--- RESTORED MISSING CLOSING DIV! */}

      {appState === 'LIVE' && activeAgentId && modelUrl && (
        <div className="absolute inset-0 z-0">
          <Scene modelUrl={modelUrl} volumeRef={volumeRef} />
        </div>
      )}
    </main>
  );
}