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

// Circuit breaker — stop spamming API if key is invalid
let consecutiveFailures = 0;
const MAX_FAILURES = 5;

export async function POST(req: Request) {
  try {
    // ── Auth verification ──
    const authUser = await verifyAuthToken(req.headers.get('authorization'));
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Circuit breaker — don't spam API if key is clearly invalid
    if (consecutiveFailures >= MAX_FAILURES) {
      return NextResponse.json({ memories: [], note: 'Memory search temporarily disabled — embedding API unavailable' });
    }

    const body = await req.json();
    const { query, agentId } = body;

    // Use authenticated UID instead of trusting request body
    const userId = authUser.uid;

    if (!query || typeof query !== 'string' || query.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid query" }, { status: 400 });
    }

    if (!agentId) {
      return NextResponse.json({ error: "Missing agentId" }, { status: 400 });
    }

    // 1. Embed the query with Gemini Embedding 2 (text-only for search queries)
    let vector: number[];
    try {
      vector = await getEmbeddingWithRetry({ text: query });
      consecutiveFailures = 0; // Reset circuit breaker on success
    } catch (e) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_FAILURES) {
        console.warn(`[MEMORY SEARCH] Circuit breaker tripped after ${MAX_FAILURES} failures`);
      }
      throw e;
    }

    // 2. Query Pinecone for similar memories, filtered by user+agent
    const index = getPinecone().Index('agent-memory');
    const namespace = index.namespace(`${userId}_${agentId}`);

    const queryResult = await namespace.query({
      vector,
      topK: 5,
      includeMetadata: true,
    });

    // 3. Extract text from matches above relevance threshold
    const MIN_SCORE = 0.5;
    const memories: string[] = [];
    const results: { text: string; contentType: string; imageUrl: string | null; score: number }[] = [];

    if (queryResult.matches && queryResult.matches.length > 0) {
      for (const match of queryResult.matches) {
        if ((match.score ?? 0) >= MIN_SCORE && match.metadata?.text) {
          const speaker = match.metadata.speaker || 'unknown';
          const text = String(match.metadata.text);
          const formatted = `[${speaker}]: ${text}`;
          memories.push(formatted);
          results.push({
            text: formatted,
            contentType: String(match.metadata.contentType || 'text'),
            imageUrl: match.metadata.imageUrl ? String(match.metadata.imageUrl) : null,
            score: match.score ?? 0,
          });
        }
      }
    }

    // Backward-compatible: memories[] for existing system prompt injection + rich results[]
    return NextResponse.json({ memories, results });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[MEMORY SEARCH ERROR]:", msg);
    return NextResponse.json({ error: msg || "Failed to search memory" }, { status: 500 });
  }
}
