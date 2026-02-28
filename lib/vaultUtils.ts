import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from './firebase';
import type { VaultItem } from '@/types/lxxi';

const vaultCollection = (userId: string, agentId: string) =>
  collection(db, `users/${userId}/agents/${agentId}/vault`);

/**
 * Persist a vault item to Firestore.
 * Returns the generated document ID.
 */
export async function saveVaultItem(
  userId: string,
  agentId: string,
  item: VaultItem
): Promise<string> {
  const docRef = await addDoc(vaultCollection(userId, agentId), {
    ...item,
    createdAt: Date.now(),
  });
  return docRef.id;
}

/**
 * Load persisted vault items from Firestore, ordered by creation time.
 * Returns oldest-first for chronological vault display.
 */
export async function loadVaultItems(
  userId: string,
  agentId: string,
  maxItems = 50
): Promise<VaultItem[]> {
  const q = query(
    vaultCollection(userId, agentId),
    orderBy('createdAt', 'desc'),
    limit(maxItems)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as VaultItem))
    .reverse();
}
