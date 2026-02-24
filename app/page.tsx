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
import { AgentLibrary } from '@/components/AgentLibrary';

const Scene = dynamic(() => import('@/components/3d/Scene'), { ssr: false });

export default function LoreStreamApp() {
  const [appState, setAppState] = useState<'INGESTION' | 'LOADING' | 'LIVE'>('INGESTION');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string>('');
  
  const [showLibrary, setShowLibrary] = useState(false);

  // The Brain
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
    // 🚀 THE THEME: Black background, monospace font, green terminal text
    <main className="relative w-screen h-screen bg-black overflow-hidden text-green-500 font-mono selection:bg-green-500 selection:text-black">
      
      {/* --- TOP RIGHT CORNER: LOGIN --- */}
      <div className="absolute top-6 right-6 z-50 flex items-center gap-4">
        {appState === 'INGESTION' && (
           <button 
             onClick={() => setShowLibrary(!showLibrary)}
             className="px-4 py-2 bg-black text-cyan-400 border border-cyan-500/50 rounded hover:bg-cyan-500/10 transition-all text-sm"
           >
             {showLibrary ? "← SYS.RETURN_TO_FORGE" : "SYS.OPEN_VAULT"}
           </button>
        )}
        <LoginButton />
      </div>

      <div className={`absolute inset-0 z-10 flex ${appState === 'LIVE' ? 'pointer-events-none' : 'pointer-events-auto'}`}>
        
        {/* INGESTION STATE */}
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

        {/* LOADING STATE */}
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

        {/* 🚀 LIVE STATE: THE COMMAND CENTER GRID */}
        {appState === 'LIVE' && activeAgentId && modelUrl && (
          <div className="w-full h-full p-4 grid grid-cols-12 grid-rows-6 gap-4 pointer-events-auto">
            
            {/* 🦁 TOP LEFT: The Agent Feed (Constrained 3D Scene) */}
            <div className="col-span-4 row-span-3 border border-green-500/30 bg-black/50 rounded-md relative shadow-[0_0_15px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="absolute top-2 left-2 text-xs opacity-50 flex items-center gap-2 z-20">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                  SYS.AVATAR_FEED // LIVE
              </div>
              
              {/* Trap the Scene inside this box instead of full screen */}
              <div className="absolute inset-0 z-0">
                  <Scene modelUrl={modelUrl} volumeRef={volumeRef} />
              </div>
              
              {/* Scanline Overlay */}
              <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] opacity-20"></div>
            </div>

            {/* 🗂️ TOP RIGHT: The Vault */}
            <div className="col-span-8 row-span-4 border border-green-500/30 bg-black/50 rounded-md p-4 flex flex-col relative shadow-[0_0_15px_rgba(34,197,94,0.1)]">
              <div className="text-xs opacity-50 mb-4 border-b border-green-500/30 pb-2 flex justify-between">
                  <span>SECURE_VAULT // GENERATED_ARTIFACTS</span>
                  {isGeneratingVaultItem && <span className="text-cyan-400 animate-pulse">PROCESSING_ARTIFACT...</span>}
              </div>
              <div className="flex-1 overflow-y-auto relative">
                  {/* Your existing UI Overlay dumps images here */}
                  <UIOverlay vaultItems={vaultItems} />
              </div>
            </div>

            {/* 💬 BOTTOM LEFT: Live Controls */}
            <div className="col-span-4 row-span-3 border border-green-500/30 bg-black/50 rounded-md p-4 flex flex-col relative shadow-[0_0_15px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="text-xs opacity-50 mb-2 border-b border-green-500/30 pb-2">
                  SYS.CONTROLS // PORT_443
              </div>
              <div className="flex-1 flex flex-col justify-center items-center">
                  <LiveControls 
                    isConnected={isConnected}
                    isGeneratingVaultItem={isGeneratingVaultItem}
                    startSession={startSession}
                    stopSession={stopSession}
                  />
              </div>
            </div>

            {/* 🧠 BOTTOM RIGHT: System Stats */}
            <div className="col-span-8 row-span-2 border border-green-500/30 bg-black/50 rounded-md p-4 relative shadow-[0_0_15px_rgba(34,197,94,0.1)]">
              <div className="text-xs opacity-50 mb-4 border-b border-green-500/30 pb-2">
                  SYS.STATUS // DIAGNOSTICS
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                  <div className="p-3 bg-green-900/10 border border-green-500/20 rounded">
                      <p className="opacity-50 mb-1">VECTOR_DB</p>
                      <p className="text-cyan-400">PINECONE // 768-DIM</p>
                  </div>
                  <div className="p-3 bg-green-900/10 border border-green-500/20 rounded">
                      <p className="opacity-50 mb-1">WEBSOCKET_STATUS</p>
                      <p className={isConnected ? "text-green-400 animate-pulse" : "text-red-400"}>
                          {isConnected ? "CONNECTED" : "DISCONNECTED"}
                      </p>
                  </div>
                  <div className="p-3 bg-green-900/10 border border-green-500/20 rounded">
                      <p className="opacity-50 mb-1">VISION_NODE</p>
                      <p className={isConnected ? "text-green-400" : "text-red-400"}>
                          {isConnected ? "ACTIVE // 0.5 FPS" : "OFFLINE"}
                      </p>
                  </div>
              </div>
            </div>

          </div>
        )} 
      </div>
    </main>
  );
}