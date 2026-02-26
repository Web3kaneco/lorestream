import { useCallback, useRef, useEffect } from 'react';

export function useAgentMemory(agentId: string, userId: string) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const saveToMemory = useCallback(async (text: string, speaker: 'user' | 'agent') => {
    if (!text || text.trim() === '') return;

    abortControllerRef.current = new AbortController();

    const doFetch = async (attempt: number) => {
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, userId, transcript: text, speaker }),
          signal: abortControllerRef.current?.signal
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `HTTP ${res.status}`);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (attempt < 1) {
          // Retry once after 2s
          await new Promise(r => setTimeout(r, 2000));
          return doFetch(attempt + 1);
        }
        console.error("[MEMORY SAVE FAILED]", err);
      }
    };

    doFetch(0);
  }, [agentId, userId]);

  // Abort any in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  return { saveToMemory };
}
