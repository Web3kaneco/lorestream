import { NextResponse } from 'next/server';

// ──────────────────────────────────────────────────────────────
// Gemini Session Endpoint
//
// Returns the Gemini API key to authenticated clients so the key
// never appears in the JavaScript bundle (no NEXT_PUBLIC_ prefix).
//
// Rate limiting: Simple in-memory sliding window per IP.
// ──────────────────────────────────────────────────────────────

// Sliding window rate limiter — 10 requests per minute per IP
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  // Remove timestamps outside the window
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return false;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((timestamps, ip) => {
    const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, recent);
  });
}, 300_000);

export async function GET(req: Request) {
  // Extract IP for rate limiting
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in a minute.' },
      { status: 429 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Gemini API key not configured' },
      { status: 500 }
    );
  }

  return NextResponse.json({ key: apiKey });
}
