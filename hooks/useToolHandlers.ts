import { useCallback, useRef } from 'react';
import { getAuthHeaders } from '@/lib/getAuthToken';
import type { MemoryImage } from './useAgentMemory';

/**
 * A single function response to be sent back to Gemini.
 * The caller is responsible for batching these into a single toolResponse message.
 */
export interface FunctionResponse {
  id: string;
  name: string;
  response: Record<string, any>;
}

interface ToolHandlerDeps {
  userId: string;
  agentId: string;
  saveToMemory: (text: string, speaker: 'user' | 'agent', image?: MemoryImage) => void;
  setVaultItems: React.Dispatch<React.SetStateAction<any[]>>;
  setIsGeneratingVaultItem: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscripts: React.Dispatch<React.SetStateAction<{speaker: string, text: string}[]>>;
  onToolCallback?: (toolName: string, args: any) => void;
}

const MAX_TRANSCRIPTS = 500;

/**
 * Tool call handler hook.
 *
 * IMPORTANT: handleToolCall returns the FunctionResponse instead of sending it.
 * The caller MUST batch all responses from the same toolCall message and send
 * them in a SINGLE toolResponse WebSocket message. The Gemini Live API requires
 * all function responses from a batch to arrive together — sending them
 * individually puts the session into a broken state where the model stops
 * processing user audio.
 */
