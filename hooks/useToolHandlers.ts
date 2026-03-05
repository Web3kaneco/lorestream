import { useCallback } from 'react';

interface ToolHandlerDeps {
  safeSend: (payload: any) => boolean;
  userId: string;
  agentId: string;
  saveToMemory: (text: string, speaker: 'user' | 'agent') => void;
  setVaultItems: React.Dispatch<React.SetStateAction<any[]>>;
  setIsGeneratingVaultItem: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscripts: React.Dispatch<React.SetStateAction<{speaker: string, text: string}[]>>;
  onToolCallback?: (toolName: string, args: any) => void;
}

export function useToolHandlers({
  safeSend, userId, agentId, saveToMemory,
  setVaultItems, setIsGeneratingVaultItem, setTranscripts,
  onToolCallback
}: ToolHandlerDeps) {

  const handleToolCall = useCallback(async (functionCall: { name: string; args: any; id?: string }) => {
    // --- Image generation tool (with optional reference images) ---
    if (functionCall.name === "create_vault_artifact") {
      const { prompt, rationale, referenceImageUrls } = functionCall.args;
      console.log(`[AGENT TOOL TRIGGERED] Creating: ${prompt}${referenceImageUrls?.length ? ` (with ${referenceImageUrls.length} references)` : ''}`);

      setIsGeneratingVaultItem(true);
      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: `Generating image: "${prompt}"${referenceImageUrls?.length ? ` (using ${referenceImageUrls.length} reference images)` : ''}` }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Send tool response IMMEDIATELY so the model can keep talking
      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "create_vault_artifact",
            response: { result: "Success", action: "Image generation started. It will appear in the vault shortly." }
          }]
        }
      });

      // Fire-and-forget: generate image in background while agent keeps talking
      fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, referenceImageUrls })
      })
        .then(res => {
          if (!res.ok) throw new Error(`Image API returned HTTP ${res.status}`);
          return res.json();
        })
        .then(async (result) => {
          if (result.imageUrl) {
            let finalUrl = result.imageUrl;

            // Upload to Firebase Storage for persistence
            try {
              const { uploadBase64Image } = await import('@/lib/storageUtils');
              const storageUrl = await uploadBase64Image(userId, result.imageUrl);
              finalUrl = storageUrl;
            } catch (e) {
              console.warn("[VAULT] Storage upload failed, using base64 URL:", e);
            }

            setVaultItems(prev => {
              const updated = [...prev, { type: 'image' as const, prompt, url: finalUrl, rationale, createdAt: Date.now() }];
              return updated.length > 100 ? updated.slice(-100) : updated;
            });

            // Persist to Firestore vault
            try {
              const { saveVaultItem } = await import('@/lib/vaultUtils');
              await saveVaultItem(userId, agentId, { type: 'image', url: finalUrl, prompt, rationale, createdAt: Date.now() });
            } catch (e) {
              console.warn("[VAULT] Firestore save failed:", e);
            }

            saveToMemory(`I created an image. Rationale: ${rationale}. Prompt: ${prompt}.`, 'agent');
          }
        })
        .catch(err => {
          console.error("Image generation failed:", err);
          setTranscripts(prev => {
            const updated = [...prev, { speaker: 'SYSTEM', text: `Image generation failed: ${err.message || 'Unknown error'}. Try again.` }];
            return updated.length > 500 ? updated.slice(-500) : updated;
          });
        })
        .finally(() => setIsGeneratingVaultItem(false));
    }

    // --- Document artifact tool ---
    else if (functionCall.name === "createDocumentArtifact") {
      const { title, content, language, description } = functionCall.args;
      console.log(`[AGENT TOOL] Creating document: "${title}" (${language})`);

      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'SYSTEM', text: `Creating document: "${title}"` }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });

      // Immediate response so model keeps talking
      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "createDocumentArtifact",
            response: { result: "Success", action: "Document created and added to the vault." }
          }]
        }
      });

      // Add to vault state
      const docItem = {
        type: 'document' as const,
        title: title || 'Untitled',
        content: content || '',
        language: language || 'text',
        description: description || '',
        createdAt: Date.now()
      };

      setVaultItems(prev => {
        const updated = [...prev, docItem];
        return updated.length > 100 ? updated.slice(-100) : updated;
      });

      // Persist to Firestore vault
      try {
        const { saveVaultItem } = await import('@/lib/vaultUtils');
        await saveVaultItem(userId, agentId, docItem);
      } catch (e) {
        console.warn("[VAULT] Firestore save for document failed:", e);
      }

      saveToMemory(`I created a document titled "${title}" (${language}). ${description || ''}`, 'agent');
    }

    // --- Chalkboard math tool (Spark mode) ---
    else if (functionCall.name === "displayChalkboard") {
      const { problem, hint, difficulty } = functionCall.args;
      console.log(`[TUTOR TOOL] Chalkboard: "${problem}" (${difficulty})`);

      // Immediate response
      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "displayChalkboard",
            response: { result: "Success", action: "Math problem displayed on the chalkboard." }
          }]
        }
      });

      // Delegate to parent page via callback (Spark page renders ChalkboardCard)
      if (onToolCallback) {
        onToolCallback('displayChalkboard', { problem, hint, difficulty });
      }
    }

    // --- Memory search tool ---
    else if (functionCall.name === "search_memory") {
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

        if (!res.ok) throw new Error(`Memory search returned HTTP ${res.status}`);
        const result = await res.json();

        const retrievedMemories = result.memories && result.memories.length > 0
          ? result.memories.join('\n- ')
          : "No relevant memories found in the database for this query.";

        safeSend({
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
        });
      } catch (err) {
        console.error("Memory Search Failed:", err);
        safeSend({
          toolResponse: {
            functionResponses: [{ id: functionCall.id, name: "search_memory", response: { error: "Failed to access Pinecone memory vault." } }]
          }
        });
      }
    }

    // --- Save new agent lore (Architect interview) ---
    else if (functionCall.name === "save_new_agent_lore") {
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
      safeSend({
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
      });
    }
  }, [safeSend, userId, agentId, saveToMemory, setVaultItems, setIsGeneratingVaultItem, setTranscripts, onToolCallback]);

  return { handleToolCall };
}
