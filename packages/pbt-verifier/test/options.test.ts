import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  checkOrigin,
  normalizeEquivalenceOptions,
  normalizeTestCodeOptions,
  type OptionsResult,
} from '../src/options.ts';

const baseEquivalence = {
  origin: 'sample',
  legacyCode: 'function f(x) { return x; }',
  modernCode: 'export function f(x: number): number { return x; }',
  entryFunction: 'f',
  inputArbitrary: fc.integer(),
};

const baseTestCode = {
  origin: 'sample',
  legacyCode: 'function f(x) { return x; }',
  modernCode: 'export function f(x: number): number { return x; }',
  entryFunction: 'f',
  testCode: 'return fc.property(fc.integer(), (n) => assertEquivalent(n));',
};

/** Copy of `value` without the property `key`. */
function omit(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function failureOf<T>(result: OptionsResult<T>): { code: string; message: string } {
  if (result.ok) throw new Error('Expected the options to be rejected.');
  return { code: result.code, message: result.message };
}

describe('origin guard', () => {
  it('R3.3 rejects a missing origin with INVALID_OPTIONS', () => {
    const withoutOrigin = omit(baseEquivalence, 'origin');
    expect(failureOf(normalizeEquivalenceOptions(withoutOrigin)).code).toBe('INVALID_OPTIONS');
    expect(failureOf(normalizeTestCodeOptions({ ...baseTestCode, origin: undefined })).code).toBe(
      'INVALID_OPTIONS',
    );
  });

  it('R3.3 rejects an origin that is neither "sample" nor "user"', () => {
    for (const origin of ['SAMPLE', 'admin', '', 1, null, true, {}, []]) {
      expect(failureOf(normalizeEquivalenceOptions({ ...baseEquivalence, origin })).code).toBe(
        'INVALID_OPTIONS',
      );
    }
  });

  it('R3.3 rejects options that are not an object', () => {
    for (const raw of [undefined, null, 42, 'sample', true]) {
      expect(failureOf(normalizeEquivalenceOptions(raw)).code).toBe('INVALID_OPTIONS');
      expect(failureOf(normalizeTestCodeOptions(raw)).code).toBe('INVALID_OPTIONS');
    }
  });

  it('R3.2 rejects origin "user" with UNSUPPORTED_ORIGIN', () => {
    expect(failureOf(normalizeEquivalenceOptions({ ...baseEquivalence, origin: 'user' })).code).toBe(
      'UNSUPPORTED_ORIGIN',
    );
    expect(failureOf(normalizeTestCodeOptions({ ...baseTestCode, origin: 'user' })).code).toBe(
      'UNSUPPORTED_ORIGIN',
    );
  });

  it('R12.4 checks the origin before any other field', () => {
    // Every other field is invalid, so a later check would report INVALID_OPTIONS.
    const rest = { legacyCode: 1, modernCode: null, entryFunction: 'class', numRuns: -5 };
    expect(failureOf(normalizeEquivalenceOptions({ origin: 'user', ...rest })).code).toBe(
      'UNSUPPORTED_ORIGIN',
    );
    expect(checkOrigin({ origin: 'sample', ...rest })).toBeNull();
  });

  it('R3.2 Property 6 (options part): origin "user" always yields UNSUPPORTED_ORIGIN', () => {
    // Feature: 03-pbt-verifier, Property 6: Guard (options part)
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.anything()),
        fc.anything(),
        (others, legacyCode) => {
          const raw = { ...others, legacyCode, origin: 'user' };
          expect(failureOf(normalizeEquivalenceOptions(raw)).code).toBe('UNSUPPORTED_ORIGIN');
          expect(failureOf(normalizeTestCodeOptions(raw)).code).toBe('UNSUPPORTED_ORIGIN');
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('defaults', () => {
  it('R7.2 R7.5 applies the documented defaults when optional fields are absent', () => {
    const result = normalizeEquivalenceOptions(baseEquivalence);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.numRuns).toBe(1000);
    expect(result.value.callTimeoutMs).toBe(1000);
    expect(result.value.totalTimeoutMs).toBe(60_000);
    expect(result.value.origin).toBe('sample');
  });

  it('R7.4 generates a 32-bit signed integer seed when none is given', () => {
    const result = normalizeTestCodeOptions(baseTestCode);
    if (!result.ok) throw new Error(result.message);
    expect(Number.isInteger(result.value.seed)).toBe(true);
    expect(result.value.seed).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(result.value.seed).toBeLessThanOrEqual(2 ** 31 - 1);
  });

  it('R7.2 R7.4 keeps explicit values, including the range limits', () => {
    const result = normalizeEquivalenceOptions({
      ...baseEquivalence,
      numRuns: 100,
      seed: -(2 ** 31),
      callTimeoutMs: 60_000,
      totalTimeoutMs: 600_000,
    });
    if (!result.ok) throw new Error(result.message);
    expect(result.value).toMatchObject({
      numRuns: 100,
      seed: -(2 ** 31),
      callTimeoutMs: 60_000,
      totalTimeoutMs: 600_000,
    });
    const upper = normalizeEquivalenceOptions({ ...baseEquivalence, numRuns: 1000, seed: 2 ** 31 - 1 });
    expect(upper.ok).toBe(true);
  });
});

describe('field validation', () => {
  it.each([
    ['legacyCode is not a string', { legacyCode: 42 }],
    ['modernCode is not a string', { modernCode: undefined }],
    ['entryFunction is not a string', { entryFunction: 7 }],
    ['entryFunction is empty', { entryFunction: '' }],
    ['entryFunction starts with a digit', { entryFunction: '1abc' }],
    ['entryFunction has a space', { entryFunction: 'a b' }],
    ['entryFunction is a call expression', { entryFunction: 'f()' }],
    ['entryFunction is a reserved word', { entryFunction: 'class' }],
    ['entryFunction is "function"', { entryFunction: 'function' }],
    ['numRuns below 100', { numRuns: 99 }],
    ['numRuns above 1000', { numRuns: 1001 }],
    ['numRuns not an integer', { numRuns: 150.5 }],
    ['numRuns is a string', { numRuns: '200' }],
    ['numRuns is NaN', { numRuns: Number.NaN }],
    ['numRuns is null', { numRuns: null }],
    ['seed not an integer', { seed: 1.5 }],
    ['seed above 32 bits', { seed: 2 ** 31 }],
    ['seed below 32 bits', { seed: -(2 ** 31) - 1 }],
    ['seed is Infinity', { seed: Number.POSITIVE_INFINITY }],
    ['callTimeoutMs is 0', { callTimeoutMs: 0 }],
    ['callTimeoutMs above 60000', { callTimeoutMs: 60_001 }],
    ['totalTimeoutMs is 0', { totalTimeoutMs: 0 }],
    ['totalTimeoutMs above 600000', { totalTimeoutMs: 600_001 }],
  ])('R7.3 R7.5 R4.4 rejects when %s', (_name, override) => {
    const result = normalizeEquivalenceOptions({ ...baseEquivalence, ...override });
    expect(failureOf(result).code).toBe('INVALID_OPTIONS');
    expect(failureOf(result).message.length).toBeGreaterThan(0);
    expect(failureOf(normalizeTestCodeOptions({ ...baseTestCode, ...override })).code).toBe(
      'INVALID_OPTIONS',
    );
  });

  it('R7.1 requires inputArbitrary in the programmatic mode', () => {
    const withoutArbitrary = omit(baseEquivalence, 'inputArbitrary');
    expect(failureOf(normalizeEquivalenceOptions(withoutArbitrary)).code).toBe('INVALID_OPTIONS');
    expect(
      failureOf(normalizeEquivalenceOptions({ ...baseEquivalence, inputArbitrary: 'integer' })).code,
    ).toBe('INVALID_OPTIONS');
  });

  it('R8.1 requires testCode to be a string in the stored-test mode', () => {
    expect(failureOf(normalizeTestCodeOptions({ ...baseTestCode, testCode: 5 })).code).toBe(
      'INVALID_OPTIONS',
    );
    const withoutTestCode = omit(baseTestCode, 'testCode');
    expect(failureOf(normalizeTestCodeOptions(withoutTestCode)).code).toBe('INVALID_OPTIONS');
  });

  it('R4.4 accepts identifiers with $ and _ and rejects only reserved words', () => {
    for (const entryFunction of ['f', '_f', '$f', 'calc$1', 'parseQueryString', 'of', 'get']) {
      expect(normalizeEquivalenceOptions({ ...baseEquivalence, entryFunction }).ok).toBe(true);
    }
  });

  it('R2.8 never throws for arbitrary option values', () => {
    // Feature: 03-pbt-verifier, Supporting check: options validation never throws
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        expect(() => normalizeEquivalenceOptions(raw)).not.toThrow();
        expect(() => normalizeTestCodeOptions(raw)).not.toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
