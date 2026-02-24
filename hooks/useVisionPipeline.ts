// hooks/useVisionPipeline.ts
import { useRef, useCallback, RefObject } from 'react';

export function useVisionPipeline(
  videoRef: RefObject<HTMLVideoElement | null>,
  wsRef: RefObject<WebSocket | null>,
  socketReadyRef: RefObject<boolean>
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const startVision = useCallback(() => {
    if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);

    visionIntervalRef.current = setInterval(() => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !socketReadyRef.current) return;
        if (!videoRef.current || !canvasRef.current || videoRef.current.videoWidth === 0) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        
        // Compress to 640x480
        canvas.width = 640; 
        canvas.height = 480;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Extract JPEG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
        const base64Image = dataUrl.split(',')[1]; 

        const payload = {
          realtimeInput: {
            mediaChunks: [{ mimeType: "image/jpeg", data: base64Image }]
          }
        };
        
        try {
            wsRef.current.send(JSON.stringify(payload));
        } catch (e) {
            console.error("🚨 [VISION] Failed to send frame", e);
        }
    }, 2000); // 1 frame every 2 seconds
  }, [videoRef, wsRef, socketReadyRef]);

  const stopVision = useCallback(() => {
    if (visionIntervalRef.current) clearInterval(visionIntervalRef.current);
  }, []);

  return { startVision, stopVision };
}