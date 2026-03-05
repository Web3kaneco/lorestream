import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Initialize the Google GenAI SDK
const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_KEY });

// Image generation quality tiers (Imagen 4)
const IMAGE_MODELS = {
  ultra: 'imagen-4.0-ultra-generate-001',   // Highest quality
  standard: 'imagen-4.0-generate-001',       // Good balance
  fast: 'imagen-4.0-fast-generate-001'       // Fastest, lower quality
} as const;

// Gemini model for reference-image composition (image-to-image)
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

type ImageQuality = keyof typeof IMAGE_MODELS;
type ImageSize = '1K' | '2K';

export async function POST(req: Request) {
  try {
    const { prompt, quality, size, referenceImageUrls } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    // Path A: Reference images present → Gemini generateContent with image output
    if (referenceImageUrls && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
      return handleReferenceImageGeneration(prompt, referenceImageUrls);
    }

    // Path B: Standard Imagen 4 generation (existing behavior)
    return handleStandardImageGeneration(prompt, quality, size);

  } catch (error: any) {
    console.error("[TOOL ENGINE] Critical Failure:", error.message || error);
    return NextResponse.json({ error: "Failed to generate artifact" }, { status: 500 });
  }
}

// --- Path B: Standard Imagen 4 generation ---
async function handleStandardImageGeneration(prompt: string, quality?: string, size?: string) {
  const selectedQuality: ImageQuality = quality && quality in IMAGE_MODELS ? quality as ImageQuality : 'ultra';
  const selectedSize: ImageSize = size === '1K' ? '1K' : '2K';
  const model = IMAGE_MODELS[selectedQuality];

  console.log(`[TOOL ENGINE] Generating with ${model} at ${selectedSize}: "${prompt.substring(0, 80)}..."`);

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
    console.error("[TOOL ENGINE] No images returned from Imagen API");
    return NextResponse.json({ error: "No images generated" }, { status: 500 });
  }

  const generatedImage = response.generatedImages[0];
  if (!generatedImage?.image?.imageBytes) {
    console.error("[TOOL ENGINE] Image entry returned but no imageBytes (possible content policy block)");
    return NextResponse.json({ error: "Image generation blocked or returned empty" }, { status: 500 });
  }

  const base64Data = generatedImage.image.imageBytes;
  const imageUrl = `data:image/png;base64,${base64Data}`;

  console.log(`[TOOL ENGINE] Image generated successfully via ${selectedQuality} (${selectedSize})`);
  return NextResponse.json({ success: true, imageUrl });
}

// --- Path A: Reference image composition via Gemini ---
async function handleReferenceImageGeneration(prompt: string, referenceUrls: string[]) {
  console.log(`[TOOL ENGINE] Generating with ${GEMINI_IMAGE_MODEL} using ${referenceUrls.length} reference(s): "${prompt.substring(0, 80)}..."`);

  // Convert each reference URL to an inlineData part (max 3 references)
  const imageParts = await Promise.all(
    referenceUrls.slice(0, 3).map(async (url: string) => {
      // For data: URLs, extract base64 directly
      if (url.startsWith('data:')) {
        const [header, data] = url.split(',');
        const mimeType = header.match(/data:(.*?);/)?.[1] || 'image/png';
        return { inlineData: { mimeType, data } };
      }
      // For http(s) URLs, fetch and convert to base64
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Failed to fetch reference image: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = res.headers.get('content-type') || 'image/png';
      return { inlineData: { mimeType, data: base64 } };
    })
  );

  const response = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: [{
      role: 'user',
      parts: [
        ...imageParts,
        { text: `Using these reference images as creative inspiration and source material, generate a new image: ${prompt}` }
      ]
    }],
    config: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  });

  // Extract the image from the response
  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));

  if (!imagePart || !imagePart.inlineData) {
    console.error("[TOOL ENGINE] No image returned from Gemini reference generation");
    return NextResponse.json({ error: "No image generated with references" }, { status: 500 });
  }

  const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  console.log(`[TOOL ENGINE] Reference image generated successfully via ${GEMINI_IMAGE_MODEL}`);
  return NextResponse.json({ success: true, imageUrl });
}
