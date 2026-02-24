import { NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Pinecone outside the handler
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY || '' });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { agentId, userId, transcript, speaker } = body;

    if (!transcript) {
      return NextResponse.json({ error: "Missing transcript" }, { status: 400 });
    }

    const apiKey = process.env.NEXT_PUBLIC_GEMINI_KEY;
    if (!apiKey) throw new Error("Missing Gemini API Key in .env.local");

    // 1. Raw fetch to Google's NEW gemini-embedding-001 model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        // 🚀 COMPRESSION: Force Google to shrink the 3,072-dim vector to 768-dim for Pinecone!
        output_dimensionality: 768, 
        content: { parts: [{ text: transcript }] }
      })
    });

    const data = await res.json();
    
    // Catch Google API errors (like quota limits or bad keys)
    if (data.error) {
        throw new Error(`Google API Error: ${data.error.message}`);
    }

    const vector = data.embedding?.values;
    if (!vector) {
        throw new Error("No embedding values returned from Google");
    }

    // 2. Target your Pinecone Vault
    const index = pc.Index('agent-memory');
    const memoryId = `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // 3. Save to Pinecone (Forcing everything to a String prevents random crashes)
    await index.upsert([{
      id: memoryId,
      values: vector,
      metadata: {
        agentId: String(agentId || 'unknown_agent'),
        userId: String(userId || 'unknown_user'),
        speaker: String(speaker || 'unknown_speaker'),
        text: String(transcript),
        timestamp: Date.now()
      }
    }]);

    console.log(`💾 [MEMORY] Vault Saved: "${transcript.substring(0, 30)}..."`);
    return NextResponse.json({ success: true, memoryId });

  } catch (error: any) {
    // 🚨 This will print the EXACT reason it failed in your VS Code terminal!
    console.error("🚨 [MEMORY API ERROR]:", error.message || error);
    return NextResponse.json({ error: error.message || "Failed to process memory" }, { status: 500 });
  }
}