'use client';

import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';
import { DropZone } from '@/components/ui/DropZone';
import { ActiveLoadingScreen } from '@/components/ui/ActiveLoadingScreen';
import { UIOverlay } from '@/components/ui/UIOverlay';
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

  // 🧠 THE BRAIN: Properly scoped inside the component with 'transcripts' included
  const { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, transcripts } = useGeminiLive(activeAgentId || '', auth.currentUser?.uid || '');

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

  // Grab the absolute newest item for the Active Workspace
  const latestItem = vaultItems.length > 0 ? vaultItems[vaultItems.length - 1] : null;
  // The rest of the items go to the Vault
  const historicalItems = vaultItems.length > 1 ? vaultItems.slice(0, -1) : [];

  return (
    <main className="relative w-screen h-screen bg-black overflow-hidden text-green-500 font-mono selection:bg-green-500 selection:text-black">
      
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
           ) : <DropZone onAwaken={handleAwaken} />
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

        {/* 🚀 THE NEW COMMAND CENTER GRID */}
        {appState === 'LIVE' && activeAgentId && modelUrl && (
          <div className="w-full h-full p-4 grid grid-cols-12 grid-rows-6 gap-4 pointer-events-auto">
            
            {/* 🦁 TOP LEFT: The Agent Feed (Col 1-3, Row 1-3) */}
            <div className="col-span-3 row-span-3 col-start-1 row-start-1 border border-green-500/30 bg-black/50 rounded-md relative shadow-[0_0_15px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="absolute top-2 left-2 text-xs opacity-50 flex items-center gap-2 z-20">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`}></div>
                  SYS.AVATAR_FEED // {isConnected ? 'LIVE' : 'STANDBY'}
              </div>
              <div className="absolute inset-0 z-0">
                  <Scene modelUrl={modelUrl} volumeRef={volumeRef} />
              </div>
              <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] opacity-20"></div>
            </div>

            {/* 🎨 BOTTOM LEFT: Active Workspace (Col 1-3, Row 4-6) */}
            <div className="col-span-3 row-span-3 col-start-1 row-start-4 border border-green-500/30 bg-black/50 rounded-md p-4 flex flex-col relative shadow-[0_0_15px_rgba(34,197,94,0.1)] overflow-hidden">
              <div className="text-xs opacity-50 mb-2 border-b border-green-500/30 pb-2 flex justify-between items-center">
                  <span>ACTIVE_WORKSPACE // LATEST_RENDER</span>
                  {isGeneratingVaultItem && <span className="text-cyan-400 animate-pulse">PROCESSING...</span>}
              </div>
              <div className="flex-1 flex items-center justify-center overflow-hidden">
                  {isGeneratingVaultItem ? (
                      <div className="text-cyan-400 animate-pulse border border-cyan-400/50 p-4 rounded text-center">
                          [ COMPILING ARTIFACT... ]
                      </div>
                  ) : latestItem ? (
                      <div className="flex flex-col items-center h-full w-full">
                          <img src={latestItem.url} alt="Generated" className="object-contain max-h-[80%] rounded border border-green-500/50 shadow-lg" />
                          <p className="text-xs text-green-400 mt-2 text-center overflow-hidden text-ellipsis whitespace-nowrap w-full">
                            &gt; {latestItem.prompt}
                          </p>
                      </div>
                  ) : (
                      <p className="opacity-20 text-sm text-center">[ WAITING FOR AGENT GENERATION ]</p>
                  )}
              </div>
            </div>

            {/* 💬 CENTER: Terminal Stream (Col 4-8, Row 1-6) */}
            <div className="col-span-5 row-span-6 col-start-4 row-start-1 border border-green-500/30 bg-black/50 rounded-md p-4 flex flex-col relative shadow-[0_0_15px_rgba(34,197,94,0.1)]">
               <div className="text-xs opacity-50 mb-4 border-b border-green-500/30 pb-2 flex justify-between">
                  <span>TERMINAL_STREAM // I-O_LOGS</span>
                  <span>{transcripts?.length || 0} MESSAGES</span>
              </div>
              <div className="flex-1 overflow-y-auto font-mono text-sm space-y-3 flex flex-col-reverse">
                  <div className="animate-pulse text-cyan-400 mt-2">_</div>
                  {transcripts && [...transcripts].reverse().map((msg, idx) => (
                      <div key={idx} className="border-l-2 border-green-500/30 pl-2">
                          <span className="text-amber-400 font-bold">{msg.speaker}:</span> 
                          <span className="text-green-400 ml-2">{msg.text}</span>
                      </div>
                  ))}
                  <p className="opacity-50">Initializing secure connection to Generative Host...</p>
                  <p className="opacity-50">Loading Vector Database constraints...</p>
              </div>
            </div>

            {/* 🗂️ TOP RIGHT: The Archive Vault (Col 9-12, Row 1-4) */}
            <div className="col-span-4 row-span-4 col-start-9 row-start-1 border border-green-500/30 bg-black/50 rounded-md p-4 flex flex-col relative shadow-[0_0_15px_rgba(34,197,94,0.1)]">
              <div className="text-xs opacity-50 mb-4 border-b border-green-500/30 pb-2">
                  ARCHIVE_VAULT // OVERFLOW
              </div>
              <div className="flex-1 overflow-y-auto relative">
                  <UIOverlay vaultItems={historicalItems} />
              </div>
            </div>

            {/* ⚙️ BOTTOM RIGHT: System Stats & Mini Controls (Col 9-12, Row 5-6) */}
            <div className="col-span-4 row-span-2 col-start-9 row-start-5 border border-green-500/30 bg-black/50 rounded-md p-4 relative shadow-[0_0_15px_rgba(34,197,94,0.1)] flex flex-col justify-between">
              <div className="text-xs opacity-50 mb-2 border-b border-green-500/30 pb-2 flex justify-between items-center">
                  <span>SYS.DIAGNOSTICS</span>
                  
                  {/* 🔥 THE WAKE UP BUTTON */}
                  <button 
                    onClick={isConnected ? stopSession : startSession}
                    className={`px-4 py-1 text-xs font-bold rounded border transition-all flex items-center gap-2 ${
                        isConnected 
                        ? 'bg-red-900/20 text-red-500 border-red-500/50 hover:bg-red-500/20' 
                        : 'bg-green-500 text-black border-green-500 hover:bg-green-400 shadow-[0_0_15px_rgba(34,197,94,0.4)] animate-pulse'
                    }`}
                  >
                    {!isConnected && <div className="w-2 h-2 rounded-full bg-black"></div>}
                    {isConnected ? "GO TO SLEEP" : "WAKE UP AGENT"}
                  </button>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-xs h-full items-center">
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
                      <p className="opacity-50 mb-1">TOOL_NODE</p>
                      <p className="text-green-400">NANO-BANANA // ACTIVE</p>
                  </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}