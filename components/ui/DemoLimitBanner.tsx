'use client';

import { useState } from 'react';
import { auth } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

export function DemoLimitBanner() {
  const [dismissed, setDismissed] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  if (dismissed) return null;

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // After login, the auth state change will trigger isAdmin re-evaluation
      // If they're whitelisted, they'll get full access on next session
    } catch (error) {
      console.error("Login failed:", error);
    }
    setIsLoggingIn(false);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Banner card */}
      <div className="relative z-10 max-w-md w-full mx-4 p-8 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl text-center">
        {/* Decorative glow */}
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 bg-[#d4af37]/20 rounded-full blur-3xl pointer-events-none" />

        <h2 className="text-2xl font-bold text-white mb-2 relative">
          You&apos;ve experienced WOW&apos;s voice
        </h2>

        <p className="text-white/60 text-sm mb-6 leading-relaxed relative">
          This was a demo of LXXI&apos;s voice-first AI workspace.
          With full access, WOW can generate images, create documents,
          remember your conversations, and so much more.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center relative">
          <button
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="px-6 py-3 bg-[#d4af37] hover:bg-[#c4a030] text-black font-bold rounded-lg transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-[#d4af37]/20"
          >
            {isLoggingIn ? 'Signing in...' : 'Log In with Google'}
          </button>

          <button
            onClick={() => setDismissed(true)}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white/80 rounded-lg transition-all border border-white/10"
          >
            Continue Watching
          </button>
        </div>

        <p className="text-white/30 text-xs mt-4 relative">
          Contact the team for full access credentials
        </p>
      </div>
    </div>
  );
}
