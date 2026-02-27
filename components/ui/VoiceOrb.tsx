'use client';

import { useRef, useEffect } from 'react';
import type { VisemeData } from '@/hooks/useGeminiLive';

interface VoiceOrbProps {
  volumeRef: React.MutableRefObject<VisemeData>;
  isActive: boolean;
}

export function VoiceOrb({ volumeRef, isActive }: VoiceOrbProps) {
  const orbRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      if (orbRef.current) orbRef.current.style.transform = 'scale(1)';
      return;
    }

    const animate = () => {
      if (orbRef.current && volumeRef.current) {
        const vol = volumeRef.current.volume;
        const scale = 1 + vol * 0.5;
        const glow = Math.min(vol * 80, 40);
        orbRef.current.style.transform = `scale(${scale})`;
        orbRef.current.style.boxShadow = `0 0 ${glow}px ${glow / 2}px rgba(34, 211, 238, ${0.3 + vol * 0.4})`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive, volumeRef]);

  return (
    <div className="flex items-center justify-center">
      <div
        ref={orbRef}
        className="w-32 h-32 rounded-full transition-transform duration-75"
        style={{
          background: isActive
            ? 'radial-gradient(circle, rgba(34,211,238,0.4) 0%, rgba(34,211,238,0.1) 50%, transparent 70%)'
            : 'radial-gradient(circle, rgba(100,100,100,0.2) 0%, transparent 70%)',
          boxShadow: isActive
            ? '0 0 20px 10px rgba(34, 211, 238, 0.2)'
            : '0 0 10px 5px rgba(100, 100, 100, 0.1)',
          border: isActive ? '2px solid rgba(34, 211, 238, 0.3)' : '2px solid rgba(100, 100, 100, 0.2)'
        }}
      />
    </div>
  );
}
