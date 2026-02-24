// hooks/useAgentMemory.ts
import { useCallback } from 'react';

export function useAgentMemory(agentId: string, userId: string) {
  const saveToMemory = useCallback(async (text: string, speaker: 'user' | 'agent') => {
    try {
      await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, userId, transcript: text, speaker })
      });
    } catch (err) {
      console.error("🚨 Failed to save memory:", err);
    }
  }, [agentId, userId]);

  return { saveToMemory };
}