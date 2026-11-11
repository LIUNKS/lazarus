import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Outcome } from '../src/equivalence/outcome.ts';
import { RETURNED_FALSE_MESSAGE } from '../src/run/execute.ts';
import { createRunState, type EquivalenceError } from '../src/run/run-state.ts';
import { createAssertEquivalent, type Side } from '../src/run/sides.ts';
import { expectError, expectFailed, runEq, runTc } from './support/run.ts';

const ADD_LEGACY = 'function f(n) { return n + 1; }';
const ADD_MODERN = 'export function f(n: number): number { return n + 1; }';
const SPIN = 'function f() { while (true) {} }';
const SPIN_MODERN = 'export function f(): number { for (;;) {} }';

interface Template {
  name: string;
  legacy: string;
  modern: string;
  arbitrary: fc.Arbitrary<unknown>;
}

/** Equivalent legacy and modern sources for the reflexivity property. */
const EQUIVALENT_TEMPLATES: Template[] = [
  { name: 'increment', legacy: ADD_LEGACY, modern: ADD_MODERN, arbitrary: fc.integer() },
  {
    name: 'upper-case',
    legacy: 'function f(s) { return s.toUpperCase(); }',
    modern: 'export function f(s: string): string { return s.toUpperCase(); }',
    arbitrary: fc.string(),
  },
  {
    name: 'sum',
    legacy:
      'function f(a) { var t = 0; for (var i = 0; i < a.length; i++) { t += a[i]; } return t; }',
    modern: 'export function f(a: number[]): number { return a.reduce((t, x) => t + x, 0); }',
    arbitrary: fc.array(fc.integer({ min: -1000, max: 1000 })),
  },
  {
    name: 'record',
    legacy: 'function f(o) { return { n: o.n * 2, tag: String(o.n), list: [o.n, -o.n] }; }',
    modern:
      'export function f(o: { n: number }): { n: number; tag: string; list: number[] } { return { n: o.n * 2, tag: String(o.n), list: [o.n, -o.n] }; }',
    arbitrary: fc.record({ n: fc.integer() }),
  },
  {
    name: 'throws the same error name with another message',
    legacy: 'function f(n) { if (n < 0) { throw new RangeError("legacy text"); } return n; }',
    modern:
      'export function f(n: number): number { if (n < 0) { throw new RangeError("modern text"); } return n; }',
    arbitrary: fc.integer({ min: -50, max: 50 }),
  },
];

/** Differs only for negative inputs: an off-by-one error on that class. */
const NEGATIVE_LEGACY = 'function f(n) { return n * 2; }';
const NEGATIVE_MODERN =
  'export function f(n: number): number { return n < 0 ? n * 2 - 1 : n * 2; }';
const negativeInts = fc.integer({ min: -1000, max: 1000 });

describe('equivalent pair', () => {
  it('R7.7 R12.2 Property 1: equivalent sources give PASSED with totalRuns equal to numRuns', async () => {
    // Feature: 03-pbt-verifier, Property 1: Reflexivity
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...EQUIVALENT_TEMPLATES),
        fc.integer({ min: 100, max: 300 }),
        fc.integer(),
        async (template, numRuns, seed) => {
          const result = await runEq({
            legacyCode: template.legacy,
            modernCode: template.modern,
            inputArbitrary: template.arbitrary,
            numRuns,
            seed,
          });
          expect(result, template.name).toEqual({ status: 'PASSED', totalRuns: numRuns, seed });
        },
      ),
      { numRuns: 15 },
    );
  });

  it('R7.13 runs every one of the requested inputs when the result is PASSED', async () => {
    let generated = 0;
    const counting = fc.integer().map((n) => {
      generated++;
      return n;
    });
    const result = await runEq({
      legacyCode: ADD_LEGACY,
      modernCode: ADD_MODERN,
      inputArbitrary: counting,
      numRuns: 250,
    });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 250 });
    expect(generated).toBe(250);
  });
});

