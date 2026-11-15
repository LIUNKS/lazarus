import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatRunCount } from './format';
import {
  buildVerificationView,
  isValidRunCount,
  VERIFICATION_LABELS,
  verificationState,
  type VerificationState,
  type VerificationView,
} from './verification';
import { containsForbiddenTerm } from './wording';

const EVIDENCE_PREFIX = 'Verified behavioral equivalence across ';

const view = (pbtPassed: boolean | null, totalRuns: number | null, executionTimeMs: number | null = null) =>
  buildVerificationView({ pbtPassed, totalRuns, executionTimeMs });

const allStrings = (v: VerificationView): string[] => [v.headline, ...v.details];

/** The rule of Requirement 6 criterion 1, written independently of the implementation. */
function expectedState(pbtPassed: boolean | null, totalRuns: number | null): VerificationState {
  if (pbtPassed === null) return 'NOT_RUN';
  if (pbtPassed === false) return 'FAILED';
  // A valid count is a positive integer that is exact in a JavaScript number (the design adds the upper bound).
  const valid = totalRuns !== null && Number.isInteger(totalRuns) && totalRuns > 0 && totalRuns <= Number.MAX_SAFE_INTEGER;
  return valid ? 'VERIFIED' : 'INCOMPLETE';
}

describe('R6 verification state and evidence', () => {
  it('R6.1 R6.2 R6.3 R6.4 R6.5 R6.6 R6.7 R6.9 derives the state and the text from the stored columns', () => {
    // Feature: 06-resurrection-ui, Property 1: Verification and evidence
    const runs = fc.oneof(
      fc.integer({ min: -5, max: 5000 }),
      fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
      fc.constantFrom(null, 0, 1, 100, 1000, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53),
    );
    const duration = fc.oneof(fc.integer({ min: -5, max: 100000 }), fc.constantFrom(null, 0, 2.5, Number.NaN));
    fc.assert(
      fc.property(
        fc.constantFrom<boolean | null>(true, false, null),
        runs,
        duration,
        fc.boolean(),
        (pbtPassed, totalRuns, executionTimeMs, verifyAvailable) => {
          const result = buildVerificationView({ pbtPassed, totalRuns, executionTimeMs }, { verifyAvailable });
          const state = expectedState(pbtPassed, totalRuns);
          const strings = allStrings(result);
          const evidenceShown = strings.some((text) => text.includes(EVIDENCE_PREFIX));
          if (result.state !== state || verificationState({ pbtPassed, totalRuns }) !== state) return false;
          // The Evidence_Text appears if and only if the state is VERIFIED, and only the verified token is used there.
          if (evidenceShown !== (state === 'VERIFIED')) return false;
          if ((result.tone === 'verified') !== (state === 'VERIFIED')) return false;
          if (strings.some(containsForbiddenTerm)) return false;
          if (state === 'VERIFIED' && totalRuns !== null) {
            const formatted = formatRunCount(totalRuns);
            const exact = `${EVIDENCE_PREFIX}${formatted} generated inputs.`;
            if (result.headline !== exact || formatted.replaceAll(',', '') !== String(totalRuns) || result.runCount !== totalRuns) return false;
          }
          // A run count is reported only when it is a valid one and part of the text shown.
          if (result.runCount !== null && !isValidRunCount(result.runCount)) return false;
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('R6.2 R16.3 states the exact run count with a comma as the thousands separator', () => {
    expect(view(true, 1000).headline).toBe('Verified behavioral equivalence across 1,000 generated inputs.');
    expect(view(true, 100).headline).toBe('Verified behavioral equivalence across 100 generated inputs.');
    expect(view(true, 1234567).headline).toBe('Verified behavioral equivalence across 1,234,567 generated inputs.');
  });

  it('R6.2 R6.3 VERIFIED shows the evidence in the verified tone, the empirical note, and the duration', () => {
    expect(view(true, 1000, 842)).toEqual({
      state: 'VERIFIED',
      tone: 'verified',
      headline: 'Verified behavioral equivalence across 1,000 generated inputs.',
      details: ['This is empirical evidence from randomly generated inputs. Other inputs were not checked.', 'Completed in 842 ms.'],
      runCount: 1000,
    });
  });

  it.each([
    ['a missing duration', null],
    ['a negative duration', -1],
    ['a fractional duration', 12.5],
  ])('R6.3 leaves out the duration sentence for %s', (_label, ms) => {
    expect(view(true, 1000, ms).details).toEqual([
      'This is empirical evidence from randomly generated inputs. Other inputs were not checked.',
    ]);
  });

  it('R6.3 shows a zero duration', () => {
    expect(view(true, 1000, 0).details).toContain('Completed in 0 ms.');
  });

  it('R6.4 FAILED shows the difference in the curse tone and the run count when it is valid', () => {
    expect(view(false, 37)).toEqual({
      state: 'FAILED',
      tone: 'curse',
      headline: 'The modern function differed from the legacy function.',
      details: ['The check stopped after 37 generated inputs.'],
      runCount: 37,
    });
    expect(view(false, 1500).details).toEqual(['The check stopped after 1,500 generated inputs.']);
  });

  it.each([null, 0, -4, 2.5])('R6.4 FAILED with the run count %s adds no run sentence', (runs) => {
    const result = view(false, runs);
    expect(result.details).toEqual([]);
    expect(result.runCount).toBeNull();
  });

  it('R6.5 NOT_RUN shows "Not verified yet." with the stored-result sentence in the neutral tone', () => {
    expect(view(null, null)).toEqual({
      state: 'NOT_RUN',
      tone: 'neutral',
      headline: 'Not verified yet.',
      details: ['No property-based test result is stored for this module.'],
      runCount: null,
    });
  });

  it('R6.5 NOT_RUN leaves out that sentence when the Verify_Control is shown right below', () => {
    const result = buildVerificationView({ pbtPassed: null, totalRuns: null, executionTimeMs: null }, { verifyAvailable: true });
    expect(result.headline).toBe('Not verified yet.');
    expect(result.details).toEqual([]);
    expect(result.tone).toBe('neutral');
  });

  it('R6.5 only NOT_RUN reads the verifyAvailable option', () => {
    for (const [passed, runs] of [[true, 1000], [false, 12], [true, null]] as const) {
      const base = { pbtPassed: passed, totalRuns: runs, executionTimeMs: 5 };
      expect(buildVerificationView(base, { verifyAvailable: true })).toEqual(buildVerificationView(base, { verifyAvailable: false }));
    }
  });

  it.each([
    ['no run count', null],
    ['a zero run count', 0],
    ['a negative run count', -3],
    ['a fractional run count', 99.5],
  ])('R6.6 a passing result with %s is INCOMPLETE and shows no evidence', (_label, runs) => {
    expect(view(true, runs, 50)).toEqual({
      state: 'INCOMPLETE',
      tone: 'neutral',
      headline: 'A passing result is stored without a run count, so no evidence is shown.',
      details: [],
      runCount: null,
    });
  });

  it('R1.4 labels each state in words for the overview', () => {
    expect(VERIFICATION_LABELS).toEqual({
      VERIFIED: 'Verified',
      FAILED: 'Failed',
      NOT_RUN: 'Not verified yet',
      INCOMPLETE: 'Incomplete',
    });
  });
});
