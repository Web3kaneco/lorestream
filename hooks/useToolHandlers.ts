import { useCallback } from 'react';
import { getAuthHeaders } from '@/lib/getAuthToken';
import type { MemoryImage } from './useAgentMemory';

interface ToolHandlerDeps {
  safeSend: (payload: any) => boolean;
  userId: string;
  agentId: string;
  saveToMemory: (text: string, speaker: 'user' | 'agent', image?: MemoryImage) => void;
  setVaultItems: React.Dispatch<React.SetStateAction<any[]>>;
  setIsGeneratingVaultItem: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscripts: React.Dispatch<React.SetStateAction<{speaker: string, text: string}[]>>;
  onToolCallback?: (toolName: string, args: any) => void;
}

const MAX_TRANSCRIPTS = 500;

export function useToolHandlers({
  safeSend, userId, agentId, saveToMemory,
  setVaultItems, setIsGeneratingVaultItem, setTranscripts,
  onToolCallback
}: ToolHandlerDeps) {

  // Shared helper — appends a transcript entry with bounded history
  const appendTranscript = useCallback((speaker: string, text: string) => {
    setTranscripts(prev => {
      const updated = [...prev, { speaker, text }];
      return updated.length > MAX_TRANSCRIPTS ? updated.slice(-MAX_TRANSCRIPTS) : updated;
    });
  }, [setTranscripts]);

  const handleToolCall = useCallback(async (functionCall: { name: string; args: any; id?: string }) => {
    // --- Image generation tool (with optional reference images) ---
    if (functionCall.name === "create_vault_artifact") {
      const { prompt, rationale, referenceImageUrls } = functionCall.args;
      console.log(`[AGENT TOOL TRIGGERED] Creating: ${prompt}${referenceImageUrls?.length ? ` (with ${referenceImageUrls.length} references)` : ''}`);

      setIsGeneratingVaultItem(true);
      appendTranscript('SYSTEM', `Generating image: "${prompt}"${referenceImageUrls?.length ? ` (using ${referenceImageUrls.length} reference images)` : ''}`);

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
      getAuthHeaders().then(hdrs => fetch('/api/generate-image', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ prompt, referenceImageUrls })
      }))
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

            // Embed image + prompt together (multimodal memory via Gemini Embedding 2)
            saveToMemory(
              `I created an image. Rationale: ${rationale}. Prompt: ${prompt}.`,
              'agent',
              { url: finalUrl, mimeType: 'image/png' }
            );
          }
        })
        .catch(err => {
          console.error("Image generation failed:", err);
          appendTranscript('SYSTEM', `Image generation failed: ${err.message || 'Unknown error'}. Try again.`);
        })
        .finally(() => setIsGeneratingVaultItem(false));
    }

    // --- Document artifact tool ---
    else if (functionCall.name === "createDocumentArtifact") {
      const { title, content, language, description } = functionCall.args;
      console.log(`[AGENT TOOL] Creating document: "${title}" (${language})`);
      appendTranscript('SYSTEM', `Creating document: "${title}"`);

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

    // --- Learning visual tool (Spark tutor mode) ---
    else if (functionCall.name === "create_learning_visual") {
      const { prompt, subject, concept } = functionCall.args;
      console.log(`[TUTOR TOOL] Learning visual: "${concept}" (${subject})`);
      appendTranscript('SYSTEM', `Creating visual aid: "${concept}"`);

      // Immediate response so Leo keeps talking while image generates
      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "create_learning_visual",
            response: { result: "Success", action: "Learning visual is being generated. Continue teaching while it appears." }
          }]
        }
      });

      // Fire-and-forget: generate educational image in background
      getAuthHeaders().then(hdrs => fetch('/api/generate-image', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ prompt })
      }))
        .then(res => {
          if (!res.ok) throw new Error(`Image API returned HTTP ${res.status}`);
          return res.json();
        })
        .then(async (result) => {
          if (result.imageUrl) {
            // Delegate to parent page via callback (Spark page renders the visual)
            if (onToolCallback) {
              onToolCallback('create_learning_visual', {
                url: result.imageUrl,
                prompt,
                subject,
                concept,
                createdAt: Date.now()
              });
            }
          }
        })
        .catch(err => {
          console.error("Learning visual generation failed:", err);
          appendTranscript('SYSTEM', 'Visual aid generation failed. Continuing lesson.');
        });
    }

    // --- Memory search tool ---
    else if (functionCall.name === "search_memory") {
      const { query } = functionCall.args;
      console.log(`[AGENT SEARCHING MEMORY] Query: "${query}"`);
      appendTranscript('SYSTEM', `Searching Pinecone Memory Vault for: "${query}"...`);

      try {
        const memHdrs = await getAuthHeaders();
        const res = await fetch('/api/memory/search', {
          method: 'POST',
          headers: memHdrs,
          body: JSON.stringify({ query, agentId })
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

    // --- Record learner progress (Spark tutor mode) ---
    else if (functionCall.name === "record_progress") {
      const { subject, correct, topic } = functionCall.args;
      console.log(`[TUTOR TOOL] Progress: ${subject} ${correct ? 'correct' : 'incorrect'} (${topic})`);

      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "record_progress",
            response: { result: "Success", action: "Progress recorded." }
          }]
        }
      });

      if (onToolCallback) {
        onToolCallback('record_progress', { subject, correct, topic });
      }
    }

    // --- Save learner name (Spark tutor mode) ---
    else if (functionCall.name === "save_learner_name") {
      const { name } = functionCall.args;
      console.log(`[TUTOR TOOL] Saving learner name: ${name}`);

      safeSend({
        toolResponse: {
          functionResponses: [{
            id: functionCall.id,
            name: "save_learner_name",
            response: { result: "Success", action: `Student name "${name}" saved. Use their name throughout the conversation.` }
          }]
        }
      });

      if (onToolCallback) {
        onToolCallback('save_learner_name', { name });
      }
    }

    // --- Save new agent lore (Architect interview) ---
    else if (functionCall.name === "save_new_agent_lore") {
      console.log("[ARCHITECT] Saving character lore:", functionCall.args);
      appendTranscript('SYSTEM', 'Character lore captured and saved.');

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
  }, [safeSend, userId, agentId, saveToMemory, setVaultItems, setIsGeneratingVaultItem, appendTranscript, onToolCallback]);

  return { handleToolCall };
}