describe('differing pair', () => {
  it('R7.8 R9.1 R12.3 Property 2: a difference only for negative integers gives a negative counterexample', async () => {
    // Feature: 03-pbt-verifier, Property 2: Difference detection
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 100, max: 300 }), fc.integer(), async (numRuns, seed) => {
        const failed = expectFailed(
          await runEq({
            legacyCode: NEGATIVE_LEGACY,
            modernCode: NEGATIVE_MODERN,
            inputArbitrary: negativeInts,
            numRuns,
            seed,
          }),
        );
        const input = Number(failed.counterexample.input);
        expect(Number.isInteger(input)).toBe(true);
        expect(input).toBeLessThan(0);
        expect(failed.seed).toBe(seed);
        expect(failed.totalRuns).toBeGreaterThanOrEqual(1);
        expect(failed.totalRuns).toBeLessThanOrEqual(numRuns);
      }),
      { numRuns: 20 },
    );
  });

  it('R9.1 shrinks to the smallest negative input and reports both outcomes for it', async () => {
    const failed = expectFailed(
      await runEq({
        legacyCode: NEGATIVE_LEGACY,
        modernCode: NEGATIVE_MODERN,
        inputArbitrary: negativeInts,
        seed: 3,
      }),
    );
    expect(failed.counterexample).toEqual({
      input: '-1',
      legacyOutcome: 'returned: -2',
      modernOutcome: 'returned: -3',
      shrunk: true,
    });
  });

  it('R9.3 counts the runs up to and including the first failing run, not the shrinking calls', async () => {
    const arbitrary = fc.integer({ min: 0, max: 1000 });
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const values = fc.sample(arbitrary, { numRuns: 100, seed });
      const expected = values.findIndex((value) => value >= 500) + 1;
      expect(expected, `seed ${seed} must contain a value of 500 or more`).toBeGreaterThan(0);
      const failed = expectFailed(
        await runEq({
          legacyCode: 'function f(n) { return n; }',
          modernCode: 'export function f(n: number): number { return n >= 500 ? n + 1 : n; }',
          inputArbitrary: arbitrary,
          seed,
        }),
      );
      expect(failed.totalRuns, `seed ${seed}`).toBe(expected);
      expect(failed.counterexample.input).toBe('500');
    }
  });

  it('R6.4 R6.5 reports a return against a throw as a difference', async () => {
    const failed = expectFailed(
      await runEq({
        legacyCode: 'function f(n) { return n; }',
        modernCode:
          'export function f(n: number): number { if (n === 0) { throw new RangeError("zero"); } return n; }',
        inputArbitrary: fc.integer({ min: 0, max: 5 }),
      }),
    );
    expect(failed.counterexample).toMatchObject({
      input: '0',
      legacyOutcome: 'returned: 0',
      modernOutcome: 'threw: RangeError',
    });
  });

  it('R6.3 reports +0 against -0 as a difference', async () => {
    const failed = expectFailed(
      await runEq({
        legacyCode: 'function f(n) { return n * 0; }',
        modernCode: 'export function f(n: number): number { return Math.abs(n) * 0; }',
        inputArbitrary: fc.integer({ min: -5, max: 5 }),
      }),
    );
    expect(Number(failed.counterexample.input)).toBeLessThan(0);
  });
});

describe('seed determinism', () => {
  it('R7.12 R9.4 Property 3: the same seed gives the same status, runs, and counterexample', async () => {
    // Feature: 03-pbt-verifier, Property 3: Seed determinism
    const cases = [
      { legacyCode: ADD_LEGACY, modernCode: ADD_MODERN, inputArbitrary: fc.integer() },
      { legacyCode: NEGATIVE_LEGACY, modernCode: NEGATIVE_MODERN, inputArbitrary: negativeInts },
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...cases), fc.integer(), async (pair, seed) => {
        const first = await runEq({ ...pair, seed });
        const second = await runEq({ ...pair, seed });
        expect(second.status).toBe(first.status);
        if (first.status === 'PASSED' && second.status === 'PASSED') {
          expect(second.totalRuns).toBe(first.totalRuns);
        }
        if (first.status === 'FAILED' && second.status === 'FAILED') {
          expect(second.totalRuns).toBe(first.totalRuns);
          expect(second.counterexample.input).toBe(first.counterexample.input);
        }
      }),
      { numRuns: 15 },
    );
  });

  it('R12.6 R9.4 two different seeds each reproduce their own failing run', async () => {
    const pair = {
      legacyCode: 'function f(n) { return n; }',
      modernCode: 'export function f(n: number): number { return n >= 500 ? n + 1 : n; }',
      inputArbitrary: fc.integer({ min: 0, max: 1000 }),
    };
    const runs = new Set<number>();
    for (const seed of [11, 12]) {
      const first = expectFailed(await runEq({ ...pair, seed }));
      const again = expectFailed(await runEq({ ...pair, seed }));
      expect(again.totalRuns).toBe(first.totalRuns);
      expect(again.counterexample.input).toBe(first.counterexample.input);
      runs.add(first.seed);
    }
    expect(runs.size).toBe(2);
  });
});

