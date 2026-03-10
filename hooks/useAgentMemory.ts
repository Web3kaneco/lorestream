import { useCallback, useRef, useEffect } from 'react';
import { getAuthHeaders } from '@/lib/getAuthToken';

export function useAgentMemory(agentId: string, userId: string) {
  // Track all active controllers for proper cleanup (fixes race condition with single ref)
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const lastSavedRef = useRef<string>('');

  const saveToMemory = useCallback(async (text: string, speaker: 'user' | 'agent') => {
    if (!text || text.trim() === '') return;
    // Skip duplicate saves (same text within short window)
    if (text === lastSavedRef.current) return;
    lastSavedRef.current = text;

    const controller = new AbortController();
    activeControllersRef.current.add(controller);

    const doFetch = async (attempt: number) => {
      try {
        const hdrs = await getAuthHeaders();
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({ agentId, transcript: text, speaker }),
          signal: controller.signal
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
      } finally {
        activeControllersRef.current.delete(controller);
      }
    };

    doFetch(0).catch(() => {}); // Explicitly handle fire-and-forget
  }, [agentId, userId]);

  // Abort ALL in-flight requests on unmount
  useEffect(() => {
    return () => {
      activeControllersRef.current.forEach(c => c.abort());
      activeControllersRef.current.clear();
    };
  }, []);

  return { saveToMemory };
}
