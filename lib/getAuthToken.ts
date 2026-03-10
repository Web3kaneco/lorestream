// ──────────────────────────────────────────────────────────────
// Client-side auth token helper
//
// Provides async helpers for getting Firebase ID tokens and
// building authenticated request headers for API calls.
// ──────────────────────────────────────────────────────────────

import { auth } from './firebase';

/**
 * Get the current user's Firebase ID token.
 * Returns null if user is not logged in.
 */
export async function getAuthToken(): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

/**
 * Build request headers with auth token (if available).
 * Always includes Content-Type: application/json.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
