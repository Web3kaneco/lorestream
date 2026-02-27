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
  const [vaultItems, setVaultItems] = useState<any[]>([]);
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
  const { handleToolCall } = useToolHandlers({
    wsRef, userId, agentId, saveToMemory,
    setVaultItems, setIsGeneratingVaultItem, setTranscripts,
    onToolCallback: config?.onToolCallback
  });

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return;
    isConnectingRef.current = true;

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
            description: "The ONLY way to create images. You MUST call this tool whenever the user requests ANY visual content — drawings, paintings, scenes, portraits, landscapes, or any image. Call this tool INSTEAD of describing what you would create. Never narrate — just call.",
            parameters: {
              type: "OBJECT",
              properties: {
                prompt: { type: "STRING", description: "A highly detailed visual description of the image to generate. Be specific about composition, colors, style, lighting, and mood." },
                rationale: { type: "STRING", description: "A short sentence explaining your visual choices." }
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
          }
        ]
      }];

      // Audio context setup
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
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
      };

      ws.onclose = () => {
        wsRef.current = null;
        socketReadyRef.current = false;
        setIsConnected(false);
        isConnectingRef.current = false;
      };

      ws.onerror = (error) => {
        console.error("[WS ERROR]", error);
      };

      // Message handler — delegates to modular hooks
      ws.onmessage = async (event) => {
        try {
          let msgText = event.data;
          if (event.data instanceof Blob) msgText = await event.data.text();
          const data = JSON.parse(msgText);

          // Debug: log tool-related messages
          if (data.serverContent?.modelTurn?.parts) {
            const toolParts = data.serverContent.modelTurn.parts.filter((p: any) => p.functionCall);
            if (toolParts.length > 0) {
              console.log("[WS DEBUG] Function calls received:", JSON.stringify(toolParts));
            }
          }

          if (data.setupComplete) {
            console.log("[NATIVE WS] Handshake Complete! Safe to stream audio and video.");
            socketReadyRef.current = true;
            if (enableVision) startVision();
            return;
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

        workletNode.port.onmessage = (event) => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) return;
          const { pcmData } = event.data;

          const bytes = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i += 1024) {
              const end = Math.min(i + 1024, bytes.byteLength);
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
          }

          const payload = {
            realtimeInput: { mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: btoa(binary) }] }
          };
          wsRef.current.send(JSON.stringify(payload));
        };

        source.connect(workletNode);
        workletNode.connect(audioCtx.destination);
      } catch (err) {
        console.error("[AUDIO WORKLET ERROR]", err);
      }

      // Start frequency analysis for lip-sync (delegated)
      if (analyzerRef.current) {
        startAnalysis(analyzerRef.current);
      }

    } catch (error) {
      console.error("[SESSION START ERROR]", error);
      isConnectingRef.current = false;
    }
  }, [agentId, userId, isConnected, config, enableVision, enableMemory, voiceName, saveToMemory, startVision, startAnalysis, playAudioBuffer, interruptPlayback, handleToolCall]);

  const stopSession = useCallback(() => {
    socketReadyRef.current = false;
    isConnectingRef.current = false;

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
