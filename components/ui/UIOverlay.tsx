'use client';

import { IPVault } from './IPVault';

// You will eventually pass the vaultItems generated from useGeminiLive into this component
export function UIOverlay({ vaultItems = [] }: { vaultItems?: any[] }) {
  return (
    <div className="flex flex-col h-full text-white">
      <div className="flex justify-between items-center mb-6">
<h2 className="text-[#00ff00] font-mono text-sm tracking-widest uppercase">
  Agent Vault
</h2>
        <span className="text-xs bg-cyan-400/20 text-cyan-400 px-2 py-1 rounded border border-cyan-400/30">
          Imagen 4 Ultra
        </span>
      </div>
      
      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        <IPVault items={vaultItems} />
      </div>
    </div>
  );
}