import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { verifyAuthToken } from '@/lib/firebaseAdmin';
import { getEmbeddingWithRetry } from '@/lib/embeddings';

// Lazy init
let pc: Pinecone | null = null;
function getPinecone() {
  if (!pc) pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  return pc;
}

// Max base64 size we'll accept (~10MB decoded)
const MAX_BASE64_LENGTH = 14_000_000;

export async function POST(req: Request) {
  try {
    // ── Auth verification ──
    const authUser = await verifyAuthToken(req.headers.get('authorization'));
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = authUser.uid;

    const body = await req.json();
    const { agentId, fileBase64, fileMimeType, fileName, description } = body;

    if (!agentId || !fileBase64 || !fileMimeType || !fileName) {
      return NextResponse.json({ error: 'Missing required fields: agentId, fileBase64, fileMimeType, fileName' }, { status: 400 });
    }

    if (fileBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json({ error: 'File too large. Max ~10MB.' }, { status: 413 });
    }

    const index = getPinecone().Index('agent-memory');
    const safeAgentId = String(agentId);
    const namespace = index.namespace(`${userId}_${safeAgentId}`);

    // ── Image ingestion ──
    if (fileMimeType.startsWith('image/')) {
      const textContext = description || `Uploaded image: ${fileName}`;

      const vector = await getEmbeddingWithRetry({
        text: textContext,
        imageBase64: fileBase64,
        imageMimeType: fileMimeType,
      });

      const memoryId = `ingest_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      // Note: Firebase Storage upload is handled client-side before calling this endpoint.
      // The imageUrl can be passed via the request body if already uploaded.
      const { imageUrl } = body;

      await namespace.upsert({
        records: [{
          id: memoryId,
          values: vector,
          metadata: {
            agentId: safeAgentId,
            userId,
            speaker: 'ingested',
            text: textContext.substring(0, 1000),
            timestamp: Date.now(),
            contentType: 'ingested_image',
            fileName,
            ...(imageUrl && { imageUrl: String(imageUrl) }),
          },
        }],
      });

      return NextResponse.json({ success: true, count: 1, memoryId });
    }

    // ── PDF / text document ingestion ──
    // For PDFs, Gemini Embedding 2 can embed PDF content natively.
    // We treat it as text context (description + fileName) embedded alongside the document.
    if (fileMimeType === 'application/pdf' || fileMimeType.startsWith('text/')) {
      // For text files, decode base64 to get text content
      let textContent = description || `Document: ${fileName}`;

      if (fileMimeType.startsWith('text/')) {
        try {
          const decoded = Buffer.from(fileBase64, 'base64').toString('utf-8');
          textContent = decoded.substring(0, 4000); // cap for embedding context
        } catch {
          // Fall back to description
        }
      }

      // Chunk text into ~2000-char segments for better retrieval
      const chunks = chunkText(textContent, 2000);
      const records = [];

      for (let i = 0; i < chunks.length; i++) {
        const chunkText = `[${fileName}${chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : ''}]: ${chunks[i]}`;
        const vector = await getEmbeddingWithRetry({ text: chunkText });
        const memoryId = `ingest_${Date.now()}_${i}_${Math.floor(Math.random() * 1000)}`;

        records.push({
          id: memoryId,
          values: vector,
          metadata: {
            agentId: safeAgentId,
            userId,
            speaker: 'ingested',
            text: chunkText.substring(0, 1000),
            timestamp: Date.now(),
            contentType: 'ingested_document',
            fileName,
            chunkIndex: i,
            totalChunks: chunks.length,
          },
        });
      }

      // Batch upsert (Pinecone supports up to 100 vectors per call)
      const batchSize = 50;
      for (let i = 0; i < records.length; i += batchSize) {
        await namespace.upsert({ records: records.slice(i, i + batchSize) });
      }

      return NextResponse.json({ success: true, count: records.length });
    }

    return NextResponse.json({ error: `Unsupported file type: ${fileMimeType}` }, { status: 400 });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[INGEST API ERROR]:', msg);
    return NextResponse.json({ error: msg || 'Failed to ingest file' }, { status: 500 });
  }
}

/** Split text into chunks of roughly maxLen characters, breaking at sentence boundaries. */
function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to break at sentence boundary
    let breakAt = maxLen;
    const lastPeriod = remaining.lastIndexOf('. ', maxLen);
    const lastNewline = remaining.lastIndexOf('\n', maxLen);
    const bestBreak = Math.max(lastPeriod, lastNewline);

    if (bestBreak > maxLen * 0.5) {
      breakAt = bestBreak + 1;
    }

    chunks.push(remaining.substring(0, breakAt).trim());
    remaining = remaining.substring(breakAt).trim();
  }

  return chunks.filter(c => c.length > 0);
}
