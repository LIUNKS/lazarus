import * as fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatEvidence, sanitizeResult } from '../src/evidence.ts';
import type { ErrorResult, FailedResult, PassedResult, VerificationResult } from '../src/types.ts';

const BANNED = /100%|mathematical proof|mathematically proven|guaranteed/i;
const BANNED_SAMPLES = ['100%', 'Mathematical Proof', 'MATHEMATICALLY PROVEN', 'guaranteed', 'GuArAnTeEd'];

const passed = (totalRuns: number, seed: number): PassedResult => ({
  status: 'PASSED',
  totalRuns,
  seed,
  executionTimeMs: 12,
  evidence: '',
});

const failed = (totalRuns: number, seed: number): FailedResult => ({
  status: 'FAILED',
  totalRuns,
  seed,
  executionTimeMs: 12,
  evidence: '',
  counterexample: { input: '-1', legacyOutcome: 'returned: -2', modernOutcome: 'returned: -3', shrunk: true },
});

/** Text that mixes arbitrary characters with the phrases the Verifier must never repeat. */
const textWithClaims = fc
  .array(fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom(...BANNED_SAMPLES)), { maxLength: 6 })
  .map((parts) => parts.join(' '));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatEvidence', () => {
  it('R10.2 writes the exact PASSED sentence with a comma as thousands separator', () => {
    expect(formatEvidence(passed(1000, 42))).toBe(
      'Verified behavioral equivalence across 1,000 generated inputs (seed 42).',
    );
    expect(formatEvidence(passed(100, 7))).toBe(
      'Verified behavioral equivalence across 100 generated inputs (seed 7).',
    );
  });

  it('R10.3 writes the exact FAILED sentence', () => {
    expect(formatEvidence(failed(7, -5))).toBe(
      'Found a behavioral difference after 7 generated inputs (seed -5).',
    );
    expect(formatEvidence(failed(1000, 0))).toBe(
      'Found a behavioral difference after 1,000 generated inputs (seed 0).',
    );
  });

  it('R10.2 groups digits by three and prints the seed without grouping', () => {
    const cases: Array<[number, string]> = [
      [0, '0'],
      [1, '1'],
      [12, '12'],
      [999, '999'],
      [1000, '1,000'],
      [12345, '12,345'],
      [1234567, '1,234,567'],
    ];
    for (const [runs, text] of cases) {
      expect(formatEvidence(passed(runs, 1))).toContain(`across ${text} generated inputs`);
    }
    expect(formatEvidence(passed(1000, 2147483647))).toContain('(seed 2147483647)');
    expect(formatEvidence(passed(1000, -2147483648))).toContain('(seed -2147483648)');
  });

  it('R10.2 does not use a locale lookup', () => {
    const spy = vi.spyOn(Number.prototype, 'toLocaleString');
    const intl = vi.spyOn(Intl, 'NumberFormat');
    formatEvidence(passed(1234567, 1));
    formatEvidence(failed(1234567, 1));
    expect(spy).not.toHaveBeenCalled();
    expect(intl).not.toHaveBeenCalled();
  });

  it('R10.2 R10.3 R10.5 Property 8 (text part): matches the template and holds no banned phrase', () => {
    // Feature: 03-pbt-verifier, Property 8: Evidence text
    const passedTemplate = /^Verified behavioral equivalence across (\d{1,3}(?:,\d{3})*) generated inputs \(seed (-?\d+)\)\.$/;
    const failedTemplate = /^Found a behavioral difference after (\d{1,3}(?:,\d{3})*) generated inputs \(seed (-?\d+)\)\.$/;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2_000_000_000 }),
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.boolean(),
        (totalRuns, seed, isPassed) => {
          const result = isPassed ? passed(totalRuns, seed) : failed(totalRuns, seed);
          const text = formatEvidence(result);
          const match = (isPassed ? passedTemplate : failedTemplate).exec(text);
          expect(match).not.toBeNull();
          expect(Number((match as RegExpExecArray)[1].replaceAll(',', ''))).toBe(totalRuns);
          expect(Number((match as RegExpExecArray)[2])).toBe(seed);
          expect(BANNED.test(text)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('sanitizeResult', () => {
  it.each(BANNED_SAMPLES)('R10.5 replaces "%s" in a message with [redacted]', (phrase) => {
    const result: ErrorResult = {
      status: 'ERROR',
      code: 'INTERNAL_ERROR',
      message: `Error: this is ${phrase} for sure`,
      executionTimeMs: 3,
    };
    expect(sanitizeResult(result).message).toBe('Error: this is [redacted] for sure');
  });

  it('R10.5 cleans nested string fields and leaves numbers and booleans alone', () => {
    const result: FailedResult = {
      ...failed(5, 9),
      counterexample: {
        input: 'a 100% input',
        legacyOutcome: 'threw: Guaranteed',
        modernOutcome: 'returned: ok',
        shrunk: true,
      },
    };
    const clean = sanitizeResult(result);
    expect(clean.counterexample).toEqual({
      input: 'a [redacted] input',
      legacyOutcome: 'threw: [redacted]',
      modernOutcome: 'returned: ok',
      shrunk: true,
    });
    expect(clean.totalRuns).toBe(5);
    expect(clean.seed).toBe(9);
  });

  it('R10.5 returns a copy and leaves the original untouched', () => {
    const original: ErrorResult = {
      status: 'ERROR',
      code: 'LEGACY_LOAD_ERROR',
      message: '100% sure',
      executionTimeMs: 1,
    };
    const clean = sanitizeResult(original);
    expect(clean).not.toBe(original);
    expect(original.message).toBe('100% sure');
  });

  it('R10.5 Property 8 (sanitizing part): no string field holds a banned phrase, and the result stays JSON-safe', () => {
    // Feature: 03-pbt-verifier, Property 8: Evidence text
    fc.assert(
      fc.property(textWithClaims, textWithClaims, textWithClaims, (message, input, outcome) => {
        const results: VerificationResult[] = [
          { status: 'ERROR', code: 'TEST_CODE_ERROR', message, executionTimeMs: 1 },
          {
            ...failed(10, 1),
            counterexample: { input, legacyOutcome: outcome, modernOutcome: message, shrunk: false },
          },
        ];
        for (const result of results) {
          const clean = sanitizeResult(result);
          const text = JSON.stringify(clean);
          expect(BANNED.test(text)).toBe(false);
          expect(JSON.parse(text)).toEqual(clean);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('R10.4 keeps an evidence sentence unchanged, so it still equals formatEvidence', () => {
    // Feature: 03-pbt-verifier, Supporting check: sanitizing never alters the evidence text
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.boolean(),
        (totalRuns, seed, isPassed) => {
          const base = isPassed ? passed(totalRuns, seed) : failed(totalRuns, seed);
          const result = { ...base, evidence: formatEvidence(base) };
          expect(sanitizeResult(result).evidence).toBe(formatEvidence(result));
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R10.5 is idempotent', () => {
    fc.assert(
      fc.property(textWithClaims, (message) => {
        const result: ErrorResult = { status: 'ERROR', code: 'INTERNAL_ERROR', message, executionTimeMs: 1 };
        const once = sanitizeResult(result);
        expect(sanitizeResult(once)).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });
});
