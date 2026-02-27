// types/lxxi.ts — LXXI Brand Definitions

export type LXXIMode = 'prime' | 'spark';

export interface LXXIBrand {
  name: string;
  motto: string;
  version: string;
  modes: Record<LXXIMode, { label: string; route: string; description: string }>;
}

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
