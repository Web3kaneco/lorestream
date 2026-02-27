'use client';

import { useEffect, useState, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface AgentLibraryProps {
  userId: string;
  onSelectAgent: (agentId: string, modelUrl: string) => void;
}

export function AgentLibrary({ userId, onSelectAgent }: AgentLibraryProps) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <div className="text-white text-center mt-10">Loading your Vault...</div>;

  if (error) {
    return (
      <div className="text-center mt-10">
        <p className="text-red-400 mb-4">{error}</p>
        <button
          onClick={fetchLibrary}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white text-sm font-medium transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (agents.length === 0) return <div className="text-gray-400 text-center mt-10">Vault is empty. Forge a new soul.</div>;

  return (
    <div className="w-full max-w-4xl mx-auto mt-10 p-6 bg-black/50 rounded-xl border border-gray-800">
      <h2 className="text-2xl font-bold text-white mb-6">Your Digital Souls</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelectAgent(agent.id, agent.model3dUrl)}
            className="flex flex-col items-center p-4 bg-gray-900 border border-gray-700 hover:border-cyan-500 rounded-lg transition-all"
          >
            <span className="text-cyan-400 font-bold mb-2">
              {agent.archetype || "Unknown Entity"}
            </span>
            <span className="text-xs text-gray-400">ID: {agent.id.slice(0, 8)}...</span>
          </button>
        ))}
      </div>
    </div>
  );
}
