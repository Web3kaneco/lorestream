'use client';

import { useTheme } from '@/lib/theme';
import { useRouter } from 'next/navigation';

export function ModeSwitcher() {
  const { mode, setMode } = useTheme();
  const router = useRouter();

  return (
    <div className="flex items-center gap-1 p-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/20">
      <button
        onClick={() => { setMode('prime'); router.push('/'); }}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          mode === 'prime'
            ? 'bg-[#d4af37] text-black shadow-lg'
            : 'text-white/60 hover:text-white'
        }`}
      >
        Prime
      </button>
      <button
        onClick={() => { setMode('spark'); router.push('/spark'); }}
        className={`px-4 py-1.5 rounded-full text-xs font-medium transition-all ${
          mode === 'spark'
            ? 'bg-amber-500 text-black shadow-lg'
            : 'text-white/60 hover:text-white'
        }`}
      >
        Spark
      </button>
    </div>
  );
}
