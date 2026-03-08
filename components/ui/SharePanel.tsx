'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { StagedFile } from '@/types/lxxi';

interface SharePanelProps {
  isConnected: boolean;
  isGenerating: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onSendContext: (text: string, attachments: StagedFile[]) => boolean;
  itemCount: number;
}

/** Read a File as base64 (strips the data:...;base64, prefix). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function SharePanel({
  isConnected,
  isGenerating,
  onStart,
  onStop,
  onClear,
  onSendContext,
  itemCount,
}: SharePanelProps) {
  const [textInput, setTextInput] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }, [textInput]);

  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!files) return;
    const newFiles: StagedFile[] = [];
    for (const file of Array.from(files)) {
      const base64 = await readFileAsBase64(file);
      newFiles.push({
        id: crypto.randomUUID(),
        base64,
        mimeType: file.type || 'application/octet-stream',
        name: file.name,
        thumbnail: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
      });
    }
    setStagedFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((id: string) => {
    setStagedFiles(prev => {
      const removed = prev.find(f => f.id === id);
      if (removed?.thumbnail) URL.revokeObjectURL(removed.thumbnail);
      return prev.filter(f => f.id !== id);
    });
  }, []);

  const handleSend = useCallback(() => {
    if (!textInput.trim() && stagedFiles.length === 0) return;
    if (!isConnected) return;
    const sent = onSendContext(textInput, stagedFiles);
    if (sent) {
      setTextInput('');
      // Revoke object URLs to prevent memory leaks
      stagedFiles.forEach(f => { if (f.thumbnail) URL.revokeObjectURL(f.thumbnail); });
      setStagedFiles([]);
    }
  }, [textInput, stagedFiles, isConnected, onSendContext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Drag-and-drop support
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
  }, [handleFilesSelected]);

  const hasContent = textInput.trim() || stagedFiles.length > 0;

  // File type icon for non-image files
  const fileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const codeExts = ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'html', 'css', 'md'];
    if (codeExts.includes(ext)) return '</>';
    if (ext === 'pdf') return 'PDF';
    return 'DOC';
  };

  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-[92%] max-w-3xl transition-all ${isDragOver ? 'scale-[1.02]' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Staged files — thumbnail row */}
      {stagedFiles.length > 0 && (
        <div className="flex gap-2 px-3 pb-2 overflow-x-auto scrollbar-hide">
          {stagedFiles.map(f => (
            <div
              key={f.id}
              className="relative flex-shrink-0 rounded-lg border border-[#d4af37]/30 overflow-hidden bg-black/70 backdrop-blur-sm group"
            >
              {f.thumbnail ? (
                <img
                  src={f.thumbnail}
                  alt={f.name}
                  className="w-14 h-14 object-cover"
                />
              ) : (
                <div className="w-14 h-14 flex flex-col items-center justify-center">
                  <span className="text-[#d4af37] text-[10px] font-bold">{fileIcon(f.name)}</span>
                  <span className="text-white/40 text-[8px] truncate max-w-[48px] mt-0.5">{f.name}</span>
                </div>
              )}
              {/* Remove button */}
              <button
                onClick={() => removeFile(f.id)}
                className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-black/90 border border-white/20 rounded-full flex items-center justify-center text-white/60 hover:text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Main input bar */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-2xl border transition-colors ${
          isDragOver
            ? 'border-[#d4af37]/60 bg-[#d4af37]/5'
            : 'border-[#d4af37]/20 bg-[rgba(10,10,10,0.80)]'
        }`}
        style={{ backdropFilter: 'blur(20px)' }}
      >
        {/* AWAKEN / SLEEP button */}
        <button
          onClick={isConnected ? onStop : onStart}
          className={`px-4 py-1.5 rounded-xl text-xs font-bold tracking-wider transition-all flex-shrink-0 ${
            isConnected
              ? 'bg-white/10 text-white/50 hover:bg-white/15 hover:text-white/70'
              : 'text-black hover:brightness-110'
          }`}
          style={!isConnected ? { backgroundColor: '#d4af37' } : undefined}
        >
          {isConnected ? 'SLEEP' : 'AWAKEN'}
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-white/10 flex-shrink-0" />

        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={textInput}
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? 'Type context, paste a link, or drop files...' : 'Press AWAKEN to start...'}
          disabled={!isConnected}
          rows={1}
          className="flex-1 bg-transparent text-white/80 placeholder:text-white/20 font-mono text-sm resize-none outline-none disabled:opacity-30 min-w-0"
          style={{ maxHeight: '80px' }}
        />

        {/* Generation status */}
        {isGenerating && (
          <span className="text-[#d4af37] text-[10px] font-bold tracking-wider animate-pulse whitespace-nowrap flex-shrink-0">
            GENERATING...
          </span>
        )}

        {/* Clear workspace */}
        {itemCount > 0 && (
          <button
            onClick={onClear}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            title="Clear workspace"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
            </svg>
          </button>
        )}

        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!isConnected}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-white/30 hover:text-[#d4af37] transition-colors flex-shrink-0 disabled:opacity-30"
          title="Attach files"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!isConnected || !hasContent}
          className="px-3 py-1.5 rounded-xl text-xs font-bold tracking-wider transition-all flex-shrink-0 disabled:opacity-20"
          style={{
            backgroundColor: hasContent && isConnected ? '#d4af37' : 'transparent',
            color: hasContent && isConnected ? '#000' : 'rgba(255,255,255,0.3)',
            border: hasContent && isConnected ? 'none' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          SEND
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.csv,.json,.js,.ts,.tsx,.py,.md,.html,.css"
        className="hidden"
        onChange={e => {
          handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