describe('timeouts', () => {
  it('R7.9 R12.5 ends with CALL_TIMEOUT naming the legacy function when it loops', async () => {
    const started = performance.now();
    const error = expectError(
      await runEq({
        legacyCode: SPIN,
        modernCode: SPIN_MODERN,
        inputArbitrary: fc.integer(),
        callTimeoutMs: 50,
      }),
    );
    expect(error.code).toBe('CALL_TIMEOUT');
    expect(error.message).toContain('legacy');
    expect(error.message).not.toContain('modern');
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('R7.9 names the modern function when the modern side is the one that loops', async () => {
    const error = expectError(
      await runEq({
        legacyCode: 'function f() { return 1; }',
        modernCode: SPIN_MODERN,
        inputArbitrary: fc.integer(),
        callTimeoutMs: 50,
      }),
    );
    expect(error.code).toBe('CALL_TIMEOUT');
    expect(error.message).toContain('modern');
  });

  it('R7.10 R12.5 ends with TOTAL_TIMEOUT when the budget is spent before the first run', async () => {
    const error = expectError(
      await runEq({
        legacyCode: ADD_LEGACY,
        modernCode: ADD_MODERN,
        inputArbitrary: fc.integer(),
        totalTimeoutMs: 1,
      }),
    );
    expect(error.code).toBe('TOTAL_TIMEOUT');
    expect(error.message).toContain('1 ms');
  });

  it('R7.11 a timeout while shrinking returns FAILED with the smallest counterexample found so far', async () => {
    // The modern function starts to loop on its 11th call, which falls inside the shrinking phase.
    // A fixed-length array shrinks one element at a time, so reaching the minimum needs 20 steps or more.
    const failed = expectFailed(
      await runEq({
        legacyCode: 'function f(a) { return a.length; }',
        modernCode: [
          'let calls = 0;',
          'export function f(a: number[]): number {',
          '  calls++;',
          '  if (calls > 10) { for (;;) {} }',
          '  return a.length + 1;',
          '}',
        ].join('\n'),
        inputArbitrary: fc.array(fc.integer({ min: 1_000_000, max: 2_000_000 }), {
          minLength: 20,
          maxLength: 20,
        }),
        callTimeoutMs: 50,
      }),
    );
    expect(failed.totalRuns).toBe(1);
    expect(failed.counterexample.shrunk).toBe(true);
    // Uninterrupted shrinking would reduce all 20 elements to the minimum of their range.
    const fullyShrunk = fc.stringify(new Array<number>(20).fill(1_000_000));
    expect(failed.counterexample.input).not.toBe(fullyShrunk);
    expect(failed.counterexample.legacyOutcome).toBe('returned: 20');
    expect(failed.counterexample.modernOutcome).toBe('returned: 21');
  });

  it('R8.9 reports CALL_TIMEOUT and TOTAL_TIMEOUT from stored test code as ERROR, not FAILED', async () => {
    const testCode = 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });';
    const call = expectError(
      await runTc({ legacyCode: SPIN, modernCode: SPIN_MODERN, testCode, callTimeoutMs: 50 }),
    );
    expect(call.code).toBe('CALL_TIMEOUT');
    const total = expectError(
      await runTc({ legacyCode: ADD_LEGACY, modernCode: ADD_MODERN, testCode, totalTimeoutMs: 1 }),
    );
    expect(total.code).toBe('TOTAL_TIMEOUT');
  });
});

describe('input isolation', () => {
  it('R6.7 R12.7 legacy code that mutates its input changes neither the modern outcome nor the generated value', async () => {
    const generated: Array<{ ref: number[]; snapshot: number[] }> = [];
    const arbitrary = fc.array(fc.integer(), { minLength: 1, maxLength: 10 }).map((list) => {
      generated.push({ ref: list, snapshot: list.slice() });
      return list;
    });
    const result = await runEq({
      legacyCode: 'function f(a) { var n = a.length; a.length = 0; a.push(-1); return n; }',
      modernCode: 'export function f(a: number[]): number { return a.length; }',
      inputArbitrary: arbitrary,
      numRuns: 100,
    });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
    expect(generated.length).toBeGreaterThanOrEqual(100);
    for (const { ref, snapshot } of generated) expect(ref).toEqual(snapshot);
  });

  it('R6.7 modern code that mutates its input does not change the legacy outcome', async () => {
    const result = await runEq({
      legacyCode: 'function f(a) { return a.length; }',
      modernCode:
        'export function f(a: number[]): number { const n = a.length; a.length = 0; return n; }',
      inputArbitrary: fc.array(fc.integer(), { minLength: 1 }),
    });
    expect(result).toMatchObject({ status: 'PASSED' });
  });

  it('R6.8 reports an input that cannot be deep-copied as INVALID_OPTIONS', async () => {
    const error = expectError(
      await runEq({
        legacyCode: ADD_LEGACY,
        modernCode: ADD_MODERN,
        inputArbitrary: fc.constant(() => 1),
      }),
    );
    expect(error.code).toBe('INVALID_OPTIONS');
    expect(error.message).toMatch(/structured-cloneable/);
  });
});

