import { useRef, useCallback } from 'react';

export function useAudioPlayback() {
  const currentAudioNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);

  const playAudioBuffer = useCallback(async (
    base64Data: string,
    audioContext: AudioContext,
    analyser: AnalyserNode | null
  ) => {
    try {
      const binaryString = window.atob(base64Data);
      const pcmData = new Int16Array(binaryString.length / 2);
      for (let i = 0; i < pcmData.length; i++) {
        pcmData[i] = (binaryString.charCodeAt(i * 2 + 1) << 8) | binaryString.charCodeAt(i * 2);
      }
      if (pcmData.length === 0) return;

      const audioBuffer = audioContext.createBuffer(1, pcmData.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < pcmData.length; i++) channelData[i] = pcmData[i] / 32768.0;

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      if (analyser) source.connect(analyser);

      const currentTime = audioContext.currentTime;
      if (nextPlayTimeRef.current < currentTime) {
        // Fell behind — catch up with a small gap to avoid clicks
        nextPlayTimeRef.current = currentTime + 0.02;
      }

      try {
        source.start(nextPlayTimeRef.current);
        nextPlayTimeRef.current += audioBuffer.duration;
      } catch (err) {
        // Scheduling failed (e.g. time in past, context closed) — reset and retry once
        console.warn("[AUDIO] Failed to schedule chunk, resetting timeline:", err);
        nextPlayTimeRef.current = audioContext.currentTime + 0.02;
        try {
          source.start(nextPlayTimeRef.current);
          nextPlayTimeRef.current += audioBuffer.duration;
        } catch (e) {
          // Give up on this chunk
          console.error("[AUDIO] Retry also failed:", e);
          return;
        }
      }

      currentAudioNodesRef.current.push(source);
      source.onended = () => {
        currentAudioNodesRef.current = currentAudioNodesRef.current.filter(n => n !== source);
      };
    } catch (error) {
      console.error("[AUDIO PLAYBACK ERROR]", error);
    }
  }, []);

  const stopAllPlayback = useCallback(() => {
    currentAudioNodesRef.current.forEach(node => {
      try { node.stop(); node.disconnect(); } catch(e) {}
    });
    currentAudioNodesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const interruptPlayback = useCallback(() => {
    currentAudioNodesRef.current.forEach(node => {
      try { node.stop(); } catch(e) {}
    });
    currentAudioNodesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  return { playAudioBuffer, stopAllPlayback, interruptPlayback };
}
