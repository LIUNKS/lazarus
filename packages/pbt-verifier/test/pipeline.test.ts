import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.ts';
import {
  formatEvidence,
  verifyEquivalence,
  verifyTestCode,
  type ErrorCode,
  type VerificationResult,
  type VerifyEquivalenceOptions,
  type VerifyTestCodeOptions,
} from '../src/index.ts';

const ERROR_CODES: ErrorCode[] = [
  'INVALID_OPTIONS',
  'UNSUPPORTED_ORIGIN',
  'LEGACY_LOAD_ERROR',
  'ENTRY_FUNCTION_NOT_FOUND',
  'MODERN_COMPILE_ERROR',
  'MODERN_LOAD_ERROR',
  'TEST_CODE_ERROR',
  'CALL_TIMEOUT',
  'TOTAL_TIMEOUT',
  'INTERNAL_ERROR',
];

const BANNED = /100%|mathematical proof|mathematically proven|guaranteed/i;
const ADD_LEGACY = 'function f(n) { return n + 1; }';
const ADD_MODERN = 'export function f(n: number): number { return n + 1; }';
const GOOD_TEST_CODE = 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });';

const baseEquivalence = (): VerifyEquivalenceOptions => ({
  origin: 'sample',
  legacyCode: ADD_LEGACY,
  modernCode: ADD_MODERN,
  entryFunction: 'f',
  inputArbitrary: fc.integer(),
  numRuns: 100,
  seed: 1,
});

const baseTestCode = (): VerifyTestCodeOptions => ({
  origin: 'sample',
  legacyCode: ADD_LEGACY,
  modernCode: ADD_MODERN,
  entryFunction: 'f',
  testCode: GOOD_TEST_CODE,
  numRuns: 100,
  seed: 1,
});

/** Only strings, finite numbers, booleans, null, arrays, and plain objects (Requirement 2, criterion 7). */
function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === 'object') {
    return (
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value as Record<string, unknown>).every(isPlainJson)
    );
  }
  return false;
}

/** Checks the shape every result must have, whatever produced it. */
function expectWellFormed(result: VerificationResult): void {
  expect(isPlainJson(result)).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  expect(Number.isInteger(result.executionTimeMs)).toBe(true);
  expect(result.executionTimeMs).toBeGreaterThanOrEqual(1);
  expect(result.executionTimeMs).toBeLessThanOrEqual(600_000);
  expect(BANNED.test(JSON.stringify(result))).toBe(false);
  if (result.status === 'ERROR') {
    expect(ERROR_CODES).toContain(result.code);
    expect(result.message.length).toBeGreaterThan(0);
    expect(Object.keys(result).sort()).toEqual(['code', 'executionTimeMs', 'message', 'status']);
  } else {
    expect(result.evidence).toBe(formatEvidence(result));
    expect(Number.isInteger(result.totalRuns)).toBe(true);
    expect(Number.isInteger(result.seed)).toBe(true);
  }
}

function errorOf(result: VerificationResult): Extract<VerificationResult, { status: 'ERROR' }> {
  if (result.status !== 'ERROR') throw new Error(`Expected ERROR, got ${JSON.stringify(result)}`);
  return result;
}

describe('public API', () => {
  it('R2.1 R2.3 exports exactly verifyEquivalence, verifyTestCode, and formatEvidence', () => {
    expect(Object.keys(api).sort()).toEqual(['formatEvidence', 'verifyEquivalence', 'verifyTestCode']);
  });
});

