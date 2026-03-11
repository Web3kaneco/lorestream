import { GoogleGenAI } from '@google/genai';

// Lazy-init — same pattern as generate-image/route.ts
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    const key = process.env.GEMINI_API_KEY || '';
    if (!key) throw new Error('Gemini API key not configured');
    _ai = new GoogleGenAI({ apiKey: key });
  }
  return _ai;
}

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingInput {
  text: string;
  imageBase64?: string;       // raw base64 (no data: prefix)
  imageMimeType?: string;     // e.g. 'image/jpeg'
}

/**
 * Get a 768-dim embedding vector using Gemini Embedding 2.
 * Supports multimodal: text-only OR text + image in the same vector space.
 * Backward-compatible — omit image fields for text-only embedding.
 */
export async function getEmbeddingWithRetry(
  input: EmbeddingInput,
  maxAttempts = 2
): Promise<number[]> {
  // Build contents array — text first, then optional image
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contents: any[] = [];

  if (input.text) {
    contents.push(input.text);
  }

  if (input.imageBase64 && input.imageMimeType) {
    contents.push({
      inlineData: {
        data: input.imageBase64,
        mimeType: input.imageMimeType,
      },
    });
  }

  if (contents.length === 0) {
    throw new Error('Embedding input must include text or image');
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await getAI().models.embedContent({
        model: EMBEDDING_MODEL,
        contents,
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      // SDK returns response.embeddings[0].values
      const values = response.embeddings?.[0]?.values;
      if (!values || !Array.isArray(values) || values.length === 0) {
        throw new Error('Embedding returned empty values');
      }

      return values;
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      // Rate limited — wait and retry
      if (status === 429 && attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      // Last attempt — throw
      if (attempt === maxAttempts - 1) throw err;
      // Other error — brief wait then retry
      await new Promise(r => setTimeout(r, 500));
    }
  }

  throw new Error('All embedding attempts failed');
}
