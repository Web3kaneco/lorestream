import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai'; // 🚀 THE FIX: Importing the official Modality enum!
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_KEY });

// =========================================================
// Viseme data extracted from real-time frequency analysis
// of Gemini's audio response. Drives lip sync on the avatar.
// =========================================================
export interface VisemeData {
  volume: number;      // 0-1 overall energy across all frequencies
  jawOpen: number;     // 0-1 jaw openness (200-800Hz: vowel formants, fundamental freq)
  mouthWidth: number;  // 0-1 mouth spread (2000-5500Hz: fricatives "s","sh","ee","f")
}

const VISEME_ZERO: VisemeData = { volume: 0, jawOpen: 0, mouthWidth: 0 };

export function useGeminiLive(agentId: string, userId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [isGeneratingVaultItem, setIsGeneratingVaultItem] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const currentAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const volumeRef = useRef<VisemeData>({ ...VISEME_ZERO });
  
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const socketReadyRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);

  const nextPlayTimeRef = useRef<number>(0);
  const lastLogTimeRef = useRef<number>(0);

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return; 
    isConnectingRef.current = true;
    nextPlayTimeRef.current = 0; 

    try {
      socketReadyRef.current = false;

      const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
      const coreMemory = memorySnap.exists() ? memorySnap.data() : { current_lore_summary: "No prior memories.", key_facts: [] };
      const memoryString = coreMemory.key_facts?.join('. ') || "";

      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
      }

      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.4; // Fast response for lip sync
      analyzerRef.current.minDecibels = -90;
      analyzerRef.current.maxDecibels = -10;
      analyzerRef.current.connect(audioContextRef.current.destination);
      
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, 
          video: true 
      });
      
      if (!videoRef.current) videoRef.current = document.createElement('video');
      videoRef.current.srcObject = micStreamRef.current;
      videoRef.current.muted = true; 
      videoRef.current.play();

      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');

      sessionRef.current = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025", 
        config: {
          // 🚀 THE FIX: Using the strict Modality Enum so Gemini is forced into Voice mode!
          responseModalities: [Modality.AUDIO], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          systemInstruction: {
            parts: [{ 
              text: `You are a helpful AI Co-Creator.
              CORE MEMORY: ${coreMemory?.current_lore_summary || ""} 
              FACTS: ${memoryString}
              CRITICAL: You are strictly a VOICE assistant. Do not use text thinking blocks. Keep your answers conversational, brief, and natural.` 
            }]
          }
        },
        callbacks: {
          onopen: () => { console.log("🟢 Live connection fully opened!"); },
          onclose: (e: any) => { 
            console.log("🔴 Live connection closed."); 
            sessionRef.current = null;
            socketReadyRef.current = false;
            setIsConnected(false);
            isConnectingRef.current = false;
          },
          onerror: (error: any) => { console.error("Live error:", error); },
          onmessage: async (message: any) => {
            if (message.setupComplete) {
                console.log("✅ Handshake Complete! Safe to stream audio.");
                socketReadyRef.current = true;
                
                // 🗣️ THE KICKSTART: Tell it to speak out loud immediately!
                try {
                    sessionRef.current.sendClientContent({
                        turns: "Hello! The microphone is active. Please introduce yourself out loud!",
                        turnComplete: true
                    });
                } catch (e) {}
                
                return; 
            }

            if (message.serverContent?.interrupted) {
              currentAudioNodesRef.current.forEach(node => { try { node.stop(); } catch (e) {} });
              currentAudioNodesRef.current = [];
              nextPlayTimeRef.current = 0; 
            }

            if (!message.serverContent?.modelTurn) return;
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.text) console.log("📝 Gemini Transcript:", part.text);
              if (part.inlineData?.mimeType?.startsWith('audio/')) {
                 console.log("🔊 RECEIVED AUDIO CHUNK!");
                 playAudioBuffer(part.inlineData.data);
              }
            }
          }
        }
      });   
      setIsConnected(true);

      const audioCtx = audioContextRef.current;
      const source = audioCtx.createMediaStreamSource(micStreamRef.current);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      micProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const outputData = e.outputBuffer.getChannelData(0);
        outputData.fill(0); 
        
        if (!sessionRef.current || !socketReadyRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        const buffer = new ArrayBuffer(inputData.length * 2);
        const view = new DataView(buffer);
        
        let maxAmplitude = 0; 
        for (let i = 0; i < inputData.length; i++) {
            const val = inputData[i];
            if (Math.abs(val) > maxAmplitude) maxAmplitude = Math.abs(val);
            const s = Math.max(-1, Math.min(1, val * 3.0)); 
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); 
        }
        
        const now = Date.now();
        if (now - lastLogTimeRef.current > 2000) {
            console.log(`🎤 Mic Max Amplitude: ${maxAmplitude.toFixed(4)} (Actual Rate: 16000Hz)`);
            lastLogTimeRef.current = now;
        }
        
        const bytes = new Uint8Array(buffer);
        let binary = '';
        
        // 🚀 THE FIX: A safer, faster Base64 encoder so we don't drop frames!
        const chunkSize = 1024;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64Audio = btoa(binary);

        try {
          sessionRef.current.sendRealtimeInput([{ 
            mimeType: "audio/pcm;rate=16000", 
            data: base64Audio 
          }]);
        } catch (err) { }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      // =========================================================
      // Frequency-band viseme extraction
      // AudioContext runs at 16kHz → fftSize 256 → 128 bins → 62.5Hz/bin
      // We split into bands that correspond to speech articulation:
      //   jawOpen:    200-800Hz  (bins 3-12)  — vowel formants, voice fundamental
      //   mouthWidth: 2000-5500Hz (bins 32-88) — fricatives (s, sh, f), "ee" spread
      //   volume:     all bins                 — overall energy for gating
      // =========================================================
      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      const binHz = 62.5; // 16000 / 256

      const updateVolume = () => {
         if (analyzerRef.current && sessionRef.current) {
            analyzerRef.current.getByteFrequencyData(dataArray);
            const len = dataArray.length; // 128

            let totalSum = 0;
            let jawSum = 0, jawCount = 0;
            let widthSum = 0, widthCount = 0;

            for (let i = 0; i < len; i++) {
              const val = dataArray[i];
              totalSum += val;

              const freqLow = i * binHz;
              // Jaw band: 200-800Hz (vowel openness, fundamental frequency)
              if (freqLow >= 200 && freqLow <= 800) {
                jawSum += val;
                jawCount++;
              }
              // Width band: 2000-5500Hz (fricatives, sibilants, spread vowels)
              if (freqLow >= 2000 && freqLow <= 5500) {
                widthSum += val;
                widthCount++;
              }
            }

            // Normalize each band to 0-1
            // Divisors tuned for typical speech levels from Gemini audio
            const volume = Math.min((totalSum / len) / 80, 1);
            const jawOpen = jawCount > 0 ? Math.min((jawSum / jawCount) / 100, 1) : 0;
            const mouthWidth = widthCount > 0 ? Math.min((widthSum / widthCount) / 80, 1) : 0;

            volumeRef.current = { volume, jawOpen, mouthWidth };
            requestAnimationFrame(updateVolume);
         }
      };
      updateVolume();

    } catch (error) {
      console.error("Failed to start Live Session:", error);
      isConnectingRef.current = false;
    }
  }, [agentId, userId, isConnected]);

  const stopSession = useCallback(() => {
    socketReadyRef.current = false;
    isConnectingRef.current = false;
    nextPlayTimeRef.current = 0;
    if (sessionRef.current) {
        try { sessionRef.current.close(); } catch(e) {}
        sessionRef.current = null;
    }
    if (micProcessorRef.current) {
        micProcessorRef.current.disconnect();
        micProcessorRef.current = null;
    }
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close();
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    setIsConnected(false);
    volumeRef.current = { ...VISEME_ZERO };
  }, []);

  const playAudioBuffer = async (base64Data: string) => {
     if (!audioContextRef.current || !analyzerRef.current) return;
     try {
         const binaryString = window.atob(base64Data);
         const pcmData = new Int16Array(binaryString.length / 2);
         for (let i = 0; i < pcmData.length; i++) {
             const byteA = binaryString.charCodeAt(i * 2);
             const byteB = binaryString.charCodeAt(i * 2 + 1);
             pcmData[i] = (byteB << 8) | byteA; 
         }
         
         if (pcmData.length === 0) return; 
         
         const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
         const channelData = audioBuffer.getChannelData(0);
         for (let i = 0; i < pcmData.length; i++) {
             channelData[i] = pcmData[i] / 32768.0; 
         }
         
         const source = audioContextRef.current.createBufferSource();
         source.buffer = audioBuffer;
         source.connect(analyzerRef.current); 
         
         const currentTime = audioContextRef.current.currentTime;
         if (nextPlayTimeRef.current < currentTime) {
             nextPlayTimeRef.current = currentTime;
         }
         
         source.start(nextPlayTimeRef.current);
         nextPlayTimeRef.current += audioBuffer.duration;
         
         currentAudioNodesRef.current.push(source);
         source.onended = () => { 
             currentAudioNodesRef.current = currentAudioNodesRef.current.filter(n => n !== source); 
         };
     } catch (error) {}
  };

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef };
}