'use client';

import { useState } from 'react';

export function DropZone({ onAwaken }: { onAwaken: (data: any) => void }) {
  const [activeTab, setActiveTab] = useState<'upload' | 'web3'>('upload');
  const [tokenId, setTokenId] = useState('');
  const [contract, setContract] = useState('');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      onAwaken({ type: 'image', base64: reader.result });
    };
  };

  const handleWeb3Submit = () => {
    if (!tokenId || !contract) return;
    onAwaken({ type: 'nft', contract, tokenId });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[#050505] text-white pointer-events-auto">
      <h1 className="text-5xl font-bold mb-10 tracking-tight">Show me who I am.</h1>

      <div className="flex gap-4 mb-8 border-b border-neutral-800 pb-4">
        <button onClick={() => setActiveTab('upload')} className={activeTab === 'upload' ? 'text-[#d4af37] font-bold' : 'text-neutral-500'}>
          Upload Image
        </button>
        <button onClick={() => setActiveTab('web3')} className={activeTab === 'web3' ? 'text-[#d4af37] font-bold' : 'text-neutral-500'}>
          NFT Contract
        </button>
      </div>

      {activeTab === 'upload' ? (
        <label className="border-2 border-dashed border-neutral-700 w-96 h-64 flex flex-col items-center justify-center rounded-xl cursor-pointer hover:border-[#d4af37] transition-all">
          <span className="text-neutral-400 font-medium">Click to drop an image</span>
          <input type="file" accept="image/jpeg, image/png" className="hidden" onChange={handleFileUpload} />
        </label>
      ) : (
        <div className="flex flex-col gap-4 w-96">
          <input
            type="text" placeholder="Contract Address (0x...)"
            className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 focus:border-[#d4af37] outline-none text-white"
            value={contract} onChange={(e) => setContract(e.target.value)}
          />
          <input
            type="text" placeholder="Token ID (e.g., 4012)"
            className="p-4 bg-neutral-900 rounded-lg border border-neutral-800 focus:border-[#d4af37] outline-none text-white"
            value={tokenId} onChange={(e) => setTokenId(e.target.value)}
          />
          <button onClick={handleWeb3Submit} className="mt-4 p-4 bg-white text-black font-bold rounded-lg hover:bg-gray-200">
            Awaken Character
          </button>
        </div>
      )}
    </div>
  );
}
