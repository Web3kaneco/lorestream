import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '@/lib/firebase';
import { httpsCallable } from 'firebase/functions';

const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_KEY });

export function useGeminiLive(agentId: string, userId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [vaultItems, setVaultItems] = useState<any[]>([]);
  const [isGeneratingVaultItem, setIsGeneratingVaultItem] = useState(false);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const currentAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const volumeRef = useRef<number>(0);
  
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
          responseModalities: ["AUDIO" as any],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          systemInstruction: {
            parts: [{ 
              text: `You are a helpful AI Co-Creator.
              CORE MEMORY: ${coreMemory?.current_lore_summary || ""} 
              FACTS: ${memoryString}
              Keep your answers conversational, brief, and natural. 
              IMPORTANT: When the user speaks to you, begin your very first response by explicitly saying "I can hear you clearly!" so we know the microphone is working.` 
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
            // 🚀 THE LOG: Let's see what the browser *actually* set your sample rate to!
            console.log(`🎤 Mic Max Amplitude: ${maxAmplitude.toFixed(4)} (Actual Rate: ${audioCtx.sampleRate}Hz)`);
            lastLogTimeRef.current = now;
        }
        
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64Audio = btoa(binary);

        try {
          // 🚀 THE FIX: Tell Google the TRUE sample rate so your voice isn't distorted!
          sessionRef.current.sendRealtimeInput([{ 
            mimeType: `audio/pcm;rate=${audioCtx.sampleRate}`, 
            data: base64Audio 
          }]);
        } catch (err) { }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      const updateVolume = () => {
         if (analyzerRef.current && sessionRef.current) {
            analyzerRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
            volumeRef.current = sum / dataArray.length;
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
    volumeRef.current = 0;
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