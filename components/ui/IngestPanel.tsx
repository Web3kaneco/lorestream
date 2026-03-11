'use client';

import { useState, useRef, useCallback } from 'react';

interface IngestPanelProps {
  onIngest: (fileBase64: string, fileMimeType: string, fileName: string, description?: string) => Promise<{ success: boolean; count?: number; error?: string }>;
  onClose: () => void;
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

type IngestState = 'idle' | 'uploading' | 'done' | 'error';

export function IngestPanel({ onIngest, onClose }: IngestPanelProps) {
  const [file, setFile] = useState<{ base64: string; mimeType: string; name: string; thumbnail: string } | null>(null);
  const [description, setDescription] = useState('');
  const [state, setState] = useState<IngestState>('idle');
  const [resultMessage, setResultMessage] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    const base64 = await readFileAsBase64(f);
    setFile({
      base64,
      mimeType: f.type || 'application/octet-stream',
      name: f.name,
      thumbnail: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
    });
    setState('idle');
    setResultMessage('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleIngest = useCallback(async () => {
    if (!file) return;
    setState('uploading');
    setResultMessage('');

    try {
      const result = await onIngest(file.base64, file.mimeType, file.name, description || undefined);
      if (result.success) {
        setState('done');
        setResultMessage(`Embedded ${result.count || 1} memory vector${(result.count || 1) > 1 ? 's' : ''}`);
        // Clear after success
        setTimeout(() => {
          setFile(null);
          setDescription('');
          setState('idle');
          setResultMessage('');
        }, 2000);
      } else {
        setState('error');
        setResultMessage(result.error || 'Ingestion failed');
      }
    } catch (err) {
      setState('error');
      setResultMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [file, description, onIngest]);

  const clearFile = useCallback(() => {
    if (file?.thumbnail) URL.revokeObjectURL(file.thumbnail);
    setFile(null);
    setState('idle');
    setResultMessage('');
  }, [file]);

  // File type icon
  const fileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (['js', 'ts', 'tsx', 'py', 'json', 'html', 'css', 'md'].includes(ext)) return '</>';
    if (ext === 'pdf') return 'PDF';
    if (ext === 'csv') return 'CSV';
    return 'DOC';
  };

  return (
    <div
      className="mb-2 rounded-xl border border-[#d4af37]/20 bg-[rgba(10,10,10,0.90)] overflow-hidden transition-all"
      style={{ backdropFilter: 'blur(20px)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#d4af37" strokeWidth="2">
            <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
            <path d="M9 22h6M10 17v5M14 17v5" />
          </svg>
          <span className="text-[#d4af37] text-[10px] font-bold tracking-widest">INGEST MEMORY</span>
        </div>
        <button
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center rounded text-white/30 hover:text-white/60 transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="px-3 py-3">
        {!file ? (
          /* Drop zone */
          <div
            className={`flex flex-col items-center justify-center py-5 rounded-lg border border-dashed transition-colors cursor-pointer ${
              isDragOver ? 'border-[#d4af37]/60 bg-[#d4af37]/5' : 'border-white/10 hover:border-white/20'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/20 mb-1.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            <span className="text-white/25 text-[10px] font-mono">Drop image, PDF, or text file</span>
          </div>
        ) : (
          /* File preview + description + action */
          <div className="flex flex-col gap-2">
            {/* File preview row */}
            <div className="flex items-center gap-2">
              {file.thumbnail ? (
                <img src={file.thumbnail} alt={file.name} className="w-10 h-10 rounded object-cover border border-white/10" />
              ) : (
                <div className="w-10 h-10 rounded border border-white/10 flex flex-col items-center justify-center bg-white/5">
                  <span className="text-[#d4af37] text-[9px] font-bold">{fileIcon(file.name)}</span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white/60 text-[11px] font-mono truncate">{file.name}</p>
                <p className="text-white/20 text-[9px] font-mono">{file.mimeType}</p>
              </div>
              <button onClick={clearFile} className="text-white/20 hover:text-white/50 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Description input */}
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe this memory (optional)..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-white/70 placeholder:text-white/15 text-[11px] font-mono outline-none focus:border-[#d4af37]/30 transition-colors"
            />

            {/* Action row */}
            <div className="flex items-center justify-between">
              {resultMessage && (
                <span className={`text-[10px] font-mono ${state === 'done' ? 'text-green-400/80' : state === 'error' ? 'text-red-400/80' : 'text-white/30'}`}>
                  {resultMessage}
                </span>
              )}
              {!resultMessage && <span />}
              <button
                onClick={handleIngest}
                disabled={state === 'uploading' || state === 'done'}
                className="px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider transition-all disabled:opacity-30"
                style={{
                  backgroundColor: state === 'uploading' || state === 'done' ? 'transparent' : '#d4af37',
                  color: state === 'uploading' || state === 'done' ? 'rgba(255,255,255,0.3)' : '#000',
                  border: state === 'uploading' || state === 'done' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                }}
              >
                {state === 'uploading' ? 'EMBEDDING...' : state === 'done' ? 'DONE' : 'EMBED'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf,.txt,.csv,.json,.md,.html,.css,.js,.ts,.tsx,.py"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
