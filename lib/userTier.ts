// ──────────────────────────────────────────────────────────────
// User Tier System — Three-tier access control
//
// DEMO (no login):          5 exchanges, 1 image, no memory/forge/SOULS
// AUTHENTICATED (any Google): 25 exchanges, 5 images, memory, 1 forge char, SOULS
// ADMIN (whitelist):         Everything unlimited
// ──────────────────────────────────────────────────────────────

import { isAdminUser } from './adminWhitelist';

export type UserTier = 'demo' | 'authenticated' | 'admin';

export interface TierLimits {
  exchangeLimit: number;       // voice exchanges per session (0 = unlimited)
  imageGenLimit: number;       // image generations per session (0 = unlimited)
  memoryIngestion: boolean;    // can ingest files to Pinecone
  forgeLimit: number;          // max characters created (0 = unlimited)
  soulsLibrary: boolean;       // access to SOULS library
  pineconeMemory: boolean;     // save/load Pinecone conversation history
}

export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  demo: {
    exchangeLimit: 5,
    imageGenLimit: 1,
    memoryIngestion: false,
    forgeLimit: 0,         // no Forge access at all
    soulsLibrary: false,
    pineconeMemory: false,
  },
  authenticated: {
    exchangeLimit: 25,
    imageGenLimit: 5,
    memoryIngestion: true,
    forgeLimit: 1,
    soulsLibrary: true,
    pineconeMemory: true,
  },
  admin: {
    exchangeLimit: 0,      // 0 = unlimited
    imageGenLimit: 0,
    memoryIngestion: true,
    forgeLimit: 0,
    soulsLibrary: true,
    pineconeMemory: true,
  },
};

/** Determine user tier from auth state */
export function getUserTier(email: string | null | undefined, isLoggedIn: boolean): UserTier {
  if (isAdminUser(email)) return 'admin';
  if (isLoggedIn) return 'authenticated';
  return 'demo';
}

/** Get limits config for a tier */
export function getTierLimits(tier: UserTier): TierLimits {
  return TIER_LIMITS[tier];
}

/** Check if a numeric limit allows another action (0 = unlimited) */
export function isWithinLimit(currentCount: number, limit: number): boolean {
  if (limit === 0) return true; // unlimited
  return currentCount < limit;
}
