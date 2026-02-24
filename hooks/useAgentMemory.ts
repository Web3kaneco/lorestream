import { useCallback } from 'react';

export function useAgentMemory(agentId: string, userId: string) {
  const saveToMemory = useCallback(async (text: string, speaker: 'user' | 'agent') => {
    // Guardrail: Do not send empty strings to the backend
    if (!text || text.trim() === '') {
      return; 
    }

    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, userId, transcript: text, speaker })
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }
    } catch (err) {
      console.error("🚨 Failed to save memory:", err);
    }
  }, [agentId, userId]);

  return { saveToMemory };
}