describe('load errors reach the run result', () => {
  it('R4.3 R5.2 R5.5 R4.5 map each load failure to its code', async () => {
    const arbitrary = fc.integer();
    const codes = [
      ['function f( {', ADD_MODERN, 'LEGACY_LOAD_ERROR'],
      [ADD_LEGACY, 'export function f(n: number): string { return n; }', 'MODERN_COMPILE_ERROR'],
      [ADD_LEGACY, 'throw new Error("x"); export function f(): void {}', 'MODERN_LOAD_ERROR'],
      ['function other() {}', ADD_MODERN, 'ENTRY_FUNCTION_NOT_FOUND'],
      [ADD_LEGACY, 'export function other(): void {}', 'ENTRY_FUNCTION_NOT_FOUND'],
    ] as const;
    for (const [legacyCode, modernCode, code] of codes) {
      const error = expectError(await runEq({ legacyCode, modernCode, inputArbitrary: arbitrary }));
      expect(error.code, code).toBe(code);
    }
  });

  it('R4.3 reports the legacy error when both sides are broken', async () => {
    const error = expectError(
      await runEq({
        legacyCode: 'function f( {',
        modernCode: 'export function f( {',
        inputArbitrary: fc.integer(),
      }),
    );
    expect(error.code).toBe('LEGACY_LOAD_ERROR');
  });
});

