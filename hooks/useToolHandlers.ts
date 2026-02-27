import { useCallback } from 'react';

interface ToolHandlerDeps {
  wsRef: React.MutableRefObject<WebSocket | null>;
  userId: string;
  agentId: string;
  saveToMemory: (text: string, speaker: 'user' | 'agent') => void;
  setVaultItems: React.Dispatch<React.SetStateAction<any[]>>;
  setIsGeneratingVaultItem: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscripts: React.Dispatch<React.SetStateAction<{speaker: string, text: string}[]>>;
  onToolCallback?: (toolName: string, args: any) => void;
}

export function useToolHandlers({
  wsRef, userId, agentId, saveToMemory,
  setVaultItems, setIsGeneratingVaultItem, setTranscripts,
  onToolCallback
}: ToolHandlerDeps) {

  const handleToolCall = useCallback(async (functionCall: { name: string; args: any; id?: string }) => {
    // --- Image generation tool ---
    if (functionCall.name === "create_vault_artifact") {
      const { prompt, rationale } = functionCall.args;
      console.log(`[AGENT TOOL TRIGGERED] Creating: ${prompt}`);

      setIsGeneratingVaultItem(true);
      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: `Generating image: "${prompt}"` }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Send tool response IMMEDIATELY so the model can keep talking
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{
              id: functionCall.id,
              name: "create_vault_artifact",
              response: { result: "Success", action: "Image generation started. It will appear in the vault shortly." }
            }]
          }
        }));
      }

      // Fire-and-forget: generate image in background while agent keeps talking
      fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
        .then(res => res.json())
        .then(result => {
          if (result.imageUrl) {
            setVaultItems(prev => {
              const updated = [...prev, { prompt, url: result.imageUrl, rationale }];
              return updated.length > 100 ? updated.slice(-100) : updated;
            });
            saveToMemory(`I created an image. Rationale: ${rationale}. Prompt: ${prompt}.`, 'agent');
          }
        })
        .catch(err => console.error("Image generation failed:", err))
        .finally(() => setIsGeneratingVaultItem(false));
    }

    // --- Memory search tool ---
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
                id: functionCall.id,
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
              functionResponses: [{ id: functionCall.id, name: "search_memory", response: { error: "Failed to access Pinecone memory vault." } }]
            }
          }));
        }
      }
    }

    // --- Save new agent lore (Architect interview) ---
    if (functionCall.name === "save_new_agent_lore") {
      console.log("[ARCHITECT] Saving character lore:", functionCall.args);

      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: 'Character lore captured and saved.' }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Delegate the actual Firestore write to the page via callback
      if (onToolCallback) {
        onToolCallback('save_new_agent_lore', functionCall.args);
      }

      // Send success response back to Gemini
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({
          toolResponse: {
            functionResponses: [{
              id: functionCall.id,
              name: "save_new_agent_lore",
              response: {
                result: "Success",
                action: "Character lore has been saved. Tell the user their character's essence has been captured and ask them to upload an image of their character."
              }
            }]
          }
        }));
      }
    }
  }, [wsRef, userId, agentId, saveToMemory, setVaultItems, setIsGeneratingVaultItem, setTranscripts, onToolCallback]);

  return { handleToolCall };
}
