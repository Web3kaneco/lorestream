// lib/anonymousId.ts
// Generates a persistent anonymous user ID stored in localStorage.
// Returning anonymous users keep the same ID across sessions,
// so their Pinecone memories and Firestore vault items persist.

const STORAGE_KEY = 'lxxi_anonymous_uid';

export function getOrCreateAnonymousId(): string {
  if (typeof window === 'undefined') return 'ssr_fallback';

  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = `anon_${crypto.randomUUID()}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}
