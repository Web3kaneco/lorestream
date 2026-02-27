'use client';

import { useTheme } from '@/lib/theme';
import { useRouter } from 'next/navigation';

export function ModeSwitcher() {
  const { mode, setMode } = useTheme();
  const router = useRouter();

  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
      <button
        onClick={() => { setMode('creator'); router.push('/'); }}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          mode === 'creator'
            ? 'bg-cyan-500 text-black shadow-lg'
            : 'text-white/60 hover:text-white'
        }`}
      >
        Creator
      </button>
      <button
        onClick={() => { setMode('tutor'); router.push('/tutor'); }}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          mode === 'tutor'
            ? 'bg-amber-500 text-black shadow-lg'
            : 'text-white/60 hover:text-white'
        }`}
      >
        Tutor
      </button>
    </div>
  );
}
