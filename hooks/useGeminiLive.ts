// hooks/useGeminiLive.ts
import { useState, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// 🧩 IMPORT OUR NEW MODULAR HOOKS
import { useAgentMemory } from './useAgentMemory';
import { useVisionPipeline } from './useVisionPipeline';

export interface VisemeData {
  volume: number;      
  jawOpen: number;     
  mouthWidth: number;  
}

const VISEME_ZERO: VisemeData = { volume: 0, jawOpen: 0, mouthWidth: 0 };

export function useGeminiLive(agentId: string, userId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [isGeneratingVaultItem, setIsGeneratingVaultItem] = useState(false);
  
  // 🚀 FIXED: Transcripts state safely inside the hook!
  const [transcripts, setTranscripts] = useState<{speaker: string, text: string}[]>([]);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const currentAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const volumeRef = useRef<VisemeData>({ ...VISEME_ZERO });
  
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketReadyRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);
  const nextPlayTimeRef = useRef<number>(0);

  // 🛠️ NEW: Buffer and Timeout refs to aggregate memory
  const agentTranscriptBufferRef = useRef<string>("");
  const memoryTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 🧩 INITIALIZE OUR MODULES
  const { saveToMemory } = useAgentMemory(agentId, userId);
  const { startVision, stopVision } = useVisionPipeline(videoRef, wsRef, socketReadyRef);

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return; 
    isConnectingRef.current = true;
    nextPlayTimeRef.current = 0; 

    try {
      socketReadyRef.current = false;
      const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
      const coreMemory = memorySnap.exists() ? memorySnap.data() : { current_lore_summary: "No prior memories.", key_facts: [] };
      const memoryString = coreMemory.key_facts?.join('. ') || "";

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      analyzerRef.current = audioCtx.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.4; 
      analyzerRef.current.minDecibels = -90;
      analyzerRef.current.maxDecibels = -10;
      
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
          video: true 
      });
      
      if (!videoRef.current) videoRef.current = document.createElement('video');
      videoRef.current.srcObject = micStreamRef.current;
      videoRef.current.muted = true; 
      videoRef.current.play();

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
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
            },
            systemInstruction: {
              parts: [{ 
                text: `You are a helpful AI Co-Creator.\nCORE MEMORY: ${coreMemory?.current_lore_summary || ""}\nFACTS: ${memoryString}\nCRITICAL INSTRUCTION: You are strictly a VOICE assistant. Wait for the user to speak, and then reply conversationally and briefly.` 
              }]
            },
            // 🚀 RESTORED: Give the agent the Image Generation Tool!
            tools: [{
              functionDeclarations: [{
                name: "create_vault_artifact",
                description: "Generates a visual artifact or image and saves it to the user's screen. Call this ONLY when the user explicitly asks you to create, generate, draw, or design something.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    prompt: { type: "STRING", description: "A highly detailed visual description of what to generate." },
                    rationale: { type: "STRING", description: "A brief sentence explaining why you are making this." }
                  },
                  required: ["prompt", "rationale"]
                }
              }]
            }]
          }
        };
        ws.send(JSON.stringify(setupMessage));
        setIsConnected(true);
      };

      ws.onclose = (e) => {
        wsRef.current = null;
        socketReadyRef.current = false;
        setIsConnected(false);
        isConnectingRef.current = false;
      };

      ws.onerror = (error) => {};

      ws.onmessage = async (event) => {
        try {
          let msgText = event.data;
          if (event.data instanceof Blob) msgText = await event.data.text();
          const data = JSON.parse(msgText);
          
          if (data.setupComplete) {
            console.log("✅ [NATIVE WS] Handshake Complete! Safe to stream audio and video.");
            socketReadyRef.current = true;
            startVision(); 
            return;
          }
          
          if (data.serverContent?.interrupted) {
            currentAudioNodesRef.current.forEach(node => { try { node.stop(); } catch(e) {} });
            currentAudioNodesRef.current = [];
            nextPlayTimeRef.current = 0;
          }
          
          if (data.serverContent?.modelTurn) {
            for (const part of data.serverContent.modelTurn.parts) {
              
              // 1. Handle Normal Speech (🛠️ UPDATED: Aggregated Memory Save)
              if (part.text) {
                  console.log("📝 [GEMINI]:", part.text);
                  setTranscripts(prev => [...prev, { speaker: 'AGENT', text: part.text }]);

                  // Gather the chunks into a single string
                  agentTranscriptBufferRef.current += part.text;

                  // Clear the previous countdown
                  if (memoryTimeoutRef.current) {
                      clearTimeout(memoryTimeoutRef.current);
                  }

                  // Start a new 1.5-second countdown.
                  memoryTimeoutRef.current = setTimeout(() => {
                      const completeThought = agentTranscriptBufferRef.current.trim();
                      if (completeThought) {
                          saveToMemory(completeThought, 'agent');
                          agentTranscriptBufferRef.current = ""; // Reset the buffer for the next sentence
                      }
                  }, 1500);
              }
              
              // 2. Handle Audio
              if (part.inlineData?.data) {
                playAudioBuffer(part.inlineData.data);
              }

              // 🚀 3. RESTORED: Handle Tool Calls (Image Generation)
              if (part.functionCall && part.functionCall.name === "create_vault_artifact") {
                 const { prompt, rationale } = part.functionCall.args;
                 console.log(`🎨 [AGENT TOOL TRIGGERED] Creating: ${prompt}`);
                 
                 setIsGeneratingVaultItem(true);
                 setTranscripts(prev => [...prev, { speaker: 'SYSTEM', text: `Executing Nano-Banana Tool: Generating "${prompt}"` }]);

                 try {
                     const res = await fetch('/api/generate-image', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ prompt })
                     });
                     
                     const result = await res.json();
                     
                     if (result.imageUrl) {
                         setVaultItems(prev => [...prev, { prompt, url: result.imageUrl, rationale }]);
                         const memoryEntry = `I created an image for the user. Rationale: ${rationale}. Visual Prompt used: ${prompt}.`;
                         saveToMemory(memoryEntry, 'agent');
                     }

                     const toolResponse = {
                       toolResponse: {
                         functionResponses: [{
                           name: "create_vault_artifact",
                           response: { result: "Success", action: "Image generated and saved to vault." }
                         }]
                       }
                     };
                     wsRef.current.send(JSON.stringify(toolResponse));

                 } catch (err) {
                     console.error("🚨 Tool Execution Failed:", err);
                     wsRef.current.send(JSON.stringify({
                         toolResponse: {
                             functionResponses: [{ name: "create_vault_artifact", response: { error: "Failed to generate image." } }]
                         }
                     }));
                 } finally {
                     setIsGeneratingVaultItem(false);
                 }
              }

            }
          }
        } catch (err) {}
      };

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
      } catch (err) { }

      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      const binHz = 62.5; 

      const updateVolume = () => {
         if (analyzerRef.current && wsRef.current) {
            analyzerRef.current.getByteFrequencyData(dataArray);
            const len = dataArray.length; 

            let totalSum = 0;
            let jawSum = 0, jawCount = 0;
            let widthSum = 0, widthCount = 0;

            for (let i = 0; i < len; i++) {
              const val = dataArray[i];
              totalSum += val;

              const freqLow = i * binHz;
              if (freqLow >= 200 && freqLow <= 800) { jawSum += val; jawCount++; }
              if (freqLow >= 2000 && freqLow <= 5500) { widthSum += val; widthCount++; }
            }

            const volume = Math.min((totalSum / len) / 80, 1);
            const jawOpen = jawCount > 0 ? Math.min((jawSum / jawCount) / 100, 1) : 0;
            const mouthWidth = widthCount > 0 ? Math.min((widthSum / widthCount) / 80, 1) : 0;

            volumeRef.current = { volume, jawOpen, mouthWidth };
            requestAnimationFrame(updateVolume);
         }
      };
      updateVolume();

    } catch (error) {
      isConnectingRef.current = false;
    }
  }, [agentId, userId, isConnected, saveToMemory, startVision]); 

  const stopSession = useCallback(() => {
    socketReadyRef.current = false;
    isConnectingRef.current = false;
    nextPlayTimeRef.current = 0;
    
    stopVision(); 
    
    // 🛠️ NEW: Clear pending memory saves on stop
    if (memoryTimeoutRef.current) {
        clearTimeout(memoryTimeoutRef.current);
    }
    
    if (wsRef.current) { try { wsRef.current.close(); } catch(e) {} wsRef.current = null; }
    if (workletNodeRef.current) { workletNodeRef.current.disconnect(); workletNodeRef.current = null; }
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close();
    setIsConnected(false);
    volumeRef.current = { ...VISEME_ZERO };
  }, [stopVision]);

  const playAudioBuffer = async (base64Data: string) => {
     if (!audioContextRef.current) return;
     try {
         const binaryString = window.atob(base64Data);
         const pcmData = new Int16Array(binaryString.length / 2);
         for (let i = 0; i < pcmData.length; i++) {
             pcmData[i] = (binaryString.charCodeAt(i * 2 + 1) << 8) | binaryString.charCodeAt(i * 2); 
         }
         if (pcmData.length === 0) return; 
         
         const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
         const channelData = audioBuffer.getChannelData(0);
         for (let i = 0; i < pcmData.length; i++) channelData[i] = pcmData[i] / 32768.0; 
         
         const source = audioContextRef.current.createBufferSource();
         source.buffer = audioBuffer;
         source.connect(audioContextRef.current.destination); 
         if (analyzerRef.current) source.connect(analyzerRef.current);
         
         const currentTime = audioContextRef.current.currentTime;
         if (nextPlayTimeRef.current < currentTime) {
             nextPlayTimeRef.current = currentTime + 0.05; 
         }
         
         source.start(nextPlayTimeRef.current);
         nextPlayTimeRef.current += audioBuffer.duration;
         
         currentAudioNodesRef.current.push(source);
         source.onended = () => { currentAudioNodesRef.current = currentAudioNodesRef.current.filter(n => n !== source); };
     } catch (error) { }
  };

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef, transcripts };
}