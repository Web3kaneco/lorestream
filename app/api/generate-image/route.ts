import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the same Google SDK we use for the memory and voice!
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_KEY });

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    console.log(`🎨 [TOOL ENGINE] Asking Gemini to generate: "${prompt}"`);

    // 🚀 Calling Google's native image generation model
    const response = await ai.models.generateImages({
        model: 'nano-banana', // Google's state-of-the-art image and composition model
        prompt: prompt,
        config: {
            numberOfImages: 1,
            outputMimeType: "image/jpeg"
        }
    });

    // The SDK returns the raw base64 string of the image
    const base64Data = response.generatedImages[0].image.imageBytes;
    const imageUrl = `data:image/jpeg;base64,${base64Data}`;

    console.log(`✅ [TOOL ENGINE] Image generated successfully natively through Google!`);

    return NextResponse.json({ success: true, imageUrl });

  } catch (error: any) {
    console.error("🚨 [TOOL ENGINE] Critical Failure:", error.message || error);
    return NextResponse.json({ error: "Failed to generate artifact" }, { status: 500 });
  }
}