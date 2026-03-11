import { useCallback, useRef, useEffect } from 'react';
import { getAuthHeaders } from '@/lib/getAuthToken';

/** Optional image data for multimodal memory embedding. */
export interface MemoryImage {
  base64?: string;      // raw base64, no data: prefix
  mimeType?: string;    // e.g. 'image/jpeg'
  url?: string;         // Firebase Storage URL — server fetches the image if base64 omitted
}

export function useAgentMemory(agentId: string, userId: string) {
  // Track all active controllers for proper cleanup (fixes race condition with single ref)
  const activeControllersRef = useRef<Set<AbortController>>(new Set());
  const lastSavedRef = useRef<string>('');

  const saveToMemory = useCallback(async (
    text: string,
    speaker: 'user' | 'agent',
    image?: MemoryImage
  ) => {
    if (!text || text.trim() === '') return;
    // Skip duplicate saves (same text within short window)
    if (text === lastSavedRef.current) return;
    lastSavedRef.current = text;

    const controller = new AbortController();
    activeControllersRef.current.add(controller);

    const doFetch = async (attempt: number) => {
      try {
        const hdrs = await getAuthHeaders();
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify({
            agentId,
            transcript: text,
            speaker,
            // Multimodal fields — only included when image is provided
            ...(image?.base64 && { imageBase64: image.base64 }),
            ...(image?.mimeType && { imageMimeType: image.mimeType }),
            ...(image?.url && { imageUrl: image.url }),
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || `HTTP ${res.status}`);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') return;
        if (attempt < 1) {
          // Retry once after 2s
          await new Promise(r => setTimeout(r, 2000));
          return doFetch(attempt + 1);
        }
        console.error("[MEMORY SAVE FAILED]", err);
      } finally {
        activeControllersRef.current.delete(controller);
      }
    };

    doFetch(0).catch(() => {}); // Explicitly handle fire-and-forget
  }, [agentId, userId]);

  /** Ingest a file into memory (images, PDFs, etc). Fire-and-forget. */
  const ingestFile = useCallback(async (
    fileBase64: string,
    fileMimeType: string,
    fileName: string,
    description?: string
  ): Promise<{ success: boolean; count?: number; error?: string }> => {
    try {
      const hdrs = await getAuthHeaders();
      const res = await fetch('/api/memory/ingest', {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ agentId, fileBase64, fileMimeType, fileName, description }),
      });
      return await res.json();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error("[INGEST FAILED]", msg);
      return { success: false, error: msg };
    }
  }, [agentId]);

  // Abort ALL in-flight requests on unmount
  useEffect(() => {
    return () => {
      activeControllersRef.current.forEach(c => c.abort());
      activeControllersRef.current.clear();
    };
  }, []);

  return { saveToMemory, ingestFile };
}
