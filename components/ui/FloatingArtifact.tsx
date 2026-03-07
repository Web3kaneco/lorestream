'use client';

import { DocumentCard } from './DocumentCard';

interface FloatingArtifactProps {
  item: any; // VaultItem union type
  index: number;
  total: number;
  isNewest: boolean;
  onDismiss: () => void;
}

// Predefined positions for floating cards — fan out from center-right
const POSITIONS = [
  { top: '12vh', right: '4vw', maxWidth: 400, scale: 1, opacity: 1 },
  { top: '8vh', right: '2vw', maxWidth: 320, scale: 0.9, opacity: 0.9 },
  { top: '38vh', right: '2vw', maxWidth: 320, scale: 0.85, opacity: 0.8 },
  { top: '58vh', right: '2vw', maxWidth: 300, scale: 0.8, opacity: 0.7 },
  { top: '5vh', right: '24vw', maxWidth: 300, scale: 0.75, opacity: 0.6 },
];

function getCardStyle(index: number, total: number): React.CSSProperties {
  const rank = total - 1 - index; // 0 = newest
  const pos = POSITIONS[Math.min(rank, POSITIONS.length - 1)];

  return {
    position: 'absolute',
    top: pos.top,
    right: pos.right,
    maxWidth: `${pos.maxWidth}px`,
    transform: `scale(${pos.scale})`,
    opacity: pos.opacity,
    zIndex: 25 - rank,
    transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    transformOrigin: 'top right',
  };
}

export function FloatingArtifact({ item, index, total, isNewest, onDismiss }: FloatingArtifactProps) {
  const style = getCardStyle(index, total);

  const handleDownload = () => {
    if (item.type === 'image' && item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = `lxxi_${Date.now()}.png`;
      a.target = '_blank';
      a.click();
    }
  };

  return (
    <div
      style={style}
      className={`pointer-events-auto ${isNewest ? 'animate-float-in' : ''}`}
    >
      <div className="relative rounded-2xl overflow-hidden border border-[#d4af37]/20 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
           style={{ backgroundColor: 'rgba(10, 10, 10, 0.80)', backdropFilter: 'blur(20px)' }}>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 text-white/30 hover:text-white/70 hover:bg-black/80 transition-colors text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>

        {/* Image artifact */}
        {item.type === 'image' && (
          <div className="p-2">
            <img
              src={item.url}
              alt={item.prompt || 'Generated'}
              className="w-full rounded-xl object-contain max-h-[50vh]"
            />
            {item.prompt && (
              <p className="text-[10px] text-white/30 mt-2 px-1 leading-relaxed line-clamp-2">
                {item.prompt}
              </p>
            )}
            <div className="flex justify-end mt-1.5 px-1 pb-1">
              <button
                onClick={handleDownload}
                className="text-[10px] px-2.5 py-1 rounded-lg font-bold transition-colors"
                style={{ backgroundColor: '#d4af37', color: '#000' }}
              >
                Download
              </button>
            </div>
          </div>
        )}

        {/* Document artifact */}
        {item.type === 'document' && (
          <DocumentCard
            title={item.title}
            content={item.content}
            language={item.language}
            description={item.description}
            index={index}
          />
        )}

        {/* Fallback for unknown types */}
        {item.type !== 'image' && item.type !== 'document' && (
          <div className="p-4">
            <p className="text-xs text-white/50">{item.prompt || item.problem || 'Artifact'}</p>
          </div>
        )}
      </div>
    </div>
  );
}
