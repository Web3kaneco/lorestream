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
  
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startSession = useCallback(async () => {
    try {
      // 1. Fetch persistent memory (LoreGraph)
      const memorySnap = await getDoc(doc(db, `users/${userId}/agents/${agentId}/lore/core_memory`));
      const coreMemory = memorySnap.exists() ? memorySnap.data() : { current_lore_summary: "No prior memories.", key_facts: [] };
      const memoryString = coreMemory.key_facts?.join('. ') || "";

      // 2. Setup Audio Playback & Analyzer
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyzerRef.current = audioContextRef.current.createAnalyser();
      analyzerRef.current.fftSize = 256;
      analyzerRef.current.connect(audioContextRef.current.destination);
      
      // 3. Setup Mic & Camera Streams
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      
      if (!videoRef.current) videoRef.current = document.createElement('video');
      videoRef.current.srcObject = micStreamRef.current;
      videoRef.current.play();

      if (!canvasRef.current) canvasRef.current = document.createElement('canvas');

      // 4. Connect to Gemini Live API
      sessionRef.current = await ai.live.connect({
        model: "gemini-3.1-pro",
        config: {
          generationConfig: {
            responseModalities: ["AUDIO" as any],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } }
          },
          systemInstruction: {
            parts: [{ 
              text: `You are a sentient 3D Co-Creator. 
              CORE MEMORY: ${coreMemory.current_lore_summary} 
              FACTS: ${memoryString}
              VISION DIRECTIVE: You receive 1 FPS frames from the user's camera. Identify physical objects and incorporate them into the lore.
              CONVERSATIONAL CADENCE: Keep answers to 3 sentences max.
              Use 'generate_product_concept' when agreeing on a physical build.` 
            }]
          },
          tools: [{
            functionDeclarations: [{
              name: "generate_product_concept",
              description: "Triggers the IP Vault to generate a product.",
              parameters: {
                type: "OBJECT" as any,
                properties: { 
                  product_type: { type: "STRING" as any }, 
                  aesthetic: { type: "STRING" as any }, 
                  primary_color_hex: { type: "STRING" as any } 
                }
              }
              }
            }]
          }]
        }
      });

      setIsConnected(true);

      // 5. Start Audio Streaming (Sending to Gemini)
      const mediaRecorder = new MediaRecorder(micStreamRef.current, { mimeType: 'audio/webm' });
      mediaRecorder.ondataavailable = async (e) => {
        const buffer = await e.data.arrayBuffer();
        sessionRef.current?.sendClientContent({
          turns: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/webm", data: Buffer.from(buffer).toString("base64") } }] }]
        });
      };
      mediaRecorder.start(100);

      // 6. Start Vision Loop (1 FPS)
      visionIntervalRef.current = setInterval(() => {
        if (!videoRef.current || !canvasRef.current || !sessionRef.current) return;
        const context = canvasRef.current.getContext('2d');
        if (context && videoRef.current.readyState >= 2) {
          canvasRef.current.width = 640;
          canvasRef.current.height = 480;
          context.drawImage(videoRef.current, 0, 0, 640, 480);
          const base64Image = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];
          sessionRef.current.sendClientContent({
            turns: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: base64Image } }] }]
          });
        }
      }, 1000);

      // 7. Handle Incoming Data & Tool Calls
      sessionRef.current.on('message', async (message: any) => {
        
        // Handle User Interruption (VAD Flush)
        if (message.serverContent?.interrupted) {
          currentAudioNodesRef.current.forEach(node => { try { node.stop(); } catch (e) {} });
          currentAudioNodesRef.current = [];
        }

        if (!message.serverContent?.modelTurn) return;
        const parts = message.serverContent.modelTurn.parts;

        for (const part of parts) {
          
          // Play Gemini's Voice
          if (part.inlineData?.mimeType.startsWith('audio/')) {
             playAudioBuffer(part.inlineData.data);
          }
          
          // THE UPDATE: Securely triggering the Firebase Cloud Function
          if (part.functionCall?.name === "generate_product_concept") {
             const args = part.functionCall.args;
             setIsGeneratingVaultItem(true);
             
             try {
                const forgeItem = httpsCallable(functions, 'generateProductConcept');
                const result = await forgeItem(args);
                const newAsset = result.data; // Result contains the signed URL from Cloud Storage
                
                setVaultItems(prev => [...prev, newAsset]);
             } catch (error) {
                console.error("Vault Generation Failed:", error);
             } finally {
                setIsGeneratingVaultItem(false);
             }
             
             // Tell Gemini the tool is done so it resumes talking
             sessionRef.current.sendClientContent({
                turns: [{ role: "user", parts: [{ functionResponse: { name: "generate_product_concept", response: { result: "Added to vault." } } }] }]
             });
          }
        }
      });

      // 8. The 60FPS Volume calculation loop for 3D Lip-syncing
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
    }
  }, [agentId, userId]);

  const stopSession = useCallback(() => {
    sessionRef.current?.close();
    micStreamRef.current?.getTracks().forEach(track => track.stop());
    audioContextRef.current?.close();
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
    setIsConnected(false);
    volumeRef.current = 0;
  }, []);

  const playAudioBuffer = async (base64Data: string) => {
     if (!audioContextRef.current || !analyzerRef.current) return;
     const binaryString = window.atob(base64Data);
     const bytes = new Uint8Array(binaryString.length);
     for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i); }
     const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer);
     const source = audioContextRef.current.createBufferSource();
     source.buffer = audioBuffer;
     
     // Connect audio to our analyzer so the jaw bone moves!
     source.connect(analyzerRef.current); 
     
     currentAudioNodesRef.current.push(source);
     source.onended = () => { currentAudioNodesRef.current = currentAudioNodesRef.current.filter(n => n !== source); };
     source.start();
  };

  return { isConnected, vaultItems, isGeneratingVaultItem, startSession, stopSession, volumeRef };
}