export function useToolHandlers({
  userId, agentId, saveToMemory,
  setVaultItems, setIsGeneratingVaultItem, setTranscripts,
  onToolCallback
}: ToolHandlerDeps) {

  // Generation counter for learning visuals — prevents stale images from overwriting
  // When a new visual is requested, the counter increments. If an old generation
  // completes after a newer one started, its callback is silently ignored.
  const visualGenIdRef = useRef(0);

  // Shared helper — appends a transcript entry with bounded history
  const appendTranscript = useCallback((speaker: string, text: string) => {
    setTranscripts(prev => {
      const updated = [...prev, { speaker, text }];
      return updated.length > MAX_TRANSCRIPTS ? updated.slice(-MAX_TRANSCRIPTS) : updated;
    });
  }, [setTranscripts]);

  const handleToolCall = useCallback(async (functionCall: { name: string; args: any; id?: string }): Promise<FunctionResponse | null> => {
    // Ensure we always have an ID for the response (Gemini needs it to match)
    const responseId = functionCall.id || `${functionCall.name}_${Date.now()}`;

    // --- Image generation tool (with optional reference images) ---
    if (functionCall.name === "create_vault_artifact") {
      const { prompt, rationale, referenceImageUrls } = functionCall.args;
      console.log(`[AGENT TOOL TRIGGERED] Creating: ${prompt}${referenceImageUrls?.length ? ` (with ${referenceImageUrls.length} references)` : ''}`);

      setIsGeneratingVaultItem(true);
      appendTranscript('SYSTEM', `Generating image: "${prompt}"${referenceImageUrls?.length ? ` (using ${referenceImageUrls.length} reference images)` : ''}`);

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

      return {
        id: responseId,
        name: "create_vault_artifact",
        response: { result: "Success", action: "Image generation started. It will appear in the vault shortly." }
      };
    }

    // --- Document artifact tool ---
    else if (functionCall.name === "createDocumentArtifact") {
      const { title, content, language, description } = functionCall.args;
      console.log(`[AGENT TOOL] Creating document: "${title}" (${language})`);
      appendTranscript('SYSTEM', `Creating document: "${title}"`);

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

      return {
        id: responseId,
        name: "createDocumentArtifact",
        response: { result: "Success", action: "Document created and added to the vault." }
      };
    }

    // --- Chalkboard math tool (Spark mode) ---
    else if (functionCall.name === "displayChalkboard") {
      const { problem, hint, difficulty } = functionCall.args;
      console.log(`[TUTOR TOOL] Chalkboard: "${problem}" (${difficulty})`);

      // Delegate to parent page via callback (Spark page renders ChalkboardCard)
      if (onToolCallback) {
        onToolCallback('displayChalkboard', { problem, hint, difficulty });
      }

      return {
        id: responseId,
        name: "displayChalkboard",
        response: { result: "Success", action: "Math problem displayed on the chalkboard." }
      };
    }

    // --- Learning visual tool (Spark tutor mode) ---
    else if (functionCall.name === "create_learning_visual") {
      const { prompt, subject, concept } = functionCall.args;
      console.log(`[TUTOR TOOL] Learning visual: "${concept}" (${subject})`);
      appendTranscript('SYSTEM', `Creating visual aid: "${concept}"`);

      if (subject === 'math') {
        // Math counting visuals are rendered programmatically by CountingVisual
        // component — no AI image generation needed (exact counts, instant render)
        console.log(`[TUTOR] Math visual: using programmatic CountingVisual (skipping image API)`);
        if (onToolCallback) {
          onToolCallback('create_learning_visual', { prompt, subject, concept, createdAt: Date.now() });
        }
      } else {
        // Non-math subjects (Spanish, Science): generate AI image
        // Increment generation counter — any pending older generation will be ignored
        const genId = ++visualGenIdRef.current;

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
            // Check if a newer visual generation was started while this one was running
            if (genId !== visualGenIdRef.current) {
              console.log(`[TUTOR] Stale visual generation (gen ${genId} vs current ${visualGenIdRef.current}), ignoring`);
              return;
            }
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

      return {
        id: responseId,
        name: "create_learning_visual",
        response: { result: "Success", action: "Learning visual is being generated. Continue teaching while it appears." }
      };
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

        return {
          id: responseId,
          name: "search_memory",
          response: {
            result: "Success",
            action: "Retrieved relevant memories.",
            memories_found: retrievedMemories
          }
        };
      } catch (err) {
        console.error("Memory Search Failed:", err);
        return {
          id: responseId,
          name: "search_memory",
          response: { error: "Failed to access Pinecone memory vault." }
        };
      }
    }

    // --- Record learner progress (Spark tutor mode) ---
    else if (functionCall.name === "record_progress") {
      const { subject, correct, topic } = functionCall.args;
      console.log(`[TUTOR TOOL] Progress: ${subject} ${correct ? 'correct' : 'incorrect'} (${topic})`);

      if (onToolCallback) {
        onToolCallback('record_progress', { subject, correct, topic });
      }

      return {
        id: responseId,
        name: "record_progress",
        response: { result: "Success", action: "Progress recorded." }
      };
    }

    // --- Save learner name (Spark tutor mode) ---
    else if (functionCall.name === "save_learner_name") {
      const { name } = functionCall.args;
      console.log(`[TUTOR TOOL] Saving learner name: ${name}`);

      if (onToolCallback) {
        onToolCallback('save_learner_name', { name });
      }

      return {
        id: responseId,
        name: "save_learner_name",
        response: { result: "Success", action: `Student name "${name}" saved. Use their name throughout the conversation.` }
      };
    }

    // --- Save new agent lore (Architect interview) ---
    else if (functionCall.name === "save_new_agent_lore") {
      console.log("[ARCHITECT] Saving character lore:", functionCall.args);
      appendTranscript('SYSTEM', 'Character lore captured and saved.');

      // Delegate the actual Firestore write to the page via callback
      if (onToolCallback) {
        onToolCallback('save_new_agent_lore', functionCall.args);
      }

      return {
        id: responseId,
        name: "save_new_agent_lore",
        response: {
          result: "Success",
          action: "Character lore has been saved. Tell the user their character's essence has been captured and ask them to upload an image of their character."
        }
      };
    }

    // --- Unknown tool ---
    console.warn(`[TOOL] Unknown tool call: "${functionCall.name}" — returning generic success`);
    return {
      id: responseId,
      name: functionCall.name,
      response: { result: "Success", action: "Tool executed." }
    };
  }, [userId, agentId, saveToMemory, setVaultItems, setIsGeneratingVaultItem, appendTranscript, onToolCallback]);

  return { handleToolCall };
}
