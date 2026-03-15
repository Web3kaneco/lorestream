// hooks/useGeminiLive.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getAuthHeaders } from '@/lib/getAuthToken';

import { useAgentMemory } from './useAgentMemory';
import { useVisionPipeline } from './useVisionPipeline';
import { useFrequencyAnalysis } from './useFrequencyAnalysis';
import { useAudioPlayback } from './useAudioPlayback';
import type { UserTier } from '@/lib/userTier';
import { getTierLimits, isWithinLimit } from '@/lib/userTier';
import { useToolHandlers } from './useToolHandlers';
import { buildWorkspaceSystemInstruction } from '@/lib/systemInstructions';
import type { StagedFile } from '@/types/lxxi';

export interface VisemeData {
  volume: number;
  jawOpen: number;
  mouthWidth: number;
}

export interface GeminiLiveConfig {
  systemInstruction?: string;
  tools?: any[];
  voiceName?: string;
  enableVision?: boolean;
  enableMemory?: boolean;
  onToolCallback?: (toolName: string, args: any) => void;
}

export function useGeminiLive(agentId: string, userId: string, userTier: UserTier = 'demo', config?: GeminiLiveConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]); // VaultItem[] at runtime
  const [isGeneratingVaultItem, setIsGeneratingVaultItem] = useState(false);
  const [transcripts, setTranscripts] = useState<{speaker: string, text: string}[]>([]);
  const [demoLimitReached, setDemoLimitReached] = useState(false);

  // Tier-based limits — resolved once from the tier config
  const limits = getTierLimits(userTier);

  // Exchange counter — tracks user speech turns for limited tiers
  const exchangeCountRef = useRef(0);

  // Image generation counter — tracks create_vault_artifact calls for limited tiers
  const imageGenCountRef = useRef(0);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketReadyRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);
  const processedToolIdsRef = useRef<Set<string>>(new Set());

  // Reconnection state
  const userStoppedRef = useRef<boolean>(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;

  // Memory transcript buffering
  const agentTranscriptBufferRef = useRef<string>("");
  const userTranscriptBufferRef = useRef<string>("");
  const memoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userMemoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Resolve config flags with defaults
  const enableVision = config?.enableVision !== false;
  const enableMemory = config?.enableMemory !== false;
  const voiceName = config?.voiceName || "Aoede";

  // Modular hooks
  const { saveToMemory, ingestFile } = useAgentMemory(agentId, userId);
  const { startVision, stopVision } = useVisionPipeline(videoRef, wsRef, socketReadyRef);
  const { volumeRef, startAnalysis, stopAnalysis } = useFrequencyAnalysis();
  const { playAudioBuffer, stopAllPlayback, interruptPlayback } = useAudioPlayback();
  // Safe WebSocket send — wraps all sends with readyState check + try-catch
  const safeSend = useCallback((payload: any): boolean => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
        return true;
      }
      console.warn("[WS] Cannot send — socket not open, readyState:", wsRef.current?.readyState);
      return false;
    } catch (err) {
      console.error("[WS SEND ERROR]", err);
      return false;
    }
  }, []);

  const { handleToolCall } = useToolHandlers({
    userId, agentId, saveToMemory,
    setVaultItems, setIsGeneratingVaultItem, setTranscripts,
    onToolCallback: config?.onToolCallback
  });

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return;
    isConnectingRef.current = true;
    userStoppedRef.current = false;

    try {
      socketReadyRef.current = false;
      processedToolIdsRef.current.clear();

      // Build system instruction — either from config override or from Firestore
      let systemInstructionText: string;
      if (config?.systemInstruction) {
        systemInstructionText = config.systemInstruction;
      } else {
        // Load from Firestore, with demo persona fallback
        let coreMemory: { current_lore_summary: string; key_facts: string[] } = {
          current_lore_summary: "You are discovering who you are.",
          key_facts: []
        };
        let archetype = "";

        try {
          const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
          if (memorySnap.exists()) {
            const data = memorySnap.data();
            coreMemory = {
              current_lore_summary: data.current_lore_summary || coreMemory.current_lore_summary,
              key_facts: data.key_facts || []
            };
          } else {
            // No Firestore doc — try demo persona fallback
            const { getDemoPersona } = await import('@/lib/agents/demoWow');
            const demoPersona = getDemoPersona(agentId);
            if (demoPersona) {
              coreMemory = {
                current_lore_summary: demoPersona.personality_summary,
                key_facts: demoPersona.key_facts
              };
              archetype = demoPersona.archetype;
              console.log(`[SESSION] Using demo persona for ${agentId}: ${demoPersona.archetype}`);
            }
          }
        } catch (e) {
          console.warn("[SESSION] Could not load core memory from Firestore:", e);
          // Fallback to demo persona on Firestore errors too
          try {
            const { getDemoPersona } = await import('@/lib/agents/demoWow');
            const demoPersona = getDemoPersona(agentId);
            if (demoPersona) {
              coreMemory = {
                current_lore_summary: demoPersona.personality_summary,
                key_facts: demoPersona.key_facts
              };
              archetype = demoPersona.archetype;
            }
          } catch (_) {}
        }

        // Load agent archetype from Firestore (only if not already set by demo fallback)
        if (!archetype) {
          try {
            const agentSnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}`));
            if (agentSnap.exists()) archetype = agentSnap.data().archetype || "";
          } catch (e) {
            console.warn("[SESSION] Could not load agent archetype:", e);
          }
        }

        // Load recent Pinecone conversation history (authenticated + admin only)
        let recentMemories = "";
        if (enableMemory && limits.pineconeMemory) {
          try {
            const authHdrs = await getAuthHeaders();
            const memRes = await fetch('/api/memory/search', {
              method: 'POST',
              headers: authHdrs,
              body: JSON.stringify({ query: "recent conversation summary", agentId })
            });
            const memData = await memRes.json();
            if (memData.memories && memData.memories.length > 0) {
              recentMemories = memData.memories.slice(0, 10).join('\n');
            }
          } catch (e) {
            console.warn("[SESSION] Could not load Pinecone memories:", e);
          }
        }

        systemInstructionText = buildWorkspaceSystemInstruction(
          coreMemory,
          recentMemories,
          archetype
        );

        // Append tier-based instructions
        if (userTier === 'demo') {
          systemInstructionText += `\n\n--- DEMO MODE ---
You are currently in DEMO MODE. You have ${limits.exchangeLimit} voice exchanges with this user.
Make every exchange count — be captivating, warm, and show your personality.

You CAN generate ONE image using create_vault_artifact — use it wisely when the moment is right.
You cannot search memories, create documents, or use any other tools.
If the user asks for more, respond naturally: "I'd love to do more — log in and we can go deeper together."
Tease what's possible with full access. Keep it playful and make them want more.`;
        } else if (userTier === 'authenticated') {
          systemInstructionText += `\n\n--- SESSION INFO ---
You have ${limits.exchangeLimit} voice exchanges and ${limits.imageGenLimit} image generations this session.
You have access to image generation, document creation, and memory search.
Use your tools naturally and make every exchange count.`;
        }
        // Admin: no extra instructions (unlimited)
      }

      // Build tools:
      // 1. If config provides explicit tools (e.g. Spark tutor), ALWAYS use them regardless of tier
      // 2. For default workspace mode: tier determines which tools are available
      const fullTools = [{
        functionDeclarations: [
          {
            name: "create_vault_artifact",
            description: "The ONLY way to create images. You MUST call this tool whenever the user requests ANY visual content — drawings, paintings, scenes, portraits, landscapes, or any image. Call this tool INSTEAD of describing what you would create. Never narrate — just call. If the user wants to incorporate elements from previously generated images or user-uploaded images, include referenceImageUrls.",
            parameters: {
              type: "OBJECT",
              properties: {
                prompt: { type: "STRING", description: "A highly detailed visual description of the image to generate. Be specific about composition, colors, style, lighting, and mood." },
                rationale: { type: "STRING", description: "A short sentence explaining your visual choices." },
                referenceImageUrls: { type: "ARRAY", items: { type: "STRING" }, description: "Optional array of URLs of previously generated vault images or user-uploaded images to use as style or content references for the new image. User-uploaded image URLs are announced via [SYSTEM:] messages. Use when the user wants to incorporate elements from previous creations or uploads. Maximum 3." }
              },
              required: ["prompt", "rationale"]
            }
          },
          {
            name: "search_memory",
            description: "Search your memory database. You MUST call this when the user asks about past conversations, shared memories, or things discussed before. Do not guess — search first.",
            parameters: {
              type: "OBJECT",
              properties: {
                query: { type: "STRING", description: "The specific topic or question to search the database for." }
              },
              required: ["query"]
            }
          },
          {
            name: "createDocumentArtifact",
            description: "Create a document artifact — code, text, essays, recipes, study notes, etc. — that is saved to the vault. Use this for ANY non-image content the user requests. Call this INSTEAD of reading code aloud or describing text. The document will be rendered with syntax highlighting and copy/download buttons.",
            parameters: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING", description: "A concise title for the document." },
                content: { type: "STRING", description: "The full content of the document. For code, include the complete functional code. For text, include the full text." },
                language: { type: "STRING", description: "The content language or format: 'javascript', 'python', 'typescript', 'html', 'css', 'markdown', 'text', etc." },
                description: { type: "STRING", description: "A brief description of what this document contains and why it was created." }
              },
              required: ["title", "content", "language"]
            }
          }
        ]
      }];

      const demoTools = [{
        functionDeclarations: [
          {
            name: "create_vault_artifact",
            description: "Create ONE image for the user. You have a limited number of uses in demo mode — make it count. Call this INSTEAD of describing what you would create.",
            parameters: {
              type: "OBJECT",
              properties: {
                prompt: { type: "STRING", description: "A highly detailed visual description of the image to generate." },
                rationale: { type: "STRING", description: "A short sentence explaining your visual choices." },
              },
              required: ["prompt", "rationale"]
            }
          }
        ]
      }];

      const toolDeclarations = config?.tools
        ? config.tools // Config-provided tools always active (Spark chalkboard, etc.)
        : (userTier === 'demo' ? demoTools : fullTools);

      // Audio context setup — 24kHz matches Gemini's native audio output rate
      // Mic capture downsamples 24kHz → 16kHz in the audio worklet before sending
      // Close existing AudioContext to prevent resource leak on reconnect (browsers limit ~6 contexts)
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch(e) {}
      }
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      analyzerRef.current = audioCtx.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.4;
      analyzerRef.current.minDecibels = -90;
      analyzerRef.current.maxDecibels = -10;

      // Mic setup (always required) — request audio first, then video separately
      // This prevents a slow/unavailable camera from blocking the entire session
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });

      // Vision setup (optional, non-blocking) — if camera fails, session continues audio-only
      if (enableVision) {
        try {
          const videoStream = await Promise.race([
            navigator.mediaDevices.getUserMedia({ video: true }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Camera timeout')), 5000))
          ]);
          if (!videoRef.current) videoRef.current = document.createElement('video');
          videoRef.current.srcObject = videoStream;
          videoRef.current.muted = true;
          videoRef.current.play().catch(e => console.warn("[VIDEO] Autoplay blocked:", e));
          console.log('%c[VISION] Camera ready', 'color: #00ff00');
        } catch (e) {
          console.warn("[VISION] Camera unavailable — continuing audio-only:", e);
        }
      }

      // WebSocket connection — fetch key from server (never in JS bundle)
      let apiKey: string | undefined;
      try {
        const sessionRes = await fetch('/api/gemini-session');
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          apiKey = sessionData.key;
        }
      } catch (e) {
        console.error('[SESSION] Failed to fetch Gemini key:', e);
      }
      if (!apiKey) {
        console.error('[SESSION] No Gemini API key available');
        isConnectingRef.current = false;
        return;
      }
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Guard: if this WS was superseded before it opened, close it immediately
        if (wsRef.current !== ws) {
          console.log('[WS] Stale onopen — closing superseded connection');
          try { ws.close(); } catch(e) {}
          return;
        }
        console.log(`%c[WS] Connected! Sending setup with voice="${voiceName}"`, 'color: #00ff00; font-weight: bold');
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-preview-09-2025",
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } }
            },
            systemInstruction: {
              parts: [{ text: systemInstructionText }]
            },
            tools: toolDeclarations
          }
        };
        ws.send(JSON.stringify(setupMessage));
        setIsConnected(true);

        // Warn if handshake doesn't complete within 5 seconds
        setTimeout(() => {
          if (!socketReadyRef.current && wsRef.current === ws) {
            console.warn('%c[WS] WARNING: setupComplete not received after 5s — API may be unresponsive. Check API key and model availability.', 'color: #ff6600; font-weight: bold');
          }
        }, 5000);
      };

      ws.onclose = (event) => {
        // Guard: if a newer WebSocket is already active, don't touch shared state.
        // This prevents the old connection's onclose from killing a new session.
        if (wsRef.current && wsRef.current !== ws) {
          console.log(`[WS] Stale onclose ignored (new session already active) code=${event.code}`);
          return;
        }

        console.warn(`[WS CLOSED] code=${event.code} reason=${event.reason || 'none'}`);
        wsRef.current = null;
        socketReadyRef.current = false;
        setIsConnected(false);
        isConnectingRef.current = false;

        // Flush memory buffers before reconnect to prevent data loss
        if (enableMemory) {
          const agentBuf = agentTranscriptBufferRef.current.trim();
          if (agentBuf) { saveToMemory(agentBuf, 'agent'); agentTranscriptBufferRef.current = ""; }
          const userBuf = userTranscriptBufferRef.current.trim();
          if (userBuf) { saveToMemory(userBuf, 'user'); userTranscriptBufferRef.current = ""; }
        }

        // Auto-reconnect with exponential backoff (unless user explicitly stopped)
        if (!userStoppedRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 16000);
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            startSession();
          }, delay);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          console.error("[WS] Max reconnect attempts reached — session ended");
        }
      };

      ws.onerror = (error) => {
        console.error("[WS ERROR]", error);
        // Force close to trigger onclose → reconnection logic
        try { ws.close(); } catch(e) {}
      };

      // Message handler — delegates to modular hooks
      ws.onmessage = async (event) => {
        // Guard: ignore messages from superseded connections
        if (wsRef.current !== ws) return;
        try {
          let msgText = event.data;
          if (event.data instanceof Blob) msgText = await event.data.text();
          const data = JSON.parse(msgText);

          // Debug: log tool-related messages
          if (data.toolCall) {
            console.log("[WS MSG] toolCall:", JSON.stringify(data.toolCall));
          }
          if (data.toolCallCancellation) {
            console.log("[WS MSG] toolCallCancellation:", JSON.stringify(data.toolCallCancellation));
          }
          if (data.serverContent?.modelTurn?.parts) {
            const toolParts = data.serverContent.modelTurn.parts.filter((p: any) => p.functionCall);
            if (toolParts.length > 0) {
              console.log("[WS DEBUG] Function calls in modelTurn:", JSON.stringify(toolParts));
            }
          }

          if (data.setupComplete) {
            console.log("[NATIVE WS] Handshake Complete! Safe to stream audio and video.");
            socketReadyRef.current = true;
            reconnectAttemptsRef.current = 0; // Reset on successful connection
            if (enableVision) startVision();

            // Load persisted vault items from Firestore (non-blocking)
            if (userId && agentId && agentId !== 'tutor_demo' && agentId !== 'architect_demo') {
              import('@/lib/vaultUtils').then(({ loadVaultItems }) => {
                loadVaultItems(userId, agentId).then((saved) => {
                  if (saved.length > 0) {
                    setVaultItems(prev => {
                      // Deduplicate by checking existing IDs
                      const existingIds = new Set(prev.filter((i: any) => i.id).map((i: any) => i.id));
                      const newItems = saved.filter((i) => !i.id || !existingIds.has(i.id));
                      return [...newItems, ...prev];
                    });
                    console.log(`[VAULT] Loaded ${saved.length} persisted items from Firestore`);
                  }
                }).catch((e) => console.warn("[VAULT] Could not load saved items:", e));
              });
            }
            return;
          }

          // Handle tool calls — Live API sends these as a SEPARATE message type
          // CRITICAL: All function responses from a single batch MUST be sent in
          // ONE toolResponse message. Sending them individually puts Gemini into a
          // broken state where it stops processing user audio input.
          if (data.toolCall?.functionCalls) {
            const batchResponses: any[] = [];
            for (const fc of data.toolCall.functionCalls) {
              const callId = fc.id || `${fc.name}_${Date.now()}`;
              if (processedToolIdsRef.current.has(callId)) continue;
              processedToolIdsRef.current.add(callId);
              console.log("[TOOL CALL RECEIVED via toolCall]", fc.name, "id:", fc.id);

              // Image generation limit enforcement
              if (fc.name === 'create_vault_artifact' && limits.imageGenLimit > 0) {
                if (!isWithinLimit(imageGenCountRef.current, limits.imageGenLimit)) {
                  batchResponses.push({
                    id: callId,
                    name: 'create_vault_artifact',
                    response: { error: "Image generation limit reached for this session. Tell the user they've used all their image generations for this session." }
                  });
                  continue;
                }
                imageGenCountRef.current++;
              }

              try {
                const response = await handleToolCall(fc);
                if (response) batchResponses.push(response);
              } catch (err) {
                console.error("[TOOL HANDLER ERROR]", err);
              }
            }
            if (batchResponses.length > 0) {
              safeSend({ toolResponse: { functionResponses: batchResponses } });
              console.log(`%c[TOOLS] Batched response sent for ${batchResponses.length} function(s): ${batchResponses.map(r => r.name).join(', ')}`, 'color: #00ff00');
            }
          }

          // Handle tool call cancellation
          if (data.toolCallCancellation) {
            setIsGeneratingVaultItem(false);
          }

          if (data.serverContent?.interrupted) {
            interruptPlayback();
          }

          if (data.serverContent?.modelTurn) {
            const inlineToolCalls: any[] = [];

            for (const part of data.serverContent.modelTurn.parts) {
              // 1. Text transcripts + memory buffering
              if (part.text) {
                  setTranscripts(prev => {
                    const updated = [...prev, { speaker: 'AGENT', text: part.text }];
                    return updated.length > 500 ? updated.slice(-500) : updated;
                  });

                  if (enableMemory && limits.pineconeMemory) {
                    agentTranscriptBufferRef.current += part.text;
                    if (memoryTimeoutRef.current) clearTimeout(memoryTimeoutRef.current);
                    memoryTimeoutRef.current = setTimeout(() => {
                        const completeThought = agentTranscriptBufferRef.current.trim();
                        if (completeThought) {
                            saveToMemory(completeThought, 'agent');
                            agentTranscriptBufferRef.current = "";
                        }
                    }, 1500);
                  }
              }

              // 2. Audio playback (delegated)
              if (part.inlineData?.data && audioContextRef.current) {
                playAudioBuffer(part.inlineData.data, audioContextRef.current, analyzerRef.current);
              }

              // 3. Collect inline tool calls for batched response
              if (part.functionCall) {
                const callId = part.functionCall.id || `${part.functionCall.name}_${Date.now()}`;
                if (!processedToolIdsRef.current.has(callId)) {
                  processedToolIdsRef.current.add(callId);
                  console.log("[TOOL CALL RECEIVED via modelTurn]", part.functionCall.name, "id:", part.functionCall.id);
                  inlineToolCalls.push(part.functionCall);
                }
              }
            }

            // Batch inline tool call responses (same reason as toolCall batching above)
            if (inlineToolCalls.length > 0) {
              try {
                const responses = await Promise.all(
                  inlineToolCalls.map(fc => {
                    // Image generation limit enforcement for inline tool calls
                    if (fc.name === 'create_vault_artifact' && limits.imageGenLimit > 0) {
                      if (!isWithinLimit(imageGenCountRef.current, limits.imageGenLimit)) {
                        return Promise.resolve({
                          id: fc.id || `${fc.name}_${Date.now()}`,
                          name: 'create_vault_artifact',
                          response: { error: "Image generation limit reached for this session. Tell the user they've used all their image generations for this session." }
                        });
                      }
                      imageGenCountRef.current++;
                    }
                    return handleToolCall(fc).catch(err => {
                      console.error("[TOOL HANDLER ERROR]", err);
                      return null;
                    });
                  })
                );
                const validResponses = responses.filter(Boolean);
                if (validResponses.length > 0) {
                  safeSend({ toolResponse: { functionResponses: validResponses } });
                  console.log(`%c[TOOLS] Batched inline response for ${validResponses.length} function(s)`, 'color: #00ff00');
                }
              } catch (err) {
                console.error("[TOOL BATCH ERROR]", err);
              }
            }
          }

          // 4. Turn complete signal — model finished speaking, now listening
          if (data.serverContent?.turnComplete) {
            console.log('%c[MODEL] Turn complete — now listening for user speech', 'color: #00aaff; font-weight: bold');
          }

          // 5. User speech transcripts + memory buffering
          if (data.serverContent?.inputTranscript) {
            const userText = data.serverContent.inputTranscript;
            console.log(`%c[USER SPEECH DETECTED] "${userText}"`, 'color: #ffaa00; font-weight: bold');
            setTranscripts(prev => {
              const updated = [...prev, { speaker: 'USER', text: userText }];
              return updated.length > 500 ? updated.slice(-500) : updated;
            });

            // Exchange counter — flag limit reached for non-unlimited tiers
            // The actual session stop is handled by the workspace page via demoLimitReached
            if (limits.exchangeLimit > 0) {
              exchangeCountRef.current++;
              console.log(`[SESSION] Exchange ${exchangeCountRef.current}/${limits.exchangeLimit}`);
              if (exchangeCountRef.current >= limits.exchangeLimit) {
                console.log('[SESSION] Exchange limit reached — flagging for session end');
                setDemoLimitReached(true);
              }
            }

            if (enableMemory && limits.pineconeMemory) {
              userTranscriptBufferRef.current += " " + userText;
              if (userMemoryTimeoutRef.current) clearTimeout(userMemoryTimeoutRef.current);
              userMemoryTimeoutRef.current = setTimeout(() => {
                const completeUserThought = userTranscriptBufferRef.current.trim();
                if (completeUserThought) {
                  saveToMemory(completeUserThought, 'user');
                  userTranscriptBufferRef.current = "";
                }
              }, 2000);
            }
          }
        } catch (err) {
          console.error("[WS MESSAGE ERROR]", err);
        }
      };

      // Audio worklet for mic capture
      const source = audioCtx.createMediaStreamSource(micStreamRef.current);

      try {
        // Ensure AudioContext is running — browsers block without user gesture.
        // Retry resume() up to 3 times with short delays (handles auto-start race).
        for (let attempt = 0; attempt < 3 && audioCtx.state !== 'running'; attempt++) {
          try { await audioCtx.resume(); } catch (_) {}
          if (audioCtx.state !== 'running') await new Promise(r => setTimeout(r, 200));
        }
        if (audioCtx.state !== 'running') {
          console.warn(`[AUDIO WORKLET] AudioContext state is '${audioCtx.state}' — mic capture may fail`);
        }

        await audioCtx.audioWorklet.addModule('/audio-processor.js');
        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
            channelCount: 1,
            channelCountMode: 'explicit'
        });
        workletNodeRef.current = workletNode;

        let micSendCount = 0;
        let micBlockedCount = 0;
        workletNode.port.onmessage = (event) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) {
            micBlockedCount++;
            if (micBlockedCount === 1 || micBlockedCount % 200 === 0) {
              console.warn(`[MIC] Blocked — ws=${wsRef.current?.readyState} ready=${socketReadyRef.current} (blocked ${micBlockedCount}x)`);
            }
            return;
          }
          const { pcmData } = event.data;
          micSendCount++;
          if (micSendCount === 1) console.log('%c[MIC] First audio chunk sent to Gemini', 'color: #00ff00');
          else if (micSendCount % 200 === 0) console.log(`[MIC] Chunk #${micSendCount} sent (stream healthy)`);

          const bytes = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i += 1024) {
              const end = Math.min(i + 1024, bytes.byteLength);
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
          }

          const payload = {
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: btoa(binary) }] }
          };
          try {
            wsRef.current.send(JSON.stringify(payload));
          } catch (err) {
            console.error("[AUDIO SEND ERROR]", err);
          }
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
      } catch (err) {
        console.error("[AUDIO WORKLET ERROR]", err);
      }

      // Start frequency analysis for lip-sync (delegated)
      if (analyzerRef.current && audioContextRef.current) {
        startAnalysis(analyzerRef.current, audioContextRef.current.sampleRate);
      }

    } catch (error) {
      console.error("[SESSION START ERROR]", error);
      isConnectingRef.current = false;
      setIsConnected(false);
      // Clean up any partial resources
      micStreamRef.current?.getTracks().forEach(track => track.stop());
      if (wsRef.current) { try { wsRef.current.close(); } catch(e) {} wsRef.current = null; }
    }
  }, [agentId, userId, isConnected, userTier, config, enableVision, enableMemory, voiceName, saveToMemory, startVision, startAnalysis, playAudioBuffer, interruptPlayback, handleToolCall, safeSend]);

  const stopSession = useCallback(() => {
    userStoppedRef.current = true; // Prevent auto-reconnection
    socketReadyRef.current = false;
    isConnectingRef.current = false;
    reconnectAttemptsRef.current = 0;

    // Cancel any pending reconnection
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (enableVision) stopVision();
    stopAnalysis();
    stopAllPlayback();

    // Clear memory debounce timers
    if (memoryTimeoutRef.current) clearTimeout(memoryTimeoutRef.current);
    if (userMemoryTimeoutRef.current) clearTimeout(userMemoryTimeoutRef.current);

    // Flush any buffered transcripts to memory before closing
    if (enableMemory) {
      const agentBuffer = agentTranscriptBufferRef.current.trim();
      if (agentBuffer) {
        saveToMemory(agentBuffer, 'agent');
        agentTranscriptBufferRef.current = "";
      }
      const userBuffer = userTranscriptBufferRef.current.trim();
      if (userBuffer) {
        saveToMemory(userBuffer, 'user');
        userTranscriptBufferRef.current = "";
      }
    }

    if (wsRef.current) { try { wsRef.current.close(); } catch(e) {} wsRef.current = null; }
    if (workletNodeRef.current) { workletNodeRef.current.disconnect(); workletNodeRef.current = null; }
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    // Stop camera stream tracks — prevents camera LED staying on after disconnect
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    audioContextRef.current?.close();
    setIsConnected(false);
  }, [enableVision, enableMemory, stopVision, stopAnalysis, stopAllPlayback, saveToMemory]);

  // Send multimodal context (text + files) to the active Gemini Live session
  // Uses clientContent format for structured user turns (not realtimeInput which is for streaming)
  const sendContext = useCallback((text: string, attachments: StagedFile[]): boolean => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) {
      console.warn("[SEND CONTEXT] Cannot send — session not active");
      return false;
    }

    const parts: any[] = [];
    if (text.trim()) {
      parts.push({ text: text.trim() });
    }
    for (const att of attachments) {
      parts.push({
        inlineData: { mimeType: att.mimeType, data: att.base64 }
      });
    }
    if (parts.length === 0) return false;

    const payload = {
      clientContent: {
        turns: [{ role: "user", parts }],
        turnComplete: true
      }
    };

    const sent = safeSend(payload);
    if (sent) {
      // Mirror to transcript UI
      const summary = text.trim()
        ? text.trim() + (attachments.length > 0 ? ` [+${attachments.length} file(s)]` : '')
        : `[Shared ${attachments.length} file(s)]`;
      setTranscripts(prev => {
        const updated = [...prev, { speaker: 'USER', text: summary }];
        return updated.length > 500 ? updated.slice(-500) : updated;
      });
      // Save to Pinecone memory (admin only) — includes first image for multimodal embedding
      if (enableMemory && limits.pineconeMemory && text.trim()) {
        const firstImage = attachments.find(a => a.mimeType.startsWith('image/'));
        saveToMemory(
          text.trim(),
          'user',
          firstImage ? { base64: firstImage.base64, mimeType: firstImage.mimeType } : undefined
        );
      }
      console.log(`[CONTEXT] Sent: ${text.trim().substring(0, 50)}... + ${attachments.length} file(s)`);
    }
    return sent;
  }, [safeSend, enableMemory, saveToMemory, setTranscripts]);

  // Clean up camera/mic/WebSocket on page close or component unmount.
  // Without this, the camera LED stays on after closing the page.
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Stop all media tracks immediately
      micStreamRef.current?.getTracks().forEach(track => track.stop());
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
      if (wsRef.current) { try { wsRef.current.close(); } catch(e) {} }
      audioContextRef.current?.close();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Component unmount: full cleanup
      handleBeforeUnload();
    };
  }, []);

  // Expose a way for external callers (e.g. workspace) to add items to the vault
  const addVaultItem = useCallback((item: any) => {
    setVaultItems(prev => {
      const updated = [...prev, item];
      return updated.length > 100 ? updated.slice(-100) : updated;
    });
  }, []);

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, transcripts, sendContext, ingestFile, addVaultItem, demoLimitReached };
}
