'use client';

interface LiveControlsProps {
  isConnected: boolean;
  isGeneratingVaultItem: boolean;
  startSession: () => void;
  stopSession: () => void;
}

export function LiveControls({ isConnected, isGeneratingVaultItem, startSession, stopSession }: LiveControlsProps) {
  return (
    <div className="flex flex-col items-center gap-6 p-8 bg-black/60 backdrop-blur-xl border border-neutral-800 rounded-3xl w-full max-w-md mx-auto shadow-2xl">
      <div className="text-center w-full">
        <h3 className="text-2xl font-bold tracking-tight text-white mb-2 flex items-center justify-center gap-2">
          {isConnected ? (
            <><span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span> Agent is Live</>
          ) : (
            <><span className="w-3 h-3 bg-neutral-600 rounded-full"></span> Agent is Dormant</>
          )}
        </h3>
        <p className="text-sm text-neutral-400">
          {isConnected ? "Mic and Vision sensors active. Speak naturally." : "Initialize WebSockets to begin spatial interaction."}
        </p>
      </div>

      <div className={`transition-all duration-300 overflow-hidden ${isGeneratingVaultItem ? 'h-12 opacity-100' : 'h-0 opacity-0'}`}>
        <div className="flex items-center gap-3 text-cyan-400 text-sm font-bold bg-cyan-400/10 px-5 py-2.5 rounded-full border border-cyan-400/20">
          <svg className="animate-spin h-4 w-4 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Forging Asset in IP Vault...
        </div>
      </div>

      <button
        onClick={isConnected ? stopSession : startSession}
        className={`w-full py-5 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 ${
          isConnected 
            ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/30' 
            : 'bg-white text-black hover:bg-gray-200 shadow-[0_0_40px_rgba(255,255,255,0.3)] hover:scale-[1.02]'
        }`}
      >
        {isConnected ? 'Sever Connection' : 'Wake Up Agent'}
      </button>
    </div>
  );
}