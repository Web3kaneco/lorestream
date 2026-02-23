'use client';

import { useState, useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

export function LoginButton() {
  const [user, setUser] = useState(auth.currentUser);

  // Listen for login/logout changes automatically
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  if (user) {
    return (
      <button onClick={() => signOut(auth)} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md text-sm transition font-medium backdrop-blur-sm border border-white/20">
        Log Out
      </button>
    );
  }

  return (
    <button onClick={handleLogin} className="px-4 py-2 bg-white hover:bg-gray-200 text-black rounded-md text-sm transition font-medium shadow-lg">
      Log In
    </button>
  );
}