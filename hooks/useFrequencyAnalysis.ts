import { useRef, useCallback } from 'react';
import type { VisemeData } from './useGeminiLive';

const VISEME_ZERO: VisemeData = { volume: 0, jawOpen: 0, mouthWidth: 0 };

export function useFrequencyAnalysis() {
  const volumeRef = useRef<VisemeData>({ ...VISEME_ZERO });
  const rafIdRef = useRef<number | null>(null);

  const startAnalysis = useCallback((analyser: AnalyserNode, sampleRate = 24000) => {
    // Stop any existing loop before starting a new one
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    // Compute bin width from actual sample rate and FFT size
    const binHz = sampleRate / analyser.fftSize;

    let frameCount = 0;
    const updateVolume = () => {
      // Throttle to ~30fps (every other frame) for efficiency
      frameCount++;
      if (frameCount % 2 === 0) {
        analyser.getByteFrequencyData(dataArray);
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
      }
      rafIdRef.current = requestAnimationFrame(updateVolume);
    };
    rafIdRef.current = requestAnimationFrame(updateVolume);
  }, []);

  const stopAnalysis = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    volumeRef.current = { ...VISEME_ZERO };
  }, []);

  return { volumeRef, startAnalysis, stopAnalysis };
}
