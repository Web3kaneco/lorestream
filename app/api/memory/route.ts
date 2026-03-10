import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { verifyAuthToken } from '@/lib/firebaseAdmin';

// Lazy init to avoid build-time errors when env var isn't available
let pc: Pinecone | null = null;
function getPinecone() {
  if (!pc) pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  return pc;
}

// Retry-aware embedding fetch — retries once after 500ms on failure
async function getEmbeddingWithRetry(text: string, apiKey: string): Promise<number[]> {
  const models = ['text-embedding-004', 'gemini-embedding-001'];
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          outputDimensionality: 768,
          content: { parts: [{ text }] }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const vals = data.embedding?.values as number[];
        if (vals && Array.isArray(vals) && vals.length > 0) return vals;
      }

      // If rate limited (429), wait before retry
      if (res.status === 429 && attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        break; // restart model loop on next attempt
      }
    }

    // Wait between retry attempts
    if (attempt < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  throw new Error("All embedding models failed — check API key permissions");
}

export async function POST(req: Request) {
  try {
    // ── Auth verification ──
    const authUser = await verifyAuthToken(req.headers.get('authorization'));
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { agentId, transcript, speaker } = body;

    // Use authenticated UID instead of trusting request body
    const userId = authUser.uid;

    // 1. Strict validation
    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid transcript" }, { status: 400 });
    }
    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // Server-side routes use GEMINI_API_KEY (never exposed to browser).
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 500 });
    }

    // 2. Fetch Gemini Embedding with retry
    const vector = await getEmbeddingWithRetry(transcript, apiKey);

    // 3. Target your Pinecone Vault with namespace isolation per agent
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
            timestamp: Date.now()
        }
    };

    await namespace.upsert({
        records: [record]
    });

    return NextResponse.json({ success: true, memoryId });

  } catch (error: any) {
    console.error("[MEMORY API ERROR]:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to process memory" }, { status: 500 });
  }
}
