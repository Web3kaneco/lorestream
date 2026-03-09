'use client';

import { useRef, useCallback, useState } from 'react';
import { DocumentCard } from './DocumentCard';

export interface ArtifactPosition {
  x: number; // px from left
  y: number; // px from top
}

interface FloatingArtifactProps {
  item: any; // VaultItem union type
  index: number;
  total: number;
  isNewest: boolean;
  position: ArtifactPosition;
  onDismiss: () => void;
  onDragEnd: (newPos: ArtifactPosition) => void;
}

/**
 * Compute smart initial position based on artifact type and display index.
 * Images land on the RIGHT side, documents on the LEFT side.
 * Each subsequent artifact of the same side staggers down + slightly inward.
 */
export function getInitialPosition(
  item: { type: string },
  sameTypeBefore: number, // how many artifacts of this side-type are already visible
): ArtifactPosition {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  const isRightSide = item.type === 'image';
  const stagger = sameTypeBefore; // 0, 1, 2...

  if (isRightSide) {
    // Images → top-right, stagger down and left
    return {
      x: Math.max(20, vw - 420 - stagger * 30),
      y: Math.max(60, 80 + stagger * 50),
    };
  } else {
    // Documents / code → top-left, stagger down and right
    return {
      x: Math.max(20, 40 + stagger * 30),
      y: Math.max(60, 80 + stagger * 50),
    };
  }
}

export function FloatingArtifact({
  item,
  index,
  total,
  isNewest,
  position,
  onDismiss,
  onDragEnd,
}: FloatingArtifactProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });

  // Refs for drag tracking (avoid stale closures)
  const dragRef = useRef({
    active: false,
    startPointerX: 0,
    startPointerY: 0,
    startPosX: 0,
    startPosY: 0,
    moved: false, // distinguish click from drag
  });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Don't start drag on buttons or interactive elements
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.tagName === 'A' ||
        target.closest('a') ||
        target.tagName === 'PRE' ||
        target.closest('pre')
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

      dragRef.current = {
        active: true,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startPosX: position.x,
        startPosY: position.y,
        moved: false,
      };
      setIsDragging(true);
      setDragOffset({ dx: 0, dy: 0 });
    },
    [position],
  );

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.active) return;

    const dx = e.clientX - dragRef.current.startPointerX;
    const dy = e.clientY - dragRef.current.startPointerY;

    // Mark as moved if dragged > 4px (prevents accidental drag on click)
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }

    setDragOffset({ dx, dy });
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current.active) return;

      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragRef.current.active = false;
      setIsDragging(false);

      if (dragRef.current.moved) {
        const finalX = dragRef.current.startPosX + (e.clientX - dragRef.current.startPointerX);
        const finalY = dragRef.current.startPosY + (e.clientY - dragRef.current.startPointerY);

        // Clamp to viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        onDragEnd({
          x: Math.max(0, Math.min(finalX, vw - 100)),
          y: Math.max(0, Math.min(finalY, vh - 60)),
        });
      }

      setDragOffset({ dx: 0, dy: 0 });
    },
    [onDragEnd],
  );

  const handleDownload = () => {
    if (item.type === 'image' && item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = `lxxi_${Date.now()}.png`;
      a.target = '_blank';
      a.click();
    }
  };

  // Determine max width based on type
  const maxW = item.type === 'image' ? 400 : 480;

  // Compute visual position (base + drag delta)
  const visualX = position.x + dragOffset.dx;
  const visualY = position.y + dragOffset.dy;

  // Rank for z-index: newest on top
  const rank = total - 1 - index;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        position: 'absolute',
        left: `${visualX}px`,
        top: `${visualY}px`,
        maxWidth: `${maxW}px`,
        zIndex: 25 - rank,
        transition: isDragging ? 'none' : 'left 0.3s ease, top 0.3s ease, opacity 0.4s ease',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
      className={`pointer-events-auto ${isNewest ? 'animate-float-in' : ''}`}
    >
      <div
        className="relative rounded-2xl overflow-hidden border border-[#d4af37]/20 shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        style={{
          backgroundColor: 'rgba(10, 10, 10, 0.80)',
          backdropFilter: 'blur(20px)',
          transform: isDragging ? 'scale(1.03)' : 'scale(1)',
          transition: 'transform 0.15s ease',
        }}
      >
        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/50 text-white/30 hover:text-white/70 hover:bg-black/80 transition-colors text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>

        {/* Drag handle hint */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex gap-0.5 opacity-20 hover:opacity-50 transition-opacity">
          <div className="w-1 h-1 rounded-full bg-white/60" />
          <div className="w-1 h-1 rounded-full bg-white/60" />
          <div className="w-1 h-1 rounded-full bg-white/60" />
        </div>

        {/* Image artifact */}
        {item.type === 'image' && (
          <div className="p-2">
            <img
              src={item.url}
              alt={item.prompt || 'Generated'}
              className="w-full rounded-xl object-contain max-h-[50vh]"
              draggable={false}
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
