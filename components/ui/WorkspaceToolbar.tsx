'use client';

import { useRef } from 'react';

interface WorkspaceToolbarProps {
  isConnected: boolean;
  isGenerating: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onUpload: (data: { type: string; base64: string }) => void;
  itemCount: number;
}

export function WorkspaceToolbar({
  isConnected,
  isGenerating,
  onStart,
  onStop,
  onClear,
  onUpload,
  itemCount,
}: WorkspaceToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      const base64 = result.split(',')[1];
      onUpload({ type: 'image', base64 });
    };
    reader.readAsDataURL(file);
    // Reset so the same file can be uploaded again
    e.target.value = '';
  };

  return (
    <div
      className="flex items-center gap-3 px-5 py-2.5 rounded-2xl border border-white/10"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.60)', backdropFilter: 'blur(20px)' }}
    >
      {/* Voice button */}
      {!isConnected ? (
        <button
          onClick={onStart}
          className="px-6 py-2 text-black font-bold text-xs rounded-lg transition-all shadow-[0_0_20px_rgba(212,175,55,0.35)]"
          style={{ backgroundColor: '#d4af37' }}
        >
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-black animate-pulse" />
            AWAKEN
          </span>
        </button>
      ) : (
        <button
          onClick={onStop}
          className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white/50 text-xs font-medium rounded-lg transition-all border border-white/10"
        >
          SLEEP
        </button>
      )}

      {/* Divider */}
      <div className="w-px h-5 bg-white/10" />

      {/* Upload button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
        title="Upload file"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2L8 11M8 2L5 5M8 2L11 5M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.csv,.json,.js,.ts,.tsx,.py,.md"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Clear workspace button — only when items exist */}
      {itemCount > 0 && (
        <button
          onClick={onClear}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all"
          title="Clear workspace"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}

      {/* Generation status */}
      {isGenerating && (
        <>
          <div className="w-px h-5 bg-white/10" />
          <span className="text-[#d4af37] text-[10px] animate-pulse font-mono tracking-wider">
            GENERATING...
          </span>
        </>
      )}
    </div>
  );
}
