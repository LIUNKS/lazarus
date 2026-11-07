import type { CorpseStatus, SourceLanguage } from '@/lib/data/types';

export type StatusTone = 'curse' | 'neutral' | 'verified';

export interface StatusPresentation {
  label: string;
  tone: StatusTone;
}

/** Crimson marks INFECTED and FAILED, emerald marks RESURRECTED. The label is always shown, so color is never the only signal. */
export function statusPresentation(status: CorpseStatus): StatusPresentation {
  switch (status) {
    case 'INFECTED':
      return { label: 'Infected', tone: 'curse' };
    case 'FAILED':
      return { label: 'Failed', tone: 'curse' };
    case 'IN_SEANCE':
      return { label: 'In séance', tone: 'neutral' };
    case 'RESURRECTED':
      return { label: 'Resurrected', tone: 'verified' };
  }
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  curse: 'bg-curse text-curse-foreground',
  neutral: 'bg-secondary text-secondary-foreground',
  verified: 'bg-verified text-verified-foreground',
};

export function languageLabel(language: SourceLanguage): string {
  switch (language) {
    case 'es3':
      return 'ES3';
    case 'es5-jquery':
      return 'ES5 / jQuery';
    case 'legacy-node':
      return 'Legacy Node';
  }
}