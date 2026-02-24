import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai'; 
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';

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
  
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketReadyRef = useRef<boolean>(false);
  const isConnectingRef = useRef<boolean>(false);

  const lastLogTimeRef = useRef<number>(0);
  const nextPlayTimeRef = useRef<number>(0);

  const startSession = useCallback(async () => {
    if (isConnectingRef.current || isConnected) return; 
    isConnectingRef.current = true;
    nextPlayTimeRef.current = 0; 

    try {
      socketReadyRef.current = false;
      console.log("🔍 [DIAGNOSTIC] Fetching Firebase Lore...");

      const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
      const coreMemory = memorySnap.exists() ? memorySnap.data() : { current_lore_summary: "No prior memories.", key_facts: [] };
      const memoryString = coreMemory.key_facts?.join('. ') || "";

      console.log("🔍 [DIAGNOSTIC] Initializing AudioContext at 16000Hz...");
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      analyzerRef.current = audioCtx.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.smoothingTimeConstant = 0.4; // Fast response for lip sync
      analyzerRef.current.minDecibels = -90;
      analyzerRef.current.maxDecibels = -10;
      analyzerRef.current.connect(audioContextRef.current.destination);
      
      console.log("🔍 [DIAGNOSTIC] Requesting Microphone Access...");
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ 
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, 
          video: true 
      });
      
      if (!videoRef.current) videoRef.current = document.createElement('video');
      videoRef.current.srcObject = micStreamRef.current;
      videoRef.current.muted = true; 
      videoRef.current.play();

      console.log("🔍 [DIAGNOSTIC] Connecting to Gemini API...");
      sessionRef.current = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025", 
        config: {
          responseModalities: [Modality.AUDIO], 
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          systemInstruction: {
            parts: [{ 
              text: `You are a helpful AI Co-Creator.
              CORE MEMORY: ${coreMemory?.current_lore_summary || ""} 
              FACTS: ${memoryString}
              CRITICAL INSTRUCTION: You are strictly a VOICE assistant. Wait for the user to speak, and then reply conversationally and briefly.` 
            }]
          }
        },
        callbacks: {
          onopen: () => console.log("🟢 [WS] Connection Fully Opened!"),
          onclose: (e: any) => { 
            console.warn("🔴 [WS] Connection Closed. Event:", e); 
            sessionRef.current = null;
            socketReadyRef.current = false;
            setIsConnected(false);
            isConnectingRef.current = false;
          },
          onerror: (error: any) => console.error("🚨 [WS] LIVE ERROR CAUGHT:", error),
          onmessage: async (message: any) => {
            console.log("📥 [SERVER RESPONSE RAW]:", message);

            if (message.setupComplete) {
                console.log("✅ [DIAGNOSTIC] Handshake Complete! Safe to stream audio.");
                socketReadyRef.current = true;
                return; 
            }
            if (message.serverContent?.interrupted) {
              console.log("⚠️ [DIAGNOSTIC] AI Interrupted by user.");
              currentAudioNodesRef.current.forEach(node => { try { node.stop(); } catch (e) {} });
              currentAudioNodesRef.current = [];
              nextPlayTimeRef.current = 0; 
            }
            if (!message.serverContent?.modelTurn) return;
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.text) console.log("📝 [GEMINI TRANSCRIPT]:", part.text);
              if (part.inlineData?.mimeType?.startsWith('audio/')) {
                 console.log(`🔊 [DIAGNOSTIC] Audio Received! Size: ${part.inlineData.data.length} bytes`);
                 playAudioBuffer(part.inlineData.data);
              }
            }
          }
        }
      });   
      setIsConnected(true);

      const source = audioCtx.createMediaStreamSource(micStreamRef.current);
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -24; 
      compressor.knee.value = 30;       
      compressor.ratio.value = 12;      
      compressor.attack.value = 0.003;  
      compressor.release.value = 0.25;  
      source.connect(compressor);
      
      try {
        await audioCtx.audioWorklet.addModule('/audio-processor.js');
        const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor', {
            channelCount: 1,
            channelCountMode: 'explicit'
        });
        workletNodeRef.current = workletNode;

        workletNode.port.onmessage = (event) => {
          if (!sessionRef.current || !socketReadyRef.current) return;
          const { pcmData, maxAmplitude } = event.data;
          
          const bytes = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i += 1024) {
              const end = Math.min(i + 1024, bytes.byteLength);
              binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
          }
          const base64Audio = btoa(binary);

          const now = Date.now();
          if (now - lastLogTimeRef.current > 2000) {
              console.log(`📤 [HANDOFF CHECK] Sending Payload... Amplitude: ${maxAmplitude.toFixed(4)} | Base64 Length: ${base64Audio.length} chars | Target: 16000Hz`);
              lastLogTimeRef.current = now;
          }
          
          try {
            // 🚀 THE FIX: We explicitly wrap the payload in the `mediaChunks` object so the SDK stops dropping it!
            const payload = {
              mediaChunks: [{
                mimeType: "audio/pcm;rate=16000",
                data: base64Audio
              }]
            };

            // Raw JSON bypass to guarantee the envelope isn't empty
            if (typeof sessionRef.current.send === 'function') {
                sessionRef.current.send({ realtimeInput: payload });
            } else {
                sessionRef.current.sendRealtimeInput(payload);
            }

          } catch (err) { 
            console.error("🚨 [HANDOFF CAUGHT EXCEPTION]:", err);
          }
        };

        compressor.connect(workletNode);
        workletNode.connect(audioCtx.destination);
      } catch (err) { console.error("🚨 [AudioWorklet Load Failed]:", err); }

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
      console.error("🚨 [Critical Session Failure]:", error);
      isConnectingRef.current = false;
    }
  }, [agentId, userId, isConnected]);

  const stopSession = useCallback(() => {
    socketReadyRef.current = false;
    isConnectingRef.current = false;
    nextPlayTimeRef.current = 0;
    if (sessionRef.current) { try { sessionRef.current.close(); } catch(e) {} sessionRef.current = null; }
    if (workletNodeRef.current) { workletNodeRef.current.disconnect(); workletNodeRef.current = null; }
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close();
    setIsConnected(false);
    volumeRef.current = { ...VISEME_ZERO };
  }, []);

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
         if (nextPlayTimeRef.current < currentTime) nextPlayTimeRef.current = currentTime;
         
         source.start(nextPlayTimeRef.current);
         nextPlayTimeRef.current += audioBuffer.duration;
         
         currentAudioNodesRef.current.push(source);
         source.onended = () => { currentAudioNodesRef.current = currentAudioNodesRef.current.filter(n => n !== source); };
     } catch (error) { console.error("🚨 [Playback Error]:", error); }
  };

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef };
}