'use client';

export function DropZone({ onAwaken, userId }: { onAwaken: (data: any) => void; userId?: string }) {

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      onAwaken({ type: 'image', base64: reader.result });

      // Also upload to Firebase Storage for vault persistence (fire-and-forget)
      if (userId) {
        import('@/lib/storageUtils').then(({ uploadFileToStorage }) => {
          uploadFileToStorage(userId, file).catch((err) =>
            console.warn('[DROPZONE] Storage upload failed:', err)
          );
        });
      }
    };
  };

  return (
    <label className="border-2 border-dashed border-white/15 w-full h-40 flex flex-col items-center justify-center rounded-xl cursor-pointer hover:border-[#d4af37]/60 transition-all bg-white/[0.02] hover:bg-[#d4af37]/[0.03] group">
      <div className="flex flex-col items-center gap-2">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-white/20 group-hover:text-[#d4af37]/50 transition-colors">
          <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 18v1a1 1 0 001 1h14a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-white/30 group-hover:text-white/50 text-xs font-mono transition-colors">
          Drop image or click to upload
        </span>
        <span className="text-white/15 text-[10px]">JPG, PNG</span>
      </div>
      <input type="file" accept="image/jpeg, image/png" className="hidden" onChange={handleFileUpload} />
    </label>
  );
}
