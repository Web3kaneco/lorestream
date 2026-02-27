// hooks/useVisionPipeline.ts
import { useRef, useCallback, RefObject } from 'react';

const BASE_INTERVAL = 2000;
const MAX_INTERVAL = 16000;
const BACKOFF_AFTER = 3;  // Start backing off after 3 consecutive failures
const MAX_FAILURES = 10;  // Stop pipeline after 10 consecutive failures

export function useVisionPipeline(
  videoRef: RefObject<HTMLVideoElement | null>,
  wsRef: RefObject<WebSocket | null>,
  socketReadyRef: RefObject<boolean>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const failCountRef = useRef(0);
  const currentIntervalRef = useRef(BASE_INTERVAL);

  const scheduleNext = useCallback(() => {
    if (visionIntervalRef.current) clearTimeout(visionIntervalRef.current);

    visionIntervalRef.current = setTimeout(() => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) {
        scheduleNext();
        return;
      }
      if (!videoRef.current || !canvasRef.current || videoRef.current.videoWidth === 0) {
        scheduleNext();
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) { scheduleNext(); return; }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
      const base64Image = dataUrl.split(',')[1];

      const payload = {
        realtimeInput: {
          mediaChunks: [{ mimeType: "image/jpeg", data: base64Image }]
        }
      };

      try {
        wsRef.current.send(JSON.stringify(payload));
        // Success — reset failure tracking
        if (failCountRef.current > 0) {
          failCountRef.current = 0;
          currentIntervalRef.current = BASE_INTERVAL;
        }
      } catch (e) {
        failCountRef.current++;
        console.error(`[VISION] Failed to send frame (${failCountRef.current}/${MAX_FAILURES})`, e);

        if (failCountRef.current >= MAX_FAILURES) {
          console.warn("[VISION] Too many consecutive failures — stopping pipeline");
          return; // Don't schedule next — pipeline stops
        }

        // Adaptive backoff after BACKOFF_AFTER consecutive failures
        if (failCountRef.current >= BACKOFF_AFTER) {
          currentIntervalRef.current = Math.min(currentIntervalRef.current * 2, MAX_INTERVAL);
        }
      }

      scheduleNext();
    }, currentIntervalRef.current);
  }, [videoRef, wsRef, socketReadyRef]);

  const startVision = useCallback(() => {
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    failCountRef.current = 0;
    currentIntervalRef.current = BASE_INTERVAL;
    scheduleNext();
  }, [scheduleNext]);

  const stopVision = useCallback(() => {
    if (visionIntervalRef.current) {
      clearTimeout(visionIntervalRef.current);
      visionIntervalRef.current = null;
    }
    failCountRef.current = 0;
    currentIntervalRef.current = BASE_INTERVAL;
  }, []);

  return { startVision, stopVision };
}
