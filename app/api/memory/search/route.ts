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
    const { query, userId, agentId } = body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid query" }, { status: 400 });
    }

    if (!userId || !agentId) {
      return NextResponse.json({ error: "Missing userId or agentId" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;

    // 1. Embed the query using the same model as the write path (768-dim)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;

    const embeddingRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        outputDimensionality: 768,
        content: { parts: [{ text: query }] }
      })
    });

    if (!embeddingRes.ok) {
      throw new Error(`Gemini Embedding API returned HTTP ${embeddingRes.status}`);
    }
    const embeddingData = await embeddingRes.json();

    if (embeddingData.error) {
      throw new Error(`Google Embedding API Error: ${embeddingData.error.message}`);
    }

    const vector = embeddingData.embedding?.values as number[];

    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      console.error("[MEMORY SEARCH] Invalid embedding response:", JSON.stringify(embeddingData));
      throw new Error("Invalid or empty embedding values from Google API.");
    }

    // 2. Query Pinecone for similar memories, filtered by user+agent
    const index = getPinecone().Index('agent-memory');
    const namespace = index.namespace(`${userId}_${agentId}`);

    // Namespace already isolates by user+agent, so no filter needed
    const queryResult = await namespace.query({
      vector,
      topK: 5,
      includeMetadata: true,
    });

    // 3. Extract text from matches above relevance threshold
    const MIN_SCORE = 0.5;
    const memories: string[] = [];

    if (queryResult.matches && queryResult.matches.length > 0) {
      for (const match of queryResult.matches) {
        if ((match.score ?? 0) >= MIN_SCORE && match.metadata?.text) {
          const speaker = match.metadata.speaker || 'unknown';
          const text = String(match.metadata.text);
          memories.push(`[${speaker}]: ${text}`);
        }
      }
    }

    console.log(`[MEMORY SEARCH] Query: "${query.substring(0, 40)}..." -> ${memories.length} memories found`);
    return NextResponse.json({ memories });

  } catch (error: any) {
    console.error("[MEMORY SEARCH ERROR]:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to search memory" }, { status: 500 });
  }
}
