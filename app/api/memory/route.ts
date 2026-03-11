import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { verifyAuthToken } from '@/lib/firebaseAdmin';
import { getEmbeddingWithRetry } from '@/lib/embeddings';

// Lazy init to avoid build-time errors when env var isn't available
let pc: Pinecone | null = null;
function getPinecone() {
  if (!pc) pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  return pc;
}

export async function POST(req: Request) {
  try {
    // ── Auth verification ──
    const authUser = await verifyAuthToken(req.headers.get('authorization'));
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { agentId, transcript, speaker, imageBase64, imageMimeType, imageUrl } = body;

    // Use authenticated UID instead of trusting request body
    const userId = authUser.uid;

    // 1. Strict validation
    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid transcript" }, { status: 400 });
    }
    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // 2. Resolve image data — if imageUrl provided without base64, fetch server-side
    let resolvedImageBase64 = imageBase64 || undefined;
    let resolvedMimeType = imageMimeType || undefined;

    if (imageUrl && !resolvedImageBase64) {
      try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
        if (imgRes.ok) {
          const buffer = await imgRes.arrayBuffer();
          resolvedImageBase64 = Buffer.from(buffer).toString('base64');
          resolvedMimeType = imgRes.headers.get('content-type') || 'image/png';
        }
      } catch (e) {
        console.warn("[MEMORY] Could not fetch image from URL for embedding, falling back to text-only:", e);
      }
    }

    // 3. Fetch Gemini Embedding 2 (multimodal — text + optional image)
    const vector = await getEmbeddingWithRetry({
      text: transcript,
      imageBase64: resolvedImageBase64,
      imageMimeType: resolvedMimeType,
    });

    // 4. Target your Pinecone Vault with namespace isolation per agent
    const index = getPinecone().Index('agent-memory');
    const safeAgentId = String(agentId || 'unknown_agent');
    const namespace = index.namespace(`${userId}_${safeAgentId}`);
    const memoryId = `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const record = {
      id: memoryId,
      values: vector,
      metadata: {
        agentId: safeAgentId,
        userId,
        speaker: String(speaker || 'unknown_speaker'),
        text: String(transcript).substring(0, 1000),
        timestamp: Date.now(),
        contentType: resolvedImageBase64 ? 'text+image' : 'text',
        ...(imageUrl && { imageUrl }),
      },
    };

    await namespace.upsert({ records: [record] });

    return NextResponse.json({ success: true, memoryId });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[MEMORY API ERROR]:", msg);
    return NextResponse.json({ error: msg || "Failed to process memory" }, { status: 500 });
  }
}