describe('results', () => {
  it('R2.4 R2.6 R10.4 PASSED carries totalRuns, the seed, the timing, and the evidence sentence', async () => {
    const result = await verifyEquivalence({ ...baseEquivalence(), numRuns: 250, seed: 42 });
    expect(result).toEqual({
      status: 'PASSED',
      totalRuns: 250,
      seed: 42,
      executionTimeMs: result.executionTimeMs,
      evidence: 'Verified behavioral equivalence across 250 generated inputs (seed 42).',
    });
    expectWellFormed(result);
  });

  it('R2.4 R10.3 R10.4 FAILED carries the counterexample and the evidence sentence', async () => {
    const result = await verifyEquivalence({
      ...baseEquivalence(),
      legacyCode: 'function f(n) { return n * 2; }',
      modernCode: 'export function f(n: number): number { return n < 0 ? n * 2 - 1 : n * 2; }',
      inputArbitrary: fc.integer({ min: -1000, max: 1000 }),
      seed: 3,
    });
    if (result.status !== 'FAILED') throw new Error(`Expected FAILED, got ${JSON.stringify(result)}`);
    expect(result.counterexample.input).toBe('-1');
    expect(result.evidence).toBe(
      `Found a behavioral difference after ${result.totalRuns} generated inputs (seed 3).`,
    );
    expect(Object.keys(result).sort()).toEqual([
      'counterexample',
      'evidence',
      'executionTimeMs',
      'seed',
      'status',
      'totalRuns',
    ]);
    expectWellFormed(result);
  });

  it('R2.4 an ERROR result has exactly status, code, message, and executionTimeMs', async () => {
    const result = await verifyEquivalence({ ...baseEquivalence(), legacyCode: 'function f( {' });
    expectWellFormed(result);
    expect(errorOf(result).code).toBe('LEGACY_LOAD_ERROR');
  });

  it('R7.4 generates a 32-bit signed seed when none is given and returns it, so the run can be repeated', async () => {
    const withoutSeed: Partial<VerifyEquivalenceOptions> = baseEquivalence();
    delete withoutSeed.seed;
    const first = await verifyEquivalence({ ...(withoutSeed as VerifyEquivalenceOptions), numRuns: 100 });
    if (first.status !== 'PASSED') throw new Error('Expected PASSED');
    expect(first.seed).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(first.seed).toBeLessThanOrEqual(2 ** 31 - 1);
    const again = await verifyEquivalence({ ...baseEquivalence(), seed: first.seed });
    expect(again).toMatchObject({ status: 'PASSED', seed: first.seed });
  });

  it('R11.1 maps PASSED and FAILED results to the reincarnations column types', async () => {
    const result = await verifyTestCode(baseTestCode());
    if (result.status !== 'PASSED') throw new Error('Expected PASSED');
    expect(result.status === 'PASSED').toBe(true); // pbt_passed
    expect(Number.isInteger(result.totalRuns)).toBe(true); // total_runs INTEGER
    expect(Number.isInteger(result.executionTimeMs)).toBe(true); // execution_time_ms INTEGER
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(1);
    expect(result.executionTimeMs).toBeLessThanOrEqual(600_000);
  });

  it('R2.5 measures from the start of the call, so loading counts toward executionTimeMs', async () => {
    const result = await verifyEquivalence({ ...baseEquivalence(), legacyCode: 'function f( {' });
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(1);
  });
});

describe('every error code', () => {
  it('R12.5 R2.9 each code is produced by a minimal fixture through the public API', async () => {
    const loopingLegacy = 'function f() { while (true) {} }';
    const loopingModern = 'export function f(): number { for (;;) {} }';
    const throwing = {
      get origin(): never {
        throw new Error('getter exploded');
      },
    } as unknown as VerifyEquivalenceOptions;
    const scenarios: Array<[ErrorCode, () => Promise<VerificationResult>]> = [
      ['INVALID_OPTIONS', () => verifyEquivalence({ ...baseEquivalence(), numRuns: 5 })],
      ['UNSUPPORTED_ORIGIN', () => verifyEquivalence({ ...baseEquivalence(), origin: 'user' })],
      ['LEGACY_LOAD_ERROR', () => verifyEquivalence({ ...baseEquivalence(), legacyCode: 'function f( {' })],
      [
        'ENTRY_FUNCTION_NOT_FOUND',
        () => verifyEquivalence({ ...baseEquivalence(), entryFunction: 'missing' }),
      ],
      [
        'MODERN_COMPILE_ERROR',
        () =>
          verifyEquivalence({
            ...baseEquivalence(),
            modernCode: 'export function f(n: number): string { return n; }',
          }),
      ],
      [
        'MODERN_LOAD_ERROR',
        () =>
          verifyEquivalence({
            ...baseEquivalence(),
            modernCode: 'throw new Error("at load"); export function f(): void {}',
          }),
      ],
      ['TEST_CODE_ERROR', () => verifyTestCode({ ...baseTestCode(), testCode: 'return 1;' })],
      [
        'CALL_TIMEOUT',
        () =>
          verifyEquivalence({
            ...baseEquivalence(),
            legacyCode: loopingLegacy,
            modernCode: loopingModern,
            callTimeoutMs: 50,
          }),
      ],
      ['TOTAL_TIMEOUT', () => verifyEquivalence({ ...baseEquivalence(), totalTimeoutMs: 1 })],
      ['INTERNAL_ERROR', () => verifyEquivalence(throwing)],
    ];
    expect(scenarios.map(([code]) => code)).toEqual(ERROR_CODES);
    for (const [code, run] of scenarios) {
      const result = errorOf(await run());
      expect(result.code, code).toBe(code);
      expectWellFormed(result);
    }
  });
});

