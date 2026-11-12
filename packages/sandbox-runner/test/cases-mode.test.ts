import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runSandboxedCases } from '../src/cases-mode.ts';
import { createdWorkerCount } from '../src/host/supervisor.ts';
import { DOUBLE, DOUBLE_DIFFERENT, expectHygienic, SMALL } from './support/samples.ts';

const cases = (inputs: unknown[], overrides: object = {}) =>
  runSandboxedCases({ ...DOUBLE_DIFFERENT, inputs, limits: SMALL, ...overrides });

describe('cases mode', () => {
  it('R10.3 returns one entry per input, in input order, with both outcomes', async () => {
    const result = await cases([1, 500, 'x']);
    expect(result).toEqual({
      status: 'COMPLETED',
      executor: 'sandbox-worker',
      executionTimeMs: expect.any(Number),
      cases: [
        { equivalent: true, legacy: { kind: 'returned', rendered: '2' }, modern: { kind: 'returned', rendered: '2' } },
        { equivalent: false, legacy: { kind: 'returned', rendered: '1000' }, modern: { kind: 'returned', rendered: '0' } },
        { equivalent: true, legacy: { kind: 'returned', rendered: 'NaN' }, modern: { kind: 'returned', rendered: 'NaN' } },
      ],
    });
    expectHygienic(result);
  });

  it('R10.3 the result of this mode has no evidence text', async () => {
    const result = await cases([1]);
    expect(result.status).toBe('COMPLETED');
    expect(JSON.stringify(result)).not.toContain('evidence');
  });

  it('R10.3 a function that throws on some inputs reports the thrown name, compared by name', async () => {
    const result = await cases([1, 2, 3], {
      legacyCode: 'function f(a) { if (a === 2) throw new RangeError("legacy text"); if (a === 3) throw "plain"; return a; }',
      modernCode: 'export function f(a: number): number { if (a === 2) throw new RangeError("another text"); if (a === 3) throw new Error("x"); return a; }',
    });
    expect(result).toMatchObject({
      cases: [
        { equivalent: true },
        { equivalent: true, legacy: { kind: 'threw', name: 'RangeError' }, modern: { kind: 'threw', name: 'RangeError' } },
        { equivalent: false, legacy: { kind: 'threw', name: 'non-error' }, modern: { kind: 'threw', name: 'Error' } },
      ],
    });
  });

  it('R10.3 a rendered value is at most 200 characters', async () => {
    const result = await cases(['a'], { legacyCode: 'function f(a) { return new Array(500).join(a); }', modernCode: 'export function f(a: string): string { return a.repeat(499); }' });
    if (result.status !== 'COMPLETED') throw new Error(`unexpected ${result.code}`);
    expect(result.cases[0]).toMatchObject({ equivalent: true });
    const shown = result.cases[0]!.legacy;
    expect(shown.kind === 'returned' && shown.rendered.length).toBeLessThanOrEqual(200);
  });

  it('R10.5 each input has the same outcome in any order', async () => {
    // Feature: 07-sandboxed-execution, Property 8: Case independence
    const input = fc.oneof(fc.integer({ min: -200, max: 400 }), fc.string({ maxLength: 4 }), fc.array(fc.integer(), { maxLength: 3 }), fc.constantFrom(null, undefined, 1.5));
    // The legacy function mutates its input and keeps every input it saw. Each case gets its own
    // copy, so neither can change the outcome of another case.
    const stateful = {
      legacyCode: 'var seen = []; function f(a) { seen.push(a); if (a && a.push) a.push(99); return typeof a === "number" ? a * 2 : a; }',
      modernCode: 'export function f(a: unknown): unknown { return typeof a === "number" ? (a > 100 ? 0 : a * 2) : a; }',
    };
    await fc.assert(
      fc.asyncProperty(
        fc.array(input, { minLength: 2, maxLength: 8 }).chain((inputs) => fc.tuple(fc.constant(inputs), fc.shuffledSubarray(inputs.map((_, index) => index), { minLength: inputs.length }))),
        async ([inputs, order]) => {
          const original = await cases(inputs, stateful);
          const permuted = await cases(order.map((index) => inputs[index]), stateful);
          if (original.status !== 'COMPLETED' || permuted.status !== 'COMPLETED') return false;
          return order.every((index, position) => JSON.stringify(permuted.cases[position]) === JSON.stringify(original.cases[index]));
        },
      ),
      { numRuns: 6 },
    );
  });

  it('R10.2 rejects fewer than 1 or more than 1000 inputs without creating a Worker', async () => {
    const before = createdWorkerCount();
    for (const inputs of [[], new Array(1001).fill(1)]) {
      expect(await cases(inputs)).toMatchObject({ status: 'ERROR', code: 'INVALID_OPTIONS' });
    }
    expect(createdWorkerCount()).toBe(before);
  });

  it('R10.2 rejects inputs whose combined text exceeds maxResultBytes without creating a Worker', async () => {
    const before = createdWorkerCount();
    const result = await cases(new Array(10).fill('x'.repeat(1000)), { limits: { ...SMALL, maxResultBytes: 4096 } });
    expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_OPTIONS' });
    expect(createdWorkerCount()).toBe(before);
  });

  it('R10.2 an unsupported input gives UNSUPPORTED_VALUE with its index and path, and creates no Worker', async () => {
    const before = createdWorkerCount();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const withFunction = await cases([1, { a: [() => 1] }]);
    expect(withFunction).toMatchObject({ status: 'ERROR', code: 'UNSUPPORTED_VALUE', message: 'Input 1: function at input["a"][0].' });
    expect(await cases([cyclic])).toMatchObject({ code: 'UNSUPPORTED_VALUE', message: 'Input 0: cyclic input.' });
    expect(createdWorkerCount()).toBe(before);
  });

  it('R10.4 a case that exceeds caseTimeoutMs gives SANDBOX_TIMEOUT with the index of the case', async () => {
    const result = await cases([1, 2, 3], {
      legacyCode: 'function f(a) { if (a === 3) { for (;;) {} } return a; }',
      modernCode: 'export function f(a: number): number { return a; }',
      limits: { ...SMALL, caseTimeoutMs: 100 },
    });
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_TIMEOUT' });
    if (result.status === 'ERROR') expect(result.message).toMatch(/Case 2 .*side: legacy/);
  });

  it('R10.6 a compile error and a load error are reported as in property mode', async () => {
    expect(await cases([1], { modernCode: 'export function f(a: number): string { return a; }' })).toMatchObject({ code: 'MODERN_COMPILE_ERROR' });
    expect(await cases([1], { legacyCode: 'function f( {' })).toMatchObject({ code: 'LEGACY_LOAD_ERROR' });
    expect(await cases([1], { ...DOUBLE, entryFunction: 'missing' })).toMatchObject({ code: 'ENTRY_FUNCTION_NOT_FOUND' });
  });

  it('R7.2 every supported kind of value reaches both functions as a fresh copy of the right type', async () => {
    const describeValue = `
      var tag = Object.prototype.toString.call(a).slice(8, -1);
      var own = a instanceof Object ? (a instanceof Array) + '/' + (a instanceof Date) + '/' + (a instanceof Map) : 'primitive';
      return tag + ':' + own;`;
    const result = await cases([[1], new Date(0), new Map([[1, 2]]), new Set([1]), /x/g, new Uint8Array([1]), 10n, -0, undefined, { a: 1 }], {
      legacyCode: `function f(a) { ${describeValue} }`,
      modernCode: `export function f(a: unknown): string { ${describeValue} }`,
    });
    if (result.status !== 'COMPLETED') throw new Error(`unexpected ${result.code}: ${result.message}`);
    expect(result.cases.every((entry) => entry.equivalent)).toBe(true);
    expect(result.cases.map((entry) => (entry.legacy.kind === 'returned' ? entry.legacy.rendered : 'threw'))).toEqual([
      '"Array:true/false/false"', '"Date:false/true/false"', '"Map:false/false/true"', '"Set:false/false/false"', '"RegExp:false/false/false"',
      '"Uint8Array:false/false/false"', '"BigInt:primitive"', '"Number:primitive"', '"Undefined:primitive"', '"Object:false/false/false"',
    ]);
  });
});
