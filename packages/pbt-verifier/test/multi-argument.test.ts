import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectError, expectFailed, runTc } from './support/run.ts';

// 11-multi-argument-entry: `assertEquivalentArgs(args)` and the arity guard on `assertEquivalent`.

const NAMES = ['a', 'b', 'c', 'd'];

/** A legacy and a modern function of `arity` parameters that both return the weighted sum of all of them. */
function weightedSum(arity: number): { legacy: string; modern: string } {
  const names = NAMES.slice(0, arity);
  const sum = names.map((name, index) => `${index + 1} * ${name}`).join(' + ');
  return {
    legacy: `function f(${names.join(', ')}) { return ${sum}; }`,
    modern: `export function f(${names.map((name) => `${name}: number`).join(', ')}): number { return ${sum}; }`,
  };
}

/** Same as `weightedSum`, but the modern function ignores its last parameter. */
function ignoresLast(arity: number): { legacy: string; modern: string } {
  const names = NAMES.slice(0, arity);
  const sum = (list: string[]) => list.map((name, index) => `${index + 1} * ${name}`).join(' + ');
  return {
    legacy: `function f(${names.join(', ')}) { return ${sum(names)}; }`,
    modern: `export function f(${names.map((name) => `${name}: number`).join(', ')}): number { return ${sum(names.slice(0, -1))}; }`,
  };
}

const argsTest = (arity: number) =>
  `return fc.property(fc.tuple(${Array.from({ length: arity }, () => 'fc.integer({ min: -1000, max: 1000 })').join(', ')}), (args) => { assertEquivalentArgs(args); });`;

const ONE_ARGUMENT_TEST = 'return fc.property(fc.integer(), (input) => { assertEquivalent(input); });';

describe('assertEquivalentArgs in the Verifier', () => {
  it('R1.2 functions that agree on every parameter pass for 2 to 4 parameters', async () => {
    // Feature: 11-multi-argument-entry, Property 1: Spread equivalence
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), fc.integer(), async (arity, seed) => {
        const pair = weightedSum(arity);
        const result = await runTc({ legacyCode: pair.legacy, modernCode: pair.modern, testCode: argsTest(arity), numRuns: 100, seed });
        expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
      }),
      { numRuns: 12 },
    );
  });

  it('R1.3 a modern function that ignores its last parameter fails, and the counterexample shows the argument list', async () => {
    // Feature: 11-multi-argument-entry, Property 2: Every parameter counts
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 4 }), fc.integer(), async (arity, seed) => {
        const pair = ignoresLast(arity);
        const failed = expectFailed(await runTc({ legacyCode: pair.legacy, modernCode: pair.modern, testCode: argsTest(arity), numRuns: 100, seed }));
        const shown = JSON.parse(failed.counterexample.input) as unknown;
        expect(Array.isArray(shown) && shown.length === arity).toBe(true);
      }),
      { numRuns: 12 },
    );
  });

  it('R2.1 R2.2 assertEquivalent ends with TEST_CODE_ERROR if and only if the legacy function declares 2 or more parameters', async () => {
    // Feature: 11-multi-argument-entry, Property 3: Refusal follows the arity
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (arity) => {
        const names = NAMES.slice(0, arity).join(', ');
        const result = await runTc({
          legacyCode: `function f(${names}) { return 1; }`,
          modernCode: `export function f(${NAMES.slice(0, arity).map((name) => `${name}?: unknown`).join(', ')}): number { return 1; }`,
          testCode: ONE_ARGUMENT_TEST,
          numRuns: 100,
        });
        if (arity >= 2) {
          const error = expectError(result);
          expect(error.code).toBe('TEST_CODE_ERROR');
          expect(error.message).toContain(`declares ${arity} parameters`);
          expect(error.message).toContain('assertEquivalentArgs');
        } else {
          expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
        }
      }),
      { numRuns: 15 },
    );
  });

  it('R1.4 an argument list that is not an array ends with TEST_CODE_ERROR', async () => {
    const pair = weightedSum(2);
    const error = expectError(
      await runTc({ legacyCode: pair.legacy, modernCode: pair.modern, testCode: 'return fc.property(fc.integer(), (n) => { assertEquivalentArgs(n); });' }),
    );
    expect(error.code).toBe('TEST_CODE_ERROR');
    expect(error.message).toContain('assertEquivalentArgs expects an array of arguments');
  });

  it('R1.2 each side gets its own copy of the arguments', async () => {
    const result = await runTc({
      legacyCode: 'function f(list, n) { list.push(n); return list.length; }',
      modernCode: 'export function f(list: number[], n: number): number { return list.length + 1; }',
      testCode: 'return fc.property(fc.array(fc.integer(), { maxLength: 5 }), fc.integer(), (list, n) => { assertEquivalentArgs([list, n]); });',
    });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
  });

  it('R1.2 the function is called with this undefined, as a plain call', async () => {
    const result = await runTc({
      legacyCode: 'function f(a, b) { "use strict"; return this === undefined ? a + b : -1; }',
      modernCode: 'export function f(a: number, b: number): number { return a + b; }',
      testCode: argsTest(2),
    });
    expect(result).toMatchObject({ status: 'PASSED' });
  });

  it('R1.2 a later change to Reflect.apply by the legacy code does not change how arguments are passed', async () => {
    const result = await runTc({
      legacyCode: 'Reflect.apply = function () { return 0; }; function f(a, b) { return a + b; }',
      modernCode: 'export function f(a: number, b: number): number { return a + b; }',
      testCode: argsTest(2),
    });
    expect(result).toMatchObject({ status: 'PASSED' });
  });

  it('R1.5 a one-parameter function still accepts assertEquivalentArgs with one element', async () => {
    const result = await runTc({
      legacyCode: 'function f(n) { return n * 2; }',
      modernCode: 'export function f(n: number): number { return n * 2; }',
      testCode: argsTest(1),
    });
    expect(result).toMatchObject({ status: 'PASSED' });
  });
});
