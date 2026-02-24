import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agentId, userId, transcript, speaker } = body;

    // 1. Strict transcript validation (catches spaces and empty strings)
    if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
      return NextResponse.json({ error: "Missing or invalid transcript" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;
    
    // 2. Fetch Gemini Embedding
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        outputDimensionality: 768, 
        content: { parts: [{ text: transcript }] }
      })
    });

    const data = await res.json();
    
    if (data.error) throw new Error(`Google API Error: ${data.error.message}`);
    
    const vector = data.embedding?.values;
    
    // 3. Strict Vector Validation: Ensures it exists AND has numbers
    if (!vector || !Array.isArray(vector) || vector.length === 0) {
      console.error("🚨 [MEMORY API ERROR] Invalid Google Response:", JSON.stringify(data));
      throw new Error("Invalid or empty embedding values returned from Google API.");
    }

    // 4. Target your Pinecone Vault
    const index = pc.Index('agent-memory');
    const memoryId = `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const record = {
        id: memoryId,
        values: vector,
        metadata: {
            agentId: String(agentId || 'unknown_agent'),
            userId: String(userId || 'unknown_user'),
            speaker: String(speaker || 'unknown_speaker'),
            text: String(transcript).substring(0, 1000), // Safety truncation for Pinecone metadata limits
            timestamp: Date.now()
        }
    };

// Modern v2+ syntax
await index.upsert([record]);

    console.log(`💾 [MEMORY] Vault Saved: "${transcript.substring(0, 30)}..."`);
    return NextResponse.json({ success: true, memoryId });

  } catch (error: any) {
    console.error("🚨 [MEMORY API ERROR]:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to process memory" }, { status: 500 });
  }
}