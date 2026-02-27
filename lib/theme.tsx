'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { LXXIMode } from '@/types/lxxi';

type ThemeMode = LXXIMode;

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'prime',
  setMode: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('prime');

  useEffect(() => {
    const stored = localStorage.getItem('lxxi-theme') as ThemeMode | null;
    if (stored === 'prime' || stored === 'spark') {
      setModeState(stored);
      document.documentElement.setAttribute('data-theme', stored);
    } else {
      document.documentElement.setAttribute('data-theme', 'prime');
    }
  }, []);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem('lxxi-theme', newMode);
    document.documentElement.setAttribute('data-theme', newMode);
  };

  return (
    <ThemeContext.Provider value={{ mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}
