// types/lxxi.ts — LXXI Brand Definitions

export type LXXIMode = 'prime' | 'spark';

export interface LXXIBrand {
  name: string;
  motto: string;
  version: string;
  modes: Record<LXXIMode, { label: string; route: string; description: string }>;
}

// --- Vault Item Types (Multi-Modal) ---

export type VaultItemType = 'image' | 'document' | 'math_problem';

export interface BaseVaultItem {
  id?: string;
  type: VaultItemType;
  createdAt?: number;
}

export interface ImageVaultItem extends BaseVaultItem {
  type: 'image';
  url: string;
  storageUrl?: string;
  prompt?: string;
  rationale?: string;
}

export interface DocumentVaultItem extends BaseVaultItem {
  type: 'document';
  title: string;
  content: string;
  language: string;
  description?: string;
}

export interface MathProblemItem extends BaseVaultItem {
  type: 'math_problem';
  problem: string;
  hint: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export type VaultItem = ImageVaultItem | DocumentVaultItem | MathProblemItem;

// --- Brand ---

export const LXXI: LXXIBrand = {
  name: 'LXXI',
  motto: 'Voice is for Vibe, Screen is for Substance',
  version: '1.0.0',
  modes: {
    prime: {
      label: 'Prime',
      route: '/',
      description: 'Neo-Classical Cyberpunk creation engine'
    },
    spark: {
      label: 'Spark',
      route: '/spark',
      description: 'AI-powered learning companion'
    }
  }
};
