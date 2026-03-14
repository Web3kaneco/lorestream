'use client';

import { useState, useMemo } from 'react';
import type { VaultItem } from '@/types/lxxi';

type FilterTab = 'all' | 'images' | 'documents';

interface ArtifactVaultProps {
  items: VaultItem[];
  onReference: (item: VaultItem) => void;
  onClose: () => void;
}

export function ArtifactVault({ items, onReference, onClose }: ArtifactVaultProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const filteredItems = useMemo(() => {
    if (activeTab === 'all') return items;
    if (activeTab === 'images') return items.filter(i => i.type === 'image');
    if (activeTab === 'documents') return items.filter(i => i.type === 'document');
    return items;
  }, [items, activeTab]);

  // Reverse so newest are first
  const displayItems = useMemo(() => [...filteredItems].reverse(), [filteredItems]);

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'ALL', count: items.length },
    { key: 'images', label: 'IMAGES', count: items.filter(i => i.type === 'image').length },
    { key: 'documents', label: 'DOCS', count: items.filter(i => i.type === 'document').length },
  ];

  return (
    <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 w-[92%] max-w-3xl animate-in slide-in-from-bottom-4 duration-200">
      <div
        className="rounded-2xl border border-[#d4af37]/20 overflow-hidden"
        style={{ backgroundColor: 'rgba(5,5,5,0.95)', backdropFilter: 'blur(24px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2" className="opacity-60">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <span className="text-[10px] tracking-[0.2em] uppercase text-[#d4af37]/60 font-mono">
              ARTIFACT VAULT
            </span>
            <span className="text-[10px] text-white/20 font-mono">
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-white/30 hover:text-white/60 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 px-4 pb-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1 text-[9px] tracking-wider font-bold rounded-md transition-all ${
                activeTab === tab.key
                  ? 'bg-[#d4af37]/15 text-[#d4af37] border border-[#d4af37]/30'
                  : 'text-white/30 hover:text-white/50 border border-transparent'
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={`ml-1.5 ${activeTab === tab.key ? 'text-[#d4af37]/60' : 'text-white/20'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content grid */}
        <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {displayItems.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-white/20 text-xs font-mono">
              {items.length === 0
                ? 'No artifacts yet. Ask the agent to create something.'
                : 'No items match this filter.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {displayItems.map((item, idx) => (
                <ArtifactCard
                  key={item.id || `${item.type}_${item.createdAt || idx}`}
                  item={item}
                  onReference={onReference}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({
  item,
  onReference,
}: {
  item: VaultItem;
  onReference: (item: VaultItem) => void;
}) {
  const isImage = item.type === 'image';
  const isDocument = item.type === 'document';

  return (
    <div className="group relative rounded-lg border border-[#1a1a1a] hover:border-[#d4af37]/40 bg-[#0a0a0a] overflow-hidden transition-all">
      {/* Thumbnail / Preview */}
      {isImage && (
        <div className="aspect-square w-full overflow-hidden bg-black">
          {'url' in item && item.url ? (
            <img
              src={item.url}
              alt={'prompt' in item ? item.prompt || 'Vault image' : 'Vault image'}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/20 text-[10px]">
              Loading...
            </div>
          )}
        </div>
      )}

      {isDocument && (
        <div className="aspect-square w-full overflow-hidden bg-[#080808] p-2 flex flex-col justify-between">
          <div>
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-[#d4af37]/10 text-[#d4af37]/60 font-bold uppercase tracking-wider">
              {'language' in item ? item.language : 'text'}
            </span>
            <p className="text-[10px] text-white/50 mt-1.5 line-clamp-3 leading-tight font-mono">
              {'title' in item ? item.title : 'Untitled'}
            </p>
          </div>
          <p className="text-[8px] text-white/20 line-clamp-2 font-mono">
            {'content' in item ? (item.content || '').substring(0, 80) : ''}
          </p>
        </div>
      )}

      {/* Math problem fallback */}
      {item.type === 'math_problem' && (
        <div className="aspect-square w-full overflow-hidden bg-[#080808] p-2 flex flex-col items-center justify-center">
          <span className="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/60 font-bold uppercase tracking-wider">
            MATH
          </span>
          <p className="text-[10px] text-white/50 mt-2 text-center line-clamp-3 font-mono">
            {'problem' in item ? item.problem : ''}
          </p>
        </div>
      )}

      {/* Hover overlay with actions */}
      <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5">
        <button
          onClick={() => onReference(item)}
          className="px-3 py-1 text-[9px] font-bold tracking-wider bg-[#d4af37]/20 hover:bg-[#d4af37]/30 border border-[#d4af37]/40 text-[#d4af37] rounded transition-all"
        >
          REFERENCE
        </button>
        {isImage && 'url' in item && item.url && (
          <a
            href={item.url}
            download={`lxxi_artifact.png`}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1 text-[9px] font-bold tracking-wider bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 rounded transition-all"
          >
            EXPORT
          </a>
        )}
      </div>

      {/* Caption below thumbnail */}
      <div className="px-1.5 py-1">
        <p className="text-[8px] text-white/30 truncate font-mono">
          {isImage && 'prompt' in item ? (item.prompt || 'Image') : ''}
          {isDocument && 'title' in item ? (item.title || 'Document') : ''}
          {item.type === 'math_problem' ? 'Math Problem' : ''}
        </p>
      </div>
    </div>
  );
}
