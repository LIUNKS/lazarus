import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSandboxedVerification } from '../src/property-mode.ts';
import { options, SLOW_PROPERTY_TIMEOUT_MS } from './support/samples.ts';

// 11-multi-argument-entry: `assertEquivalentArgs(args)` and the arity guard on `assertEquivalent` in the Sandbox.

const NAMES = ['a', 'b', 'c', 'd'];

const sum = (names: string[]) => names.map((name, index) => `${index + 1} * ${name}`).join(' + ');
const typed = (names: string[]) => names.map((name) => `${name}: number`).join(', ');

const argsTest = (arity: number) =>
  `return fc.property(fc.tuple(${Array.from({ length: arity }, () => 'fc.integer({ min: -1000, max: 1000 })').join(', ')}), function (args) { assertEquivalentArgs(args); });`;

describe('assertEquivalentArgs in the Sandbox', () => {
  it(
    'R1.2 functions that agree on every parameter pass for 2 to 4 parameters',
    async () => {
      // Feature: 11-multi-argument-entry, Property 1: Spread equivalence
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 4 }), fc.integer(), async (arity, seed) => {
          const names = NAMES.slice(0, arity);
          const result = await runSandboxedVerification(
            options({
              legacyCode: `function f(${names.join(', ')}) { return ${sum(names)}; }`,
              modernCode: `export function f(${typed(names)}): number { return ${sum(names)}; }`,
              testCode: argsTest(arity),
              seed,
            }),
          );
          expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100, executor: 'sandbox-worker' });
        }),
        { numRuns: 4 },
      );
    },
    SLOW_PROPERTY_TIMEOUT_MS,
  );

  it(
    'R1.3 a modern function that ignores its last parameter fails, and the counterexample shows the argument list',
    async () => {
      // Feature: 11-multi-argument-entry, Property 2: Every parameter counts
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 2, max: 4 }), fc.integer(), async (arity, seed) => {
          const names = NAMES.slice(0, arity);
          const result = await runSandboxedVerification(
            options({
              legacyCode: `function f(${names.join(', ')}) { return ${sum(names)}; }`,
              modernCode: `export function f(${typed(names)}): number { return ${sum(names.slice(0, -1))}; }`,
              testCode: argsTest(arity),
              seed,
            }),
          );
          if (result.status !== 'FAILED') throw new Error(`Expected FAILED, got ${JSON.stringify(result)}`);
          const shown = JSON.parse(result.counterexample.input) as unknown;
          expect(Array.isArray(shown) && shown.length === arity).toBe(true);
        }),
        { numRuns: 4 },
      );
    },
    SLOW_PROPERTY_TIMEOUT_MS,
  );

  it(
    'R2.1 R2.2 assertEquivalent ends with TEST_CODE_ERROR if and only if the legacy function declares 2 or more parameters',
    async () => {
      // Feature: 11-multi-argument-entry, Property 3: Refusal follows the arity
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 4 }), async (arity) => {
          const names = NAMES.slice(0, arity);
          const result = await runSandboxedVerification(
            options({
              legacyCode: `function f(${names.join(', ')}) { return 1; }`,
              modernCode: `export function f(${names.map((name) => `${name}?: unknown`).join(', ')}): number { return 1; }`,
              testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
            }),
          );
          if (arity >= 2) {
            expect(result).toMatchObject({ status: 'ERROR', code: 'TEST_CODE_ERROR' });
            const message = result.status === 'ERROR' ? result.message : '';
            expect(message).toContain(`declares ${arity} parameters`);
            expect(message).toContain('assertEquivalentArgs');
          } else {
            expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
          }
        }),
        { numRuns: 6 },
      );
    },
    SLOW_PROPERTY_TIMEOUT_MS,
  );

  it('R1.4 an argument list that is not an array ends with TEST_CODE_ERROR', async () => {
    const result = await runSandboxedVerification(
      options({
        legacyCode: 'function f(a, b) { return a + b; }',
        modernCode: 'export function f(a: number, b: number): number { return a + b; }',
        testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalentArgs(n); });',
      }),
    );
    expect(result).toMatchObject({ status: 'ERROR', code: 'TEST_CODE_ERROR' });
    expect(result.status === 'ERROR' ? result.message : '').toContain('assertEquivalentArgs expects an array of arguments');
  });

  it('R1.2 each side gets its own copy of the arguments, and Reflect.apply changed by the legacy code is not used', async () => {
    const result = await runSandboxedVerification(
      options({
        legacyCode: 'Reflect.apply = function () { return 0; }; function f(list, n) { list.push(n); return list.length; }',
        modernCode: 'export function f(list: number[], n: number): number { return list.length + 1; }',
        testCode: 'return fc.property(fc.array(fc.integer(), { maxLength: 5 }), fc.integer(), function (list, n) { assertEquivalentArgs([list, n]); });',
      }),
    );
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
  });
});