describe('guard', () => {
  it('R3.2 R12.4 origin "user" gives UNSUPPORTED_ORIGIN even when every piece of code is invalid', async () => {
    const result = errorOf(
      await verifyEquivalence({
        ...baseEquivalence(),
        origin: 'user',
        legacyCode: 'function ( {{{',
        modernCode: 'import x from "nowhere"; export function (',
      }),
    );
    expect(result.code).toBe('UNSUPPORTED_ORIGIN');
    const testResult = errorOf(
      await verifyTestCode({ ...baseTestCode(), origin: 'user', legacyCode: 'function ( {{{', testCode: '}{' }),
    );
    expect(testResult.code).toBe('UNSUPPORTED_ORIGIN');
  });

  it('R3.2 never touches the arbitrary or runs any code for origin "user"', async () => {
    let generated = 0;
    const watching = fc.integer().map((n) => {
      generated++;
      return n;
    });
    await verifyEquivalence({ ...baseEquivalence(), origin: 'user', inputArbitrary: watching });
    expect(generated).toBe(0);
  });

  it('R3.2 R12.4 Property 6: origin "user" always gives UNSUPPORTED_ORIGIN, never a load error', async () => {
    // Feature: 03-pbt-verifier, Property 6: Guard
    await fc.assert(
      fc.asyncProperty(fc.string(), fc.string(), fc.string(), async (legacyCode, modernCode, testCode) => {
        const equivalence = errorOf(
          await verifyEquivalence({ ...baseEquivalence(), origin: 'user', legacyCode, modernCode }),
        );
        const stored = errorOf(
          await verifyTestCode({ ...baseTestCode(), origin: 'user', legacyCode, modernCode, testCode }),
        );
        expect(equivalence.code).toBe('UNSUPPORTED_ORIGIN');
        expect(stored.code).toBe('UNSUPPORTED_ORIGIN');
      }),
      { numRuns: 100 },
    );
  });
});

