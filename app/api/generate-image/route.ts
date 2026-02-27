import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the same Google SDK we use for memory and voice
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_KEY });

// Image generation quality tiers
const IMAGE_MODELS = {
  ultra: 'imagen-4.0-ultra-generate-001',   // Highest quality
  standard: 'imagen-4.0-generate-001',       // Good balance
  fast: 'imagen-4.0-fast-generate-001'       // Fastest, lower quality
} as const;

type ImageQuality = keyof typeof IMAGE_MODELS;
type ImageSize = '1K' | '2K';

export async function POST(req: Request) {
  try {
    const { prompt, quality, size } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    // Default to ultra quality, 2K resolution for best output
    const selectedQuality: ImageQuality = quality && quality in IMAGE_MODELS ? quality : 'ultra';
    const selectedSize: ImageSize = size === '1K' ? '1K' : '2K';
    const model = IMAGE_MODELS[selectedQuality];

    console.log(`🎨 [TOOL ENGINE] Generating with ${model} at ${selectedSize}: "${prompt.substring(0, 80)}..."`);

    const response = await ai.models.generateImages({
      model,
      prompt,
      config: {
        numberOfImages: 1,
        imageSize: selectedSize,
        aspectRatio: '16:9'
      }
    });

    if (!response.generatedImages || response.generatedImages.length === 0) {
      console.error("🚨 [TOOL ENGINE] No images returned from API");
      return NextResponse.json({ error: "No images generated" }, { status: 500 });
    }

    const base64Data = response.generatedImages[0].image.imageBytes;
    const imageUrl = `data:image/png;base64,${base64Data}`;

    console.log(`✅ [TOOL ENGINE] Image generated successfully via ${selectedQuality} (${selectedSize})`);

    return NextResponse.json({ success: true, imageUrl });

  } catch (error: any) {
    console.error("🚨 [TOOL ENGINE] Critical Failure:", error.message || error);
    return NextResponse.json({ error: "Failed to generate artifact" }, { status: 500 });
  }
}