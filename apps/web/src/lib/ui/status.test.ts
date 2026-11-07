import { describe, expect, it } from 'vitest';
import { CORPSE_STATUSES, SOURCE_LANGUAGES } from '@/lib/data/types';
import { languageLabel, statusPresentation, TONE_CLASSES } from './status';

describe('R9 status presentation', () => {
  it.each([
    ['INFECTED', 'Infected', 'curse'],
    ['FAILED', 'Failed', 'curse'],
    ['IN_SEANCE', 'In séance', 'neutral'],
    ['RESURRECTED', 'Resurrected', 'verified'],
  ] as const)('maps %s', (status, label, tone) => {
    expect(statusPresentation(status)).toEqual({ label, tone });
  });

  it('is total: every status has a label, and only the specified tones use the curse and verified colors', () => {
    for (const status of CORPSE_STATUSES) {
      const presentation = statusPresentation(status);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(presentation.tone === 'curse').toBe(status === 'INFECTED' || status === 'FAILED');
      expect(presentation.tone === 'verified').toBe(status === 'RESURRECTED');
      expect(TONE_CLASSES[presentation.tone].length).toBeGreaterThan(0);
    }
  });

  it('labels every language', () => {
    for (const language of SOURCE_LANGUAGES) expect(languageLabel(language).length).toBeGreaterThan(0);
  });
});