describe('assertEquivalent', () => {
  const side = (outcome: Outcome): Side => ({
    outcome: () => outcome,
    call: () => {
      throw new Error('not used');
    },
  });

  it('R8.4 returns undefined for equivalent outcomes', () => {
    const state = createRunState(performance.now(), 1000);
    const assertEquivalent = createAssertEquivalent(
      side({ kind: 'returned', value: [1] }),
      side({ kind: 'returned', value: [1] }),
      state,
    );
    expect(assertEquivalent(0)).toBeUndefined();
    expect(state.firstDifferenceSeen).toBe(false);
  });

  it('R8.4 throws an Error whose message states both outcomes, each cut to 500 characters', () => {
    const state = createRunState(performance.now(), 1000);
    const assertEquivalent = createAssertEquivalent(
      side({ kind: 'returned', value: 'x'.repeat(5000) }),
      side({ kind: 'threw', name: 'RangeError' }),
      state,
    );
    let thrown: unknown;
    try {
      assertEquivalent(0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as EquivalenceError;
    expect(error.legacyOutcome.startsWith('returned: ')).toBe(true);
    expect(error.legacyOutcome.length).toBe(500);
    expect(error.modernOutcome).toBe('threw: RangeError');
    expect(error.message).toContain(error.legacyOutcome);
    expect(error.message).toContain('threw: RangeError');
    expect(state.firstDifferenceSeen).toBe(true);
    expect(state.lastDifference).toEqual({ legacy: error.legacyOutcome, modern: error.modernOutcome });
  });
});

describe('stored test code', () => {
  const pair = { legacyCode: ADD_LEGACY, modernCode: ADD_MODERN };

  it('R8.3 R8.5 R8.7 runs the returned property with the numRuns and seed of the Verifier', async () => {
    const result = await runTc({
      ...pair,
      numRuns: 250,
      seed: 77,
      testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
    });
    expect(result).toEqual({ status: 'PASSED', totalRuns: 250, seed: 77 });
  });

  it('R8.2 passes numRuns to the test code and accepts an asyncProperty', async () => {
    const result = await runTc({
      ...pair,
      numRuns: 120,
      testCode: [
        'var seen = numRuns;',
        'return fc.asyncProperty(fc.integer(), async function (n) {',
        '  if (seen !== 120) { throw new Error("numRuns was " + seen); }',
        '  assertEquivalent(n);',
        '});',
      ].join('\n'),
    });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 120 });
  });

  it('R8.8 R9.1 R9.2 reports a difference found by assertEquivalent with both outcomes', async () => {
    const failed = expectFailed(
      await runTc({
        legacyCode: NEGATIVE_LEGACY,
        modernCode: NEGATIVE_MODERN,
        testCode:
          'return fc.property(fc.integer({ min: -1000, max: 1000 }), function (n) { assertEquivalent(n); });',
        seed: 3,
      }),
    );
    expect(failed.counterexample).toEqual({
      input: '-1',
      legacyOutcome: 'returned: -2',
      modernOutcome: 'returned: -3',
      shrunk: true,
    });
  });

  it('R8.8 R9.2 reports "unavailable" outcomes when the predicate returns false', async () => {
    const failed = expectFailed(
      await runTc({
        ...pair,
        testCode: 'return fc.property(fc.integer({ min: 0, max: 100 }), function (n) { return n < 5; });',
      }),
    );
    expect(failed.counterexample).toEqual({
      input: '5',
      legacyOutcome: 'unavailable',
      modernOutcome: 'unavailable',
      shrunk: true,
    });
  });

  it('R8.8 pins the fast-check message that marks a predicate that returned false', async () => {
    // The classification depends on this text in the installed fast-check version.
    const details = fc.check(
      fc.property(fc.integer(), () => false),
      { numRuns: 100, seed: 1 },
    );
    expect(details.failed).toBe(true);
    expect((details.errorInstance as Error).message).toBe(RETURNED_FALSE_MESSAGE);
  });

  it('R8.6 R12.5 reports a syntax error in the test code as TEST_CODE_ERROR', async () => {
    const error = expectError(await runTc({ ...pair, testCode: 'return fc.property(' }));
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toMatch(/SyntaxError/);
  });

  it.each([
    ['an import', 'import fc2 from "fast-check"; return fc.property(fc.integer(), function () {});'],
    ['an export', 'export const a = 1; return fc.property(fc.integer(), function () {});'],
    ['a closing brace that tries to leave the function', '}); return 1; (function () {'],
  ])('R8.2 treats %s in the test code as a syntax error', async (_label, testCode) => {
    const error = expectError(await runTc({ ...pair, testCode }));
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toMatch(/does not compile/);
  });

  it('R8.6 reports a throw while building the property as TEST_CODE_ERROR', async () => {
    const error = expectError(
      await runTc({ ...pair, testCode: 'throw new RangeError("failed at build time");' }),
    );
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toContain('RangeError: failed at build time');
  });

  it('R8.6 reports a return value that is not a property as TEST_CODE_ERROR', async () => {
    for (const testCode of ['return 42;', 'return undefined;', 'return { generate: 1 };', 'return null;']) {
      const error = expectError(await runTc({ ...pair, testCode }));
      expect(error.code, testCode).toBe('TEST_CODE_ERROR');
      expect(error.message, testCode).toMatch(/did not return a fast-check property/);
    }
  });

  it('R8.10 reports an unrelated error thrown by the test code as TEST_CODE_ERROR, not FAILED', async () => {
    const error = expectError(
      await runTc({
        ...pair,
        testCode:
          'return fc.property(fc.integer(), function () { throw new TypeError("bug in the test code"); });',
      }),
    );
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toContain('TypeError: bug in the test code');
  });

  it('R8.10 reports a direct legacyFn throw as TEST_CODE_ERROR and points to assertEquivalent', async () => {
    const error = expectError(
      await runTc({
        legacyCode: 'function f(n) { if (n < 0) { throw new RangeError("neg"); } return n; }',
        modernCode: 'export function f(n: number): number { return n; }',
        testCode: 'return fc.property(fc.integer({ min: -5, max: 5 }), function (n) { legacyFn(n); });',
      }),
    );
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toContain('legacy');
    expect(error.message).toContain('assertEquivalent');
  });

  it('R8.3 lets the test code compare the wrapped functions itself', async () => {
    const result = await runTc({
      ...pair,
      testCode: 'return fc.property(fc.integer(), function (n) { return legacyFn(n) === modernFn(n); });',
    });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
  });

  it('R8.6 reports a property with too many rejected inputs as TEST_CODE_ERROR', async () => {
    const error = expectError(
      await runTc({
        ...pair,
        testCode: 'return fc.property(fc.integer(), function (n) { fc.pre(false); });',
      }),
    );
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toMatch(/valid inputs/);
  });

  it('R3.5 R12.8 require, process, fetch, and console are unreachable from the test code', async () => {
    const result = await runTc({
      ...pair,
      testCode: [
        'var seen = [typeof require, typeof process, typeof fetch, typeof console].join();',
        'return fc.property(fc.constant(seen), function (s) {',
        '  if (s !== "undefined,undefined,undefined,undefined") { throw new Error("reachable: " + s); }',
        '});',
      ].join('\n'),
    });
    expect(result).toMatchObject({ status: 'PASSED' });
  });
});
