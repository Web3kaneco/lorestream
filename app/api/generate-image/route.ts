import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { verifyAuthToken } from '@/lib/firebaseAdmin';

// Lazy-init Gemini client — avoids crash during Next.js build when env vars aren't set.
// Server-side routes use GEMINI_API_KEY only (never NEXT_PUBLIC_).
let _ai: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!_ai) {
    const key = process.env.GEMINI_API_KEY || '';
    if (!key) throw new Error('Gemini API key not configured');
    _ai = new GoogleGenAI({ apiKey: key });
  }
  return _ai;
}

// Image generation quality tiers (Imagen 4)
const IMAGE_MODELS = {
  ultra: 'imagen-4.0-ultra-generate-001',
  standard: 'imagen-4.0-generate-001',
  fast: 'imagen-4.0-fast-generate-001'
} as const;

// Gemini model for reference-image composition (image-to-image)
const GEMINI_IMAGE_MODEL = 'gemini-2.0-flash-preview-image-generation';

type ImageQuality = keyof typeof IMAGE_MODELS;
type ImageSize = '1K' | '2K';

// ── SSRF Protection: Only allow safe URL schemes and known domains ──
const ALLOWED_URL_PATTERNS = [
  /^data:image\//,                                          // data: URLs (base64)
  /^https:\/\/firebasestorage\.googleapis\.com\//,          // Firebase Storage
  /^https:\/\/lorestream-3325c\.firebasestorage\.app\//,    // Project storage
  /^https:\/\/storage\.googleapis\.com\//,                  // GCS
];

function isSafeUrl(url: string): boolean {
  return ALLOWED_URL_PATTERNS.some(pattern => pattern.test(url));
}

export async function POST(req: Request) {
  try {
    // ── Auth verification ──
    const authUser = await verifyAuthToken(req.headers.get('authorization'));
    if (!authUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { prompt, quality, size, referenceImageUrls } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    // Path A: Reference images present → Gemini generateContent with image output
    if (referenceImageUrls && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0) {
      // ── SSRF check: validate all reference URLs ──
      for (const url of referenceImageUrls) {
        if (!isSafeUrl(url)) {
          return NextResponse.json(
            { error: `Reference URL not allowed: only Firebase Storage and data: URLs are accepted` },
            { status: 400 }
          );
        }
      }
      return handleReferenceImageGeneration(prompt, referenceImageUrls);
    }

    // Path B: Standard Imagen 4 generation (existing behavior)
    return handleStandardImageGeneration(prompt, quality, size);

  } catch (error: any) {
    console.error("[IMAGE GEN] Error:", error.message || error);
    return NextResponse.json({ error: "Failed to generate artifact" }, { status: 500 });
  }
}

// --- Path B: Standard Imagen 4 generation ---
async function handleStandardImageGeneration(prompt: string, quality?: string, size?: string) {
  const selectedQuality: ImageQuality = quality && quality in IMAGE_MODELS ? quality as ImageQuality : 'ultra';
  const selectedSize: ImageSize = size === '1K' ? '1K' : '2K';
  const model = IMAGE_MODELS[selectedQuality];

  const response = await getAI().models.generateImages({
    model,
    prompt,
    config: {
      numberOfImages: 1,
      imageSize: selectedSize,
      aspectRatio: '16:9'
    }
  });

  if (!response.generatedImages || response.generatedImages.length === 0) {
    return NextResponse.json({ error: "No images generated" }, { status: 500 });
  }

  const generatedImage = response.generatedImages[0];
  if (!generatedImage?.image?.imageBytes) {
    return NextResponse.json({ error: "Image generation blocked or returned empty" }, { status: 500 });
  }

  const base64Data = generatedImage.image.imageBytes;
  const imageUrl = `data:image/png;base64,${base64Data}`;

  return NextResponse.json({ success: true, imageUrl });
}

// --- Path A: Reference image composition via Gemini ---
async function handleReferenceImageGeneration(prompt: string, referenceUrls: string[]) {
  // Convert each reference URL to an inlineData part (max 3 references)
  const imageParts = await Promise.all(
    referenceUrls.slice(0, 3).map(async (url: string) => {
      // For data: URLs, extract base64 directly
      if (url.startsWith('data:')) {
        const [header, data] = url.split(',');
        const mimeType = header.match(/data:(.*?);/)?.[1] || 'image/png';
        return { inlineData: { mimeType, data } };
      }
      // For allowed https URLs, fetch and convert to base64
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`Failed to fetch reference image: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      const mimeType = res.headers.get('content-type') || 'image/png';
      return { inlineData: { mimeType, data: base64 } };
    })
  );

  const response = await getAI().models.generateContent({
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
    return NextResponse.json({ error: "No image generated with references" }, { status: 500 });
  }

  const imageUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
  return NextResponse.json({ success: true, imageUrl });
}
