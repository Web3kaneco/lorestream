'use client';

import { useState } from 'react';

interface ChalkboardCardProps {
  problem: string;
  hint: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

const DIFFICULTY_CONFIG = {
  easy:   { label: 'Easy',   color: '#22c55e', stars: 1 },
  medium: { label: 'Medium', color: '#eab308', stars: 2 },
  hard:   { label: 'Hard',   color: '#ef4444', stars: 3 },
} as const;

export function ChalkboardCard({ problem, hint, difficulty }: ChalkboardCardProps) {
  const [showHint, setShowHint] = useState(false);
  const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.easy;

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg border-2"
      style={{ borderColor: config.color, backgroundColor: '#1a3a2a' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2" style={{ backgroundColor: '#0f2a1a' }}>
        <span className="text-xs font-bold tracking-wide" style={{ color: config.color }}>
          {'★'.repeat(config.stars)}{'☆'.repeat(3 - config.stars)} {config.label}
        </span>
        <span className="text-[10px] text-white/40 uppercase tracking-widest">
          Math Challenge
        </span>
      </div>

      {/* Problem display */}
      <div className="p-6 text-center">
        <p className="text-2xl md:text-3xl font-bold font-mono" style={{ color: '#f0f0e8' }}>
          {problem}
        </p>
      </div>

      {/* Hint toggle */}
      <div className="px-4 pb-4">
        <button
          onClick={() => setShowHint(!showHint)}
          className="text-xs px-3 py-1.5 rounded-full transition-all font-medium"
          style={{
            backgroundColor: showHint ? config.color : 'transparent',
            color: showHint ? '#000' : config.color,
            border: `1px solid ${config.color}`,
          }}
        >
          {showHint ? 'Hide Hint' : 'Need a Hint?'}
        </button>
        {showHint && (
          <p className="mt-3 text-sm italic" style={{ color: '#a8d5ba' }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
