// hooks/useGeminiLive.ts
import { useState, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

import { useAgentMemory } from './useAgentMemory';
import { useVisionPipeline } from './useVisionPipeline';
import { useFrequencyAnalysis } from './useFrequencyAnalysis';
import { useAudioPlayback } from './useAudioPlayback';
import { useToolHandlers } from './useToolHandlers';
import { buildWorkspaceSystemInstruction } from '@/lib/systemInstructions';

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

export function useGeminiLive(agentId: string, userId: string, config?: GeminiLiveConfig) {
  const [isConnected, setIsConnected] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]); // VaultItem[] at runtime
  const [isGeneratingVaultItem, setIsGeneratingVaultItem] = useState(false);
  const [transcripts, setTranscripts] = useState<{speaker: string, text: string}[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketReadyRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);

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
  const voiceName = config?.voiceName || "Fenrir";

  // Modular hooks
  const { saveToMemory } = useAgentMemory(agentId, userId);
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
    safeSend, userId, agentId, saveToMemory,
    setVaultItems, setIsGeneratingVaultItem, setTranscripts,
    onToolCallback: config?.onToolCallback
  });

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return;
    isConnectingRef.current = true;
    userStoppedRef.current = false;

    try {
      socketReadyRef.current = false;

      // Build system instruction — either from config override or from Firestore
      let systemInstructionText: string;
      if (config?.systemInstruction) {
        systemInstructionText = config.systemInstruction;
      } else {
        // Load from Firestore (existing workspace behavior)
        const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
        const coreMemory = memorySnap.exists() ? memorySnap.data() : { current_lore_summary: "No prior memories.", key_facts: [] };
        const memoryString = coreMemory.key_facts?.join('. ') || "";

        // Load agent archetype for personality
        let archetype = "";
        try {
          const agentSnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}`));
          if (agentSnap.exists()) archetype = agentSnap.data().archetype || "";
        } catch (e) {
          console.warn("[SESSION] Could not load agent archetype:", e);
        }

        // Load recent Pinecone conversation history
        let recentMemories = "";
        if (enableMemory) {
          try {
            const memRes = await fetch('/api/memory/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: "recent conversation summary", userId, agentId })
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
          { current_lore_summary: coreMemory.current_lore_summary || "", key_facts: coreMemory.key_facts || [] },
          recentMemories,
          archetype
        );
      }

      // Build tools — either from config override or defaults
      const toolDeclarations = config?.tools || [{
        functionDeclarations: [
          {
            name: "create_vault_artifact",
            description: "The ONLY way to create images. You MUST call this tool whenever the user requests ANY visual content — drawings, paintings, scenes, portraits, landscapes, or any image. Call this tool INSTEAD of describing what you would create. Never narrate — just call. If the user wants to incorporate elements from previously generated images, include referenceImageUrls.",
            parameters: {
              type: "OBJECT",
              properties: {
                prompt: { type: "STRING", description: "A highly detailed visual description of the image to generate. Be specific about composition, colors, style, lighting, and mood." },
                rationale: { type: "STRING", description: "A short sentence explaining your visual choices." },
                referenceImageUrls: { type: "ARRAY", items: { type: "STRING" }, description: "Optional array of URLs of previously generated vault images to use as style or content references for the new image. Use when the user wants to incorporate elements from previous creations. Maximum 3." }
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

      // Audio context setup — 24kHz matches Gemini's native audio output rate
      // Mic capture downsamples 24kHz → 16kHz in the audio worklet before sending
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      analyzerRef.current = audioCtx.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.4;
      analyzerRef.current.minDecibels = -90;
      analyzerRef.current.maxDecibels = -10;

      // Mic + optional video setup
      const mediaConstraints: MediaStreamConstraints = {
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      };
      if (enableVision) {
        mediaConstraints.video = true;
      }

      micStreamRef.current = await navigator.mediaDevices.getUserMedia(mediaConstraints);

      if (enableVision) {
        if (!videoRef.current) videoRef.current = document.createElement('video');
        videoRef.current.srcObject = micStreamRef.current;
        videoRef.current.muted = true;
        videoRef.current.play();
      }

      // WebSocket connection
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`%c[WS] Connected! Sending setup with voice="${voiceName}"`, 'color: #00ff00; font-weight: bold');
        const setupMessage = {
          setup: {
            model: "models/gemini-2.5-flash-native-audio-preview-12-2025",
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
        console.warn(`[WS CLOSED] code=${event.code} reason=${event.reason || 'none'}`);
        wsRef.current = null;
        socketReadyRef.current = false;
        setIsConnected(false);
        isConnectingRef.current = false;

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
          if (data.toolCall?.functionCalls) {
            for (const fc of data.toolCall.functionCalls) {
              console.log("[TOOL CALL RECEIVED via toolCall]", fc.name, "id:", fc.id);
              handleToolCall(fc);
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
            for (const part of data.serverContent.modelTurn.parts) {
              // 1. Text transcripts + memory buffering
              if (part.text) {
                  setTranscripts(prev => {
                    const updated = [...prev, { speaker: 'AGENT', text: part.text }];
                    return updated.length > 500 ? updated.slice(-500) : updated;
                  });

                  if (enableMemory) {
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

              // 3. Tool calls (delegated)
              if (part.functionCall) {
                console.log("[TOOL CALL RECEIVED]", part.functionCall.name, "id:", part.functionCall.id, "args:", JSON.stringify(part.functionCall.args));
                handleToolCall(part.functionCall);
              }
            }
          }

          // 4. User speech transcripts + memory buffering
          if (data.serverContent?.inputTranscript) {
            const userText = data.serverContent.inputTranscript;
            setTranscripts(prev => {
              const updated = [...prev, { speaker: 'USER', text: userText }];
              return updated.length > 500 ? updated.slice(-500) : updated;
            });

            if (enableMemory) {
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
        await audioCtx.audioWorklet.addModule('/audio-processor.js');
        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
            channelCount: 1,
            channelCountMode: 'explicit'
        });
        workletNodeRef.current = workletNode;

        let micSendCount = 0;
        workletNode.port.onmessage = (event) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) return;
          const { pcmData } = event.data;
          if (micSendCount === 0) console.log('%c[MIC] First audio chunk sent to Gemini', 'color: #00ff00');
          micSendCount++;

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
    }
  }, [agentId, userId, isConnected, config, enableVision, enableMemory, voiceName, saveToMemory, startVision, startAnalysis, playAudioBuffer, interruptPlayback, handleToolCall, safeSend]);

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
    audioContextRef.current?.close();
    setIsConnected(false);
  }, [enableVision, enableMemory, stopVision, stopAnalysis, stopAllPlayback, saveToMemory]);

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, transcripts };
}
