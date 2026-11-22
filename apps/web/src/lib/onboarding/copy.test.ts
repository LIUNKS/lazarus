import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from '@/lib/import/limits';
import { LIMITS } from '@/lib/pipeline/limits';
import { containsForbiddenTerm } from '@/lib/stages/wording';
import { VERIFICATION_LIMITS } from '@/lib/verification/limits';
import { capabilities, FIRST_STEPS, IMPORT_SIZE_LABEL, MODEL_SOURCE_LABEL, STAGES, TRUST_LINE, usageNote, type LiveFlags } from './copy';

const SRC = path.resolve(import.meta.dirname, '../..');
const ALL_FLAGS: LiveFlags[] = [
  { ownCode: false, samples: false },
  { ownCode: false, samples: true },
  { ownCode: true, samples: false },
  { ownCode: true, samples: true },
];
const textOf = (items: { lead: string; text: string }[]) => items.map((item) => `${item.lead} ${item.text}`).join('\n');

describe('R1 facts come from the code', () => {
  it('R1.1 R1.2 states the import limit and the separate source limit of the model stages', () => {
    expect(IMPORT_SIZE_LABEL).toBe(`${IMPORT_LIMITS.maxBytes / 1024} KB`);
    expect(IMPORT_SIZE_LABEL).toBe('100 KB');
    expect(MODEL_SOURCE_LABEL).toBe('20,000 bytes');
    const text = textOf(capabilities(ALL_FLAGS[0]!));
    expect(text).toContain(`up to ${IMPORT_SIZE_LABEL} per file`);
    expect(text).toContain(`up to ${MODEL_SOURCE_LABEL}`);
    expect(text).toContain(`up to ${IMPORT_LIMITS.maxCorpses} corpses`);
  });

  it('R1.1 keeps the limit numbers out of the source as literals', () => {
    const source = readFileSync(path.join(SRC, 'lib', 'onboarding', 'copy.ts'), 'utf8');
    for (const literal of ['100 KB', '20,000', '1,000', '102400', '102_400', ' 20 ', ' 10 ']) expect(source, literal).not.toContain(literal);
  });

  it('R1.3 lists live verification only while a flag is on, for the own code first', () => {
    const verify = (flags: LiveFlags) => capabilities(flags).find((item) => item.lead === 'Verify')?.text ?? null;
    expect(verify({ ownCode: false, samples: false })).toBeNull();
    expect(verify({ ownCode: false, samples: true })).toContain('the sample corpses live');
    expect(verify({ ownCode: true, samples: false })).toContain('your reincarnation live');
    expect(verify({ ownCode: true, samples: true })).toContain('your reincarnation live');
    expect(verify({ ownCode: true, samples: true })).toContain('across 1,000 generated inputs');
  });

  it('R1.4 states the generation limit always and the verification limit only while a flag is on, both per hour', () => {
    expect(LIMITS.userQuota.windowSeconds).toBe(3_600);
    expect(VERIFICATION_LIMITS.userQuota.windowSeconds).toBe(3_600);
    for (const flags of ALL_FLAGS) {
      const note = usageNote(flags);
      expect(note).toContain(`up to ${LIMITS.userQuota.limit} new Séance or Reincarnation generations`);
      expect(note).toContain('per hour');
      expect(note.includes(`${VERIFICATION_LIMITS.userQuota.limit} live verifications`)).toBe(flags.ownCode || flags.samples);
    }
  });

  it('R1.5 says what GitHub shares, and the sign-in call requests no extra scope', () => {
    expect(TRUST_LINE).toContain('public profile and email address');
    expect(TRUST_LINE).toContain('no access to your repositories');
    const action = readFileSync(path.join(SRC, 'app', 'sign-in', 'actions.ts'), 'utf8');
    expect(action).toContain("provider: 'github'");
    expect(action).not.toMatch(/scopes\s*:/);
  });

  it('R1.6 contains no Forbidden_Term in any text', () => {
    const texts = [
      ...ALL_FLAGS.flatMap((flags) => [textOf(capabilities(flags)), usageNote(flags)]),
      TRUST_LINE,
      textOf([...STAGES]),
      ...FIRST_STEPS,
    ];
    for (const text of texts) expect(containsForbiddenTerm(text), text).toBe(false);
  });
});
