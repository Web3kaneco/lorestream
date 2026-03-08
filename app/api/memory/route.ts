import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

// Lazy init to avoid build-time errors when env var isn't available
let pc: Pinecone | null = null;
function getPinecone() {
  if (!pc) pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  return pc;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agentId, userId, transcript, speaker } = body;

    // 1. Strict validation
    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid transcript" }, { status: 400 });
    }
    if (!agentId || !userId) {
      return NextResponse.json({ error: "Missing agentId or userId" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "No API key configured" }, { status: 500 });
    }

    // 2. Fetch Gemini Embedding (try multiple models for compatibility)
    let vector: number[] | null = null;
    const models = ['text-embedding-004', 'gemini-embedding-001'];

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          outputDimensionality: 768,
          content: { parts: [{ text: transcript }] }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const vals = data.embedding?.values as number[];
        if (vals && Array.isArray(vals) && vals.length > 0) {
          vector = vals;
          break;
        }
      }
    }

    if (!vector) {
      throw new Error("All embedding models failed — check API key permissions");
    }

    // 4. Target your Pinecone Vault with namespace isolation per agent
    const index = getPinecone().Index('agent-memory');
    const safeAgentId = String(agentId || 'unknown_agent');
    const safeUserId = String(userId || 'unknown_user');
    const namespace = index.namespace(`${safeUserId}_${safeAgentId}`);
    const memoryId = `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const record = {
        id: memoryId,
        values: vector,
        metadata: {
            agentId: safeAgentId,
            userId: safeUserId,
            speaker: String(speaker || 'unknown_speaker'),
            text: String(transcript).substring(0, 1000),
            timestamp: Date.now()
        }
    };

    await namespace.upsert({
        records: [record]
    });

    console.log(`💾 [MEMORY] Vault Saved: "${transcript.substring(0, 30)}..."`);
    return NextResponse.json({ success: true, memoryId });

  } catch (error: any) {
    console.error("🚨 [MEMORY API ERROR]:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to process memory" }, { status: 500 });
  }
}