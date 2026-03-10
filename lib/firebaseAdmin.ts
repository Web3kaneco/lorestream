// ──────────────────────────────────────────────────────────────
// Firebase Admin SDK — Server-side only (API routes)
//
// Used for verifying Firebase ID tokens on API requests.
// Credentials are loaded from environment variables:
//   - FIREBASE_PRIVATE_KEY (service account private key)
//   - FIREBASE_CLIENT_EMAIL (service account email)
//   - NEXT_PUBLIC_FIREBASE_PROJECT_ID (project ID)
//
// In GCP/Firebase environments, Application Default Credentials
// are used automatically when service account vars aren't set.
// ──────────────────────────────────────────────────────────────

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

let _adminApp: App | null = null;

function getAdminApp(): App {
  if (_adminApp) return _adminApp;
  if (getApps().length > 0) {
    _adminApp = getApps()[0];
    return _adminApp;
  }

  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (privateKey && clientEmail && projectId) {
    _adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  } else {
    // Fall back to Application Default Credentials (GCP environments)
    // or initialize with just projectId for basic verification
    _adminApp = initializeApp({ projectId: projectId || undefined });
  }

  return _adminApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

/**
 * Verify a Firebase ID token from an Authorization header.
 * Returns the decoded token (with uid, email, etc.) or null if invalid.
 *
 * @param authHeader - The Authorization header value (e.g. "Bearer <token>")
 */
export async function verifyAuthToken(authHeader: string | null): Promise<{
  uid: string;
  email?: string;
} | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7); // Strip "Bearer "
  if (!token) return null;

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch (err: any) {
    // Don't log full error in production — just the message
    console.warn('[AUTH] Token verification failed:', err.code || err.message);
    return null;
  }
}
