import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

// Lazy init to avoid build-time errors when env var isn't available
let pc: Pinecone | null = null;
function getPinecone() {
  if (!pc) pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });
  return pc;
}

// Circuit breaker — stop spamming API if key is invalid
let consecutiveFailures = 0;
const MAX_FAILURES = 3;

// Try embedding with fallback models
async function getEmbedding(text: string, apiKey: string): Promise<number[]> {
  const models = [
    'text-embedding-004',
    'gemini-embedding-001',
  ];

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
      const vector = data.embedding?.values as number[];
      if (vector && Array.isArray(vector) && vector.length > 0) {
        consecutiveFailures = 0; // Reset circuit breaker
        return vector;
      }
    }
    // Try next model
  }

  throw new Error('All embedding models failed — check API key permissions');
}

export async function POST(req: Request) {
  try {
    // Circuit breaker — don't spam API if key is clearly invalid
    if (consecutiveFailures >= MAX_FAILURES) {
      return NextResponse.json({ memories: [], note: 'Memory search temporarily disabled — embedding API unavailable' });
    }

    const body = await req.json();
    const { query, userId, agentId } = body;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid query" }, { status: 400 });
    }

    if (!userId || !agentId) {
      return NextResponse.json({ error: "Missing userId or agentId" }, { status: 400 });
    }

    // Server-side routes use GEMINI_API_KEY (never exposed to browser).
    // Falls back to NEXT_PUBLIC_GEMINI_KEY for local dev convenience.
    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_KEY;
    if (!apiKey) {
      return NextResponse.json({ memories: [], note: 'No API key configured' });
    }

    // 1. Embed the query with fallback models
    let vector: number[];
    try {
      vector = await getEmbedding(query, apiKey);
    } catch (e) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) {
        console.warn(`[MEMORY SEARCH] Circuit breaker tripped after ${MAX_FAILURES} failures — disabling until restart`);
      }
      throw e;
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
