import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });

export async function POST(req: Request) {
  try {
    const { agentId, userId, transcript, speaker } = await req.json();
    if (!transcript) return NextResponse.json({ error: "Missing transcript" }, { status: 400 });

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;
    
    // 🚀 THE FIX: Target the brand new gemini-embedding-001 model endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        // 🚀 THE COMPRESSION: Force Google to scale the vector down to perfectly match your Pinecone DB
        output_dimensionality: 768, 
        content: { parts: [{ text: transcript }] }
      })
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    
    // Extract the mathematically perfect 768-dimension vector
    const vector = data.embedding.values;

    // 2. Save directly to your Pinecone Vault
    const index = pc.Index('agent-memory');
    const memoryId = `mem_${Date.now()}`;
    
    // @ts-ignore
    await index.upsert([{
      id: memoryId,
      values: vector,
      metadata: {
        agentId: String(agentId),
        userId: String(userId),
        speaker: String(speaker), 
        text: String(transcript),
        timestamp: Date.now()
      }
    }]);

    console.log(`💾 [MEMORY ENGINE] Successfully committed to Vault: ${memoryId}`);
    return NextResponse.json({ success: true, memoryId });

  } catch (error: any) {
    console.error("🚨 [MEMORY ENGINE] Failure:", error.message || error);
    return NextResponse.json({ error: "Failed to process memory" }, { status: 500 });
  }
}