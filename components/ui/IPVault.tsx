'use client';

import { DocumentCard } from './DocumentCard';

interface VaultItem {
  type?: string;
  url?: string;
  prompt?: string;
  rationale?: string;
  title?: string;
  content?: string;
  language?: string;
  description?: string;
}

export function IPVault({ items }: { items: VaultItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 border border-dashed border-[#1a1a1a] rounded-xl text-white/30 text-sm p-6 text-center">
        The vault is empty.<br/>Tell the Agent to design something.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 pb-20">
      {items.map((item, index) => {
        // Backwards compatibility: items without a 'type' field are images
        const itemType = item.type || 'image';

        // --- Document rendering ---
        if (itemType === 'document') {
          return (
            <DocumentCard
              key={index}
              title={item.title || 'Untitled'}
              content={item.content || ''}
              language={item.language || 'text'}
              description={item.description}
              index={index}
            />
          );
        }

        // --- Image rendering (default) ---
        return (
          <div key={index} className="group relative rounded-xl overflow-hidden border border-[#1a1a1a] bg-[#0a0a0a] shadow-2xl transition-all hover:border-[#d4af37]">
            <div className="relative w-full aspect-video">
              {item.url ? (
                <img
                  src={item.url}
                  alt={item.prompt || "Generated Vault Asset"}
                  className="object-cover w-full h-full"
                />
              ) : (
                <div className="flex items-center justify-center w-full h-full bg-[#0a0a0a] text-white/30 text-xs">
                  Image loading...
                </div>
              )}
            </div>
            <div className="p-4 flex justify-between items-center">
              <p className="text-xs font-mono text-white/40 tracking-widest uppercase">
                Vault Asset #{index + 1}
              </p>
              {item.url && (
                <a
                  href={item.url}
                  download={`lxxi_asset_${index}.png`}
                  target="_blank" rel="noreferrer"
                  className="text-xs px-3 py-1 rounded font-bold transition-colors"
                  style={{ backgroundColor: '#d4af37', color: '#000' }}
                >
                  Export
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
