'use client';

import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface AgentLibraryProps {
  userId: string;
  onSelectAgent: (agentId: string, modelUrl: string, voiceName: string) => void;
  onClose?: () => void;
}

export function AgentLibrary({ userId, onSelectAgent, onClose }: AgentLibraryProps) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-agent voice overrides — lets users toggle before selecting
  const [voiceOverrides, setVoiceOverrides] = useState<Record<string, string>>({});

  const getVoiceForAgent = (agent: any): string => {
    return voiceOverrides[agent.id] || agent.voiceName || 'Aoede';
  };

  const toggleVoice = (agentId: string, currentVoice: string) => {
    setVoiceOverrides(prev => ({
      ...prev,
      [agentId]: currentVoice === 'Fenrir' ? 'Aoede' : 'Fenrir'
    }));
  };

  const fetchLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const agentsRef = collection(db, `users/${userId}/agents`);
      const q = query(agentsRef, where('extrusionStatus', '==', 'complete'));
      const querySnapshot = await getDocs(q);

      const loadedAgents = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setAgents(loadedAgents);
    } catch (err) {
      console.error("Error fetching library:", err);
      setError("Failed to load agents. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    fetchLibrary();
  }, [userId, fetchLibrary]);

  if (loading) return <div className="text-white/50 text-center mt-10">Loading your Vault...</div>;

  if (error) {
    return (
      <div className="text-center mt-10">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchLibrary}
          className="px-4 py-2 bg-[#d4af37] hover:bg-[#d4af37]/80 rounded-lg text-black text-sm font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="w-full max-w-4xl mx-auto mt-10 p-6 bg-[#050505]/80 rounded-xl border border-[#1a1a1a]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xs tracking-[0.2em] uppercase text-[#d4af37]/60">LXXI.VAULT // YOUR SOULS</h2>
          {onClose && (
            <button onClick={onClose} className="text-white/30 hover:text-white/60 text-sm transition-colors">✕</button>
          )}
        </div>
        <p className="text-[#8a8a8a] text-center py-8">Vault is empty. Forge a new soul.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto mt-10 p-6 bg-[#050505]/80 rounded-xl border border-[#1a1a1a]">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xs tracking-[0.2em] uppercase text-[#d4af37]/60">LXXI.VAULT // YOUR SOULS</h2>
        {onClose && (
          <button onClick={onClose} className="text-white/30 hover:text-white/60 text-sm transition-colors">✕</button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {agents.map((agent) => {
          const voice = getVoiceForAgent(agent);
          return (
            <div
              key={agent.id}
              className="flex flex-col items-center p-4 bg-[#0a0a0a] border border-[#1a1a1a] hover:border-[#d4af37]/40 rounded-lg transition-all"
            >
              {/* Character name or archetype fallback */}
              <span className="text-[#d4af37] font-bold mb-0.5 text-center">
                {agent.characterName || agent.archetype || "Unknown Entity"}
              </span>
              {/* Show archetype as subtitle when characterName exists */}
              {agent.characterName && (
                <span className="text-[10px] text-white/30 mb-2">{agent.archetype}</span>
              )}
              {!agent.characterName && <div className="mb-2" />}

              {/* Voice toggle */}
              <div className="flex gap-1 mb-3">
                <button
                  onClick={(e) => { e.stopPropagation(); toggleVoice(agent.id, voice); }}
                  className={`px-2 py-0.5 text-[9px] rounded transition-all ${
                    voice === 'Fenrir' ? 'bg-[#d4af37] text-black font-bold' : 'bg-white/5 text-white/30 hover:text-white/50'
                  }`}
                >
                  MALE
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleVoice(agent.id, voice); }}
                  className={`px-2 py-0.5 text-[9px] rounded transition-all ${
                    voice === 'Aoede' ? 'bg-[#d4af37] text-black font-bold' : 'bg-white/5 text-white/30 hover:text-white/50'
                  }`}
                >
                  FEMALE
                </button>
              </div>

              {/* Select button */}
              <button
                onClick={() => onSelectAgent(agent.id, agent.model3dUrl, voice)}
                className="px-4 py-1.5 bg-[#d4af37]/10 hover:bg-[#d4af37]/20 border border-[#d4af37]/30 rounded text-[#d4af37] text-xs font-bold transition-all"
              >
                AWAKEN
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