describe('never rejects', () => {
  const codeFragment = fc.oneof(
    fc.string(),
    fc.constantFrom(
      ADD_LEGACY,
      ADD_MODERN,
      'function f(x) { return x; }',
      'function f() { while (true) {} }',
      'function f() { throw {}; }',
      'function f() { throw null; }',
      'throw new Error("at load");',
      'export function f(x: number) { return x; }',
      'export function f(x: number): number { throw new RangeError("x"); }',
      'import x from "y"; export function f() {}',
      'export function f(): Promise<number> { return import("z") as never; }',
      '',
    ),
  );
  const testCodeFragment = fc.oneof(
    fc.string(),
    fc.constantFrom(
      GOOD_TEST_CODE,
      'return 1;',
      'return null;',
      'throw new Error("x");',
      'return fc.property(fc.integer(), function () { return false; });',
      'return fc.property(fc.integer(), function () { throw 5; });',
      'return fc.property(fc.integer(), function (n) { legacyFn(n); });',
      'return fc.property(fc.integer(), function () { fc.pre(false); });',
      '',
    ),
  );

  it('R2.7 R2.8 Property 7: arbitrary option objects always resolve to a well-formed result', async () => {
    // Feature: 03-pbt-verifier, Property 7: Never rejects
    const option = fc.oneof(fc.anything(), fc.constantFrom('sample', 'user', 'f', 100, 1000, -1));
    const rawOptions = fc.oneof(
      fc.anything(),
      fc.record(
        {
          origin: fc.oneof(fc.constant('sample'), option),
          legacyCode: option,
          modernCode: option,
          entryFunction: option,
          inputArbitrary: fc.oneof(fc.constant(fc.integer()), fc.anything()),
          testCode: option,
          numRuns: option,
          seed: option,
          callTimeoutMs: option,
          totalTimeoutMs: option,
        },
        { requiredKeys: [] },
      ),
    );
    await fc.assert(
      fc.asyncProperty(rawOptions, async (raw) => {
        expectWellFormed(await verifyEquivalence(raw as VerifyEquivalenceOptions));
        expectWellFormed(await verifyTestCode(raw as VerifyTestCodeOptions));
      }),
      { numRuns: 150 },
    );
  });

  it('R2.7 R2.8 Property 7: arbitrary code strings with origin "sample" always resolve to a well-formed result', async () => {
    // Feature: 03-pbt-verifier, Property 7: Never rejects
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(ADD_LEGACY), codeFragment),
        fc.oneof(fc.constant(ADD_MODERN), codeFragment),
        testCodeFragment,
        async (legacyCode, modernCode, testCode) => {
          const common = {
            origin: 'sample' as const,
            legacyCode,
            modernCode,
            entryFunction: 'f',
            numRuns: 100,
            seed: 1,
            callTimeoutMs: 50,
            totalTimeoutMs: 3000,
          };
          expectWellFormed(await verifyEquivalence({ ...common, inputArbitrary: fc.integer() }));
          expectWellFormed(await verifyTestCode({ ...common, testCode }));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('R2.8 R2.9 reports a generator that throws a non-Error value as INTERNAL_ERROR without a stack trace', async () => {
    const exploding = fc.constant(0).map(() => {
      throw 'unexpected value';
    });
    const result = errorOf(await verifyEquivalence({ ...baseEquivalence(), inputArbitrary: exploding }));
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toContain('unexpected value');
    expect(result.message).not.toMatch(/\n\s+at /);
    expectWellFormed(result);
  });

  it('R2.9 reports a generator that throws an Error as INTERNAL_ERROR with the error name and message only', async () => {
    const exploding = fc.constant(0).map(() => {
      throw new RangeError('generator failed');
    });
    const result = errorOf(await verifyEquivalence({ ...baseEquivalence(), inputArbitrary: exploding }));
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('RangeError: generator failed');
  });

  it('R2.8 reports an options object with a throwing getter as INTERNAL_ERROR', async () => {
    const options = baseEquivalence();
    Object.defineProperty(options, 'legacyCode', {
      get(): never {
        throw new TypeError('getter failed');
      },
    });
    const result = errorOf(await verifyEquivalence(options));
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.message).toBe('TypeError: getter failed');
  });
});

describe('result hygiene', () => {
  it('R10.5 Property 8: evidence equals formatEvidence, and a thrown legacy message with a banned phrase is redacted', async () => {
    // Feature: 03-pbt-verifier, Property 8: Evidence text
    const claim = 'this is 100% guaranteed and a mathematical proof';
    const legacyThrowsAtLoad = errorOf(
      await verifyEquivalence({
        ...baseEquivalence(),
        legacyCode: `throw new Error("${claim}"); function f(n) { return n; }`,
      }),
    );
    expect(legacyThrowsAtLoad.code).toBe('LEGACY_LOAD_ERROR');
    expect(legacyThrowsAtLoad.message).toBe(
      'Error: this is [redacted] [redacted] and a [redacted]',
    );

    const legacyReturnsClaim = await verifyEquivalence({
      ...baseEquivalence(),
      legacyCode: `function f(n) { return "${claim}"; }`,
      modernCode: 'export function f(n: number): string { return "other " + n; }',
    });
    if (legacyReturnsClaim.status !== 'FAILED') throw new Error('Expected FAILED');
    expect(legacyReturnsClaim.counterexample.legacyOutcome).toContain('[redacted]');
    expectWellFormed(legacyReturnsClaim);

    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 300 }),
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.boolean(),
        async (numRuns, seed, differs) => {
          const result = await verifyEquivalence({
            ...baseEquivalence(),
            modernCode: differs
              ? 'export function f(n: number): number { return n >= 0 ? n + 1 : n; }'
              : ADD_MODERN,
            inputArbitrary: fc.integer({ min: -100, max: 100 }),
            numRuns,
            seed,
          });
          expect(result.status).toBe(differs ? 'FAILED' : 'PASSED');
          expectWellFormed(result);
          if (result.status !== 'ERROR') {
            expect(result.seed).toBe(seed);
            if (result.status === 'PASSED') expect(result.totalRuns).toBe(numRuns);
          }
        },
      ),
      { numRuns: 10 },
    );
  });

  it('R2.10 R9.5 messages do not repeat the submitted source and carry no stack, path, or process detail', async () => {
    const legacy = 'function f(n) {\n  return n + 1 +;\n}\n/* marker-legacy-source-0123456789 */';
    const modern = 'export function f(n: number): string {\n  return n;\n}\n// marker-modern-source-0123456789';
    const testCode = 'return fc.property(fc.integer(), function () { throw new Error("t"); });\n// marker-test-0123456789';
    const results = [
      await verifyEquivalence({ ...baseEquivalence(), legacyCode: legacy }),
      await verifyEquivalence({ ...baseEquivalence(), modernCode: modern }),
      await verifyTestCode({ ...baseTestCode(), testCode }),
      await verifyTestCode({ ...baseTestCode(), testCode: 'return fc.property(' }),
    ];
    for (const result of results) {
      const message = errorOf(result).message;
      expect(message).not.toContain(legacy);
      expect(message).not.toContain(modern);
      expect(message).not.toContain(testCode);
      expect(message).not.toMatch(/marker-/);
      expect(message).not.toMatch(/\n\s+at \S+/);
      expect(message).not.toMatch(/node_modules|[A-Za-z]:[\\/]|file:\/\//);
      expect(JSON.stringify(result)).not.toMatch(/process\.|pid|argv/);
    }
  });
});
