'use client';

import { useState, useEffect } from 'react';

interface HintArrowProps {
  text: string;
  direction?: 'down' | 'up' | 'left' | 'right';
  dismissKey?: string;
  className?: string;
}

/**
 * Curved arrow with annotation text. Dismissable via localStorage.
 * Used for first-time onboarding hints.
 */
export function HintArrow({ text, direction = 'down', dismissKey, className = '' }: HintArrowProps) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (dismissKey && typeof window !== 'undefined') {
      if (localStorage.getItem(dismissKey) === 'true') {
        setDismissed(true);
      }
    }
  }, [dismissKey]);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (dismissKey) {
      localStorage.setItem(dismissKey, 'true');
    }
  };

  // SVG arrow paths for each direction (curved bezier)
  const arrowPaths: Record<string, { path: string; viewBox: string; w: number; h: number }> = {
    down: {
      path: 'M12 4 C12 4, 30 8, 28 28 M24 22 L28 28 L22 26',
      viewBox: '0 0 40 36',
      w: 40,
      h: 36,
    },
    up: {
      path: 'M12 32 C12 32, 30 28, 28 8 M24 14 L28 8 L22 10',
      viewBox: '0 0 40 36',
      w: 40,
      h: 36,
    },
    left: {
      path: 'M36 12 C36 12, 32 30, 8 28 M14 24 L8 28 L12 22',
      viewBox: '0 0 40 36',
      w: 40,
      h: 36,
    },
    right: {
      path: 'M4 12 C4 12, 8 30, 32 28 M26 24 L32 28 L28 22',
      viewBox: '0 0 40 36',
      w: 40,
      h: 36,
    },
  };

  const arrow = arrowPaths[direction];

  // Position text relative to arrow direction
  const textPosition = direction === 'down' ? 'mb-1' :
    direction === 'up' ? 'mt-1' :
    direction === 'left' ? 'mr-1' :
    'ml-1';

  const flexDir = direction === 'down' ? 'flex-col' :
    direction === 'up' ? 'flex-col-reverse' :
    direction === 'left' ? 'flex-row-reverse' :
    'flex-row';

  return (
    <div className={`flex ${flexDir} items-center gap-1 animate-hint-float ${className}`}>
      <div className={`flex items-center gap-2 ${textPosition}`}>
        <span className="text-xs text-[#d4af37]/60 font-mono whitespace-nowrap max-w-[200px] leading-tight">
          {text}
        </span>
        {dismissKey && (
          <button
            onClick={handleDismiss}
            className="text-white/20 hover:text-white/50 text-xs transition-colors flex-shrink-0"
            aria-label="Dismiss hint"
          >
            ✕
          </button>
        )}
      </div>
      <svg
        width={arrow.w}
        height={arrow.h}
        viewBox={arrow.viewBox}
        fill="none"
        className="text-[#d4af37]/40 flex-shrink-0"
      >
        <path
          d={arrow.path}
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
