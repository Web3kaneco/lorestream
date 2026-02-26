import { useCallback } from 'react';

interface ToolHandlerDeps {
  wsRef: React.MutableRefObject<WebSocket | null>;
  userId: string;
  agentId: string;
  saveToMemory: (text: string, speaker: 'user' | 'agent') => void;
  setVaultItems: React.Dispatch<React.SetStateAction<any[]>>;
  setIsGeneratingVaultItem: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscripts: React.Dispatch<React.SetStateAction<{speaker: string, text: string}[]>>;
}

export function useToolHandlers({
  wsRef, userId, agentId, saveToMemory,
  setVaultItems, setIsGeneratingVaultItem, setTranscripts
}: ToolHandlerDeps) {

  const handleToolCall = useCallback(async (functionCall: { name: string; args: any }) => {
    if (functionCall.name === "create_vault_artifact") {
      const { prompt, rationale } = functionCall.args;
      console.log(`[AGENT TOOL TRIGGERED] Creating: ${prompt}`);

      setIsGeneratingVaultItem(true);
      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: `Executing Nano-Banana Tool: Generating "${prompt}"` }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      try {
        const res = await fetch('/api/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });

        const result = await res.json();

        if (result.imageUrl) {
          setVaultItems(prev => {
            const updated = [...prev, { prompt, url: result.imageUrl, rationale }];
            return updated.length > 100 ? updated.slice(-100) : updated;
          });
          const memoryEntry = `I created an image for the user. Rationale: ${rationale}. Visual Prompt used: ${prompt}.`;
          saveToMemory(memoryEntry, 'agent');
        }

        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                name: "create_vault_artifact",
                response: { result: "Success", action: "Image generated and saved to vault." }
              }]
            }
          }));
        }
      } catch (err) {
        console.error("Tool Execution Failed:", err);
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{ name: "create_vault_artifact", response: { error: "Failed to generate image." } }]
            }
          }));
        }
      } finally {
        setIsGeneratingVaultItem(false);
      }
    }

    if (functionCall.name === "search_memory") {
      const { query } = functionCall.args;
      console.log(`[AGENT SEARCHING MEMORY] Query: "${query}"`);
      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: `Searching Pinecone Memory Vault for: "${query}"...` }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      try {
        const res = await fetch('/api/memory/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, userId, agentId })
        });

        const result = await res.json();

        const retrievedMemories = result.memories && result.memories.length > 0
          ? result.memories.join('\n- ')
          : "No relevant memories found in the database for this query.";

        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{
                name: "search_memory",
                response: {
                  result: "Success",
                  action: "Retrieved relevant memories.",
                  memories_found: retrievedMemories
                }
              }]
            }
          }));
        }
      } catch (err) {
        console.error("Memory Search Failed:", err);
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({
            toolResponse: {
              functionResponses: [{ name: "search_memory", response: { error: "Failed to access Pinecone memory vault." } }]
            }
          }));
        }
      }
    }
  }, [wsRef, userId, agentId, saveToMemory, setVaultItems, setIsGeneratingVaultItem, setTranscripts]);

  return { handleToolCall };
}
