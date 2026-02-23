'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase'; // Make sure this path points to your firebase config

interface AgentLibraryProps {
  userId: string;
  onSelectAgent: (agentId: string, modelUrl: string) => void;
}

export function AgentLibrary({ userId, onSelectAgent }: AgentLibraryProps) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;

    const fetchLibrary = async () => {
      try {
        // Only fetch agents that successfully generated a 3D model
        const agentsRef = collection(db, `users/${userId}/agents`);
        const q = query(agentsRef, where('extrusionStatus', '==', 'complete'));
        const querySnapshot = await getDocs(q);
        
        const loadedAgents = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        setAgents(loadedAgents);
      } catch (error) {
        console.error("Error fetching library:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchLibrary();
  }, [userId]);

  if (loading) return <div className="text-white text-center mt-10">Loading your Vault...</div>;

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
            {/* Since we don't have the 2D image saved yet, we'll use the Archetype as the label */}
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