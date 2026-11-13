import { verifyTestCode } from '@lazarus/pbt-verifier';
import { formatEvidence } from '@lazarus/pbt-verifier/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createdWorkerCount } from '../src/host/supervisor.ts';
import { runSandboxedVerification } from '../src/property-mode.ts';
import {
  DOUBLE,
  DOUBLE_DIFFERENT,
  expectHygienic,
  FORBIDDEN_PHRASES,
  MODERN_STUB,
  options,
  QUICK,
  SEED_SAMPLES,
  settledWorkerCount,
  VERIFIER_FIXTURES,
} from './support/samples.ts';

const run = runSandboxedVerification;

describe('property mode: options and compile stage', () => {
  it('R5.1 R9.1 invalid options return INVALID_OPTIONS and create no Worker', async () => {
    const before = createdWorkerCount();
    const invalid = [
      options({ numRuns: 99 }),
      options({ seed: 1.5 }),
      options({ entryFunction: 'not valid' }),
      options({ limits: { wallClockTimeoutMs: 99 } }),
      options({ limits: { maxOldGenerationSizeMb: 513 } }),
      options({ legacyCode: '/'.repeat(2000), limits: { maxSourceBytes: 1024 } }),
      null,
    ];
    for (const value of invalid) {
      const result = await run(value as never);
      expect(result).toMatchObject({ status: 'ERROR', code: 'INVALID_OPTIONS', executor: 'sandbox-worker' });
      expectHygienic(result);
    }
    expect(createdWorkerCount()).toBe(before);
  });

  it('R5.12 a type error gives MODERN_COMPILE_ERROR and no Exec_Worker is created', async () => {
    const before = createdWorkerCount();
    const result = await run(options({ modernCode: 'export function f(a: number): string { return a; }' }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'MODERN_COMPILE_ERROR' });
    // Only the Compile_Worker was created.
    expect(createdWorkerCount()).toBe(before + 1);
  });

  it('R5.12 an import gives MODERN_COMPILE_ERROR and no Exec_Worker is created', async () => {
    const before = createdWorkerCount();
    const result = await run(options({ modernCode: "import { readFileSync } from 'node:fs';\nexport function f(a: number): number { return a; }" }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'MODERN_COMPILE_ERROR' });
    expect(createdWorkerCount()).toBe(before + 1);
  });

  it('R5.10 a type-check that exceeds compileTimeoutMs gives SANDBOX_TIMEOUT and the Compile_Worker is terminated', async () => {
    const live = await settledWorkerCount(0);
    const before = createdWorkerCount();
    // 200 large template-literal unions: several seconds of type-checking.
    const digits = "type D = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9';";
    const unions = Array.from({ length: 200 }, (_, i) => `type U${i} = Extract<\`${'x'.repeat((i % 3) + 1)}\${D}\${D}\${D}\${D}\`, \`\${string}\${D}\`>;`);
    const all = `type All = [${unions.map((_, i) => `U${i}`).join(', ')}];`;
    const modernCode = [digits, ...unions, all, 'export function f(a: number): number { const q: All | undefined = undefined; return q === undefined ? a : 0; }'].join('\n');
    const result = await run(options({ modernCode, limits: { compileTimeoutMs: 1000 } }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_TIMEOUT' });
    if (result.status === 'ERROR') expect(result.message).toContain('compile stage');
    expect(createdWorkerCount()).toBe(before + 1);
    expect(await settledWorkerCount(live)).toBe(live);
  });
});

describe('property mode: results', () => {
  it('R9.5 an equivalent pair gives PASSED with the requested runs, the seed, and the evidence text', async () => {
    const result = await run(options());
    expect(result).toEqual({
      status: 'PASSED',
      executor: 'sandbox-worker',
      totalRuns: 100,
      seed: 42,
      executionTimeMs: expect.any(Number),
      evidence: 'Verified behavioral equivalence across 100 generated inputs (seed 42).',
    });
    expectHygienic(result);
  });

  it('R9.5 a differing pair gives FAILED with a bounded, shrunk counterexample', async () => {
    const result = await run(options(DOUBLE_DIFFERENT));
    expect(result).toMatchObject({
      status: 'FAILED',
      executor: 'sandbox-worker',
      seed: 42,
      counterexample: { input: '101', legacyOutcome: 'returned: 202', modernOutcome: 'returned: 0', shrunk: true },
    });
    expectHygienic(result);
  });

  it('R9.8 the same options and seed give the same status, runs, and counterexample', async () => {
    // Feature: 07-sandboxed-execution, Property 5: Seed determinism
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(DOUBLE, DOUBLE_DIFFERENT), fc.integer(), async (pair, seed) => {
        const first = await run(options({ ...pair, seed }));
        const second = await run(options({ ...pair, seed }));
        const key = (r: typeof first) => JSON.stringify([r.status, 'totalRuns' in r ? r.totalRuns : null, r.status === 'FAILED' ? r.counterexample.input : null]);
        return first.status !== 'ERROR' && key(first) === key(second);
      }),
      { numRuns: 4 },
    );
  });

  it('R9.9 the Sandbox and the Verifier agree on status, runs, and counterexample input', async () => {
    // Feature: 07-sandboxed-execution, Property 6: Parity with the Verifier
    const templates = [
      { legacy: 'function f(a) { return a * 3 + 1; }', same: 'return a * 3 + 1;', different: 'return a > 50 ? a * 3 : a * 3 + 1;', type: 'number', arbitrary: 'fc.integer()' },
      { legacy: 'function f(a) { return a.split("").reverse().join(""); }', same: 'return [...a].reverse().join("");', different: 'return a.length > 3 ? a : a.split("").reverse().join("");', type: 'string', arbitrary: 'fc.string({ unit: "grapheme-ascii" })' },
      { legacy: 'function f(a) { var out = []; for (var i = 0; i < a.length; i++) out.push(a[i] * 2); return out; }', same: 'return a.map((x) => x * 2);', different: 'return a.length > 2 ? [] : a.map((x) => x * 2);', type: 'number[]', arbitrary: 'fc.array(fc.integer())' },
    ];
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...templates), fc.boolean(), fc.integer(), async (template, equivalent, seed) => {
        const shared = {
          legacyCode: template.legacy,
          modernCode: `export function f(a: ${template.type}): unknown { ${equivalent ? template.same : template.different} }`,
          entryFunction: 'f',
          testCode: `return fc.property(${template.arbitrary}, function (a) { assertEquivalent(a); });`,
          numRuns: 100,
          seed,
        };
        const sandbox = await run({ ...shared, limits: { wallClockTimeoutMs: 3000 } });
        const verifier = await verifyTestCode({ ...shared, origin: 'sample' });
        if (sandbox.status === 'ERROR' || verifier.status === 'ERROR') return false;
        return (
          sandbox.status === verifier.status &&
          sandbox.totalRuns === verifier.totalRuns &&
          (sandbox.status === 'FAILED' ? sandbox.counterexample.input : '') === (verifier.status === 'FAILED' ? verifier.counterexample.input : '')
        );
      }),
      { numRuns: 8 },
    );
  });

  it('R9.10 the evidence text is the one of the Verifier and holds no Forbidden_Phrase', async () => {
    // Feature: 07-sandboxed-execution, Property 10: Evidence text
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(DOUBLE, DOUBLE_DIFFERENT), fc.integer({ min: 100, max: 300 }), fc.integer(), async (pair, numRuns, seed) => {
        const result = await run(options({ ...pair, numRuns, seed }));
        if (result.status === 'ERROR') return false;
        const lower = result.evidence.toLowerCase();
        return result.evidence === formatEvidence(result) && FORBIDDEN_PHRASES.every((phrase) => !lower.includes(phrase));
      }),
      { numRuns: 4 },
    );
  });

  it('R2.8 a Forbidden_Phrase thrown by legacy code is redacted from the result', async () => {
    const result = await run(options({ legacyCode: 'throw new Error("This is 100% guaranteed, a mathematical proof.");', modernCode: MODERN_STUB }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'LEGACY_LOAD_ERROR' });
    if (result.status === 'ERROR') expect(result.message).toContain('[redacted]');
    expectHygienic(result);
    expect('evidence' in result).toBe(false);
  });

  it.each(VERIFIER_FIXTURES)('R12.6 the Verifier fixture $name passes with 1,000 runs', async (fixture) => {
    const code = { legacyCode: fixture.legacyCode, modernCode: fixture.modernCode, testCode: fixture.testCode, entryFunction: fixture.entryFunction };
    const result = await run({ ...code, numRuns: 1000, seed: 7, limits: { wallClockTimeoutMs: 20_000 } });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 1000, executor: 'sandbox-worker' });
  });

  it.each(SEED_SAMPLES)('R9.2 the Test_Code of the Foundation seed sample $name runs unchanged', async (sample) => {
    const code = { legacyCode: sample.legacyCode, modernCode: sample.modernCode, testCode: sample.testCode, entryFunction: sample.entryFunction };
    const result = await run({ ...code, numRuns: 100, seed: 11, allowDynamicCode: true, limits: { wallClockTimeoutMs: 20_000 } });
    expect(result).toMatchObject({ status: 'PASSED', totalRuns: 100 });
  });
});

describe('property mode: Test_Code and load errors', () => {
  const testCodeErrors: [string, string, RegExp][] = [
    ['a syntax error', 'return fc.property(', /does not compile: SyntaxError/],
    ['a body that closes the function early', '}); (function () {', /does not compile/],
    ['a throw while building the property', 'throw new RangeError("nope");', /while building the property: RangeError: nope/],
    ['a value that is not a property', 'return 5;', /did not return a fast-check property/],
    ['an unrelated throw inside the predicate', 'return fc.property(fc.integer(), function () { throw new TypeError("unrelated"); });', /unexpected error: TypeError: unrelated/],
    ['a direct call that throws', 'return fc.property(fc.integer(), function (n) { return legacyFn(n) === 1; });', /called the legacy function directly and it threw RangeError/],
  ];
  it.each(testCodeErrors)('R9.6 %s gives TEST_CODE_ERROR', async (_label, testCode, pattern) => {
    const legacyCode = testCode.includes('legacyFn') ? 'function f(a) { throw new RangeError("x"); }' : DOUBLE.legacyCode;
    const result = await run(options({ testCode, legacyCode }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'TEST_CODE_ERROR' });
    if (result.status === 'ERROR') expect(result.message).toMatch(pattern);
    expectHygienic(result);
  });

  it('R9.7 an async property that settles by microtasks is supported', async () => {
    const testCode = 'return fc.asyncProperty(fc.integer(), function (n) { return Promise.resolve().then(function () { assertEquivalent(n); }); });';
    expect(await run(options({ testCode }))).toMatchObject({ status: 'PASSED', totalRuns: 100 });
    expect(await run(options({ ...DOUBLE_DIFFERENT, testCode }))).toMatchObject({ status: 'FAILED', counterexample: { input: '101' } });
  });

  it('R9.7 an async property that does not settle by microtasks gives TEST_CODE_ERROR', async () => {
    const testCode = 'return fc.asyncProperty(fc.integer(), function () { return new Promise(function () {}); });';
    const result = await run(options({ testCode }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'TEST_CODE_ERROR' });
    if (result.status === 'ERROR') expect(result.message).toContain('Asynchronous work outside microtasks is not supported');
  });

  it('R9.6 a predicate that returns false gives FAILED', async () => {
    const result = await run(options({ testCode: 'return fc.property(fc.integer(), function (n) { return n < 10; });' }));
    expect(result).toMatchObject({ status: 'FAILED', counterexample: { input: '10', legacyOutcome: 'unavailable', modernOutcome: 'unavailable' } });
  });

  it('R9.3 the Test_Code controls neither the run count nor the seed', async () => {
    const testCode = 'fc.configureGlobal({ numRuns: 3, seed: 1, endOnFailure: true }); return fc.property(fc.integer(), function (n) { assertEquivalent(n); });';
    expect(await run(options({ testCode }))).toMatchObject({ status: 'PASSED', totalRuns: 100, seed: 42 });
  });

  it('R5.3 a timeout during shrinking returns FAILED with the smallest counterexample recorded', async () => {
    // The legacy function starts to hang a few calls after the first difference, while fast-check shrinks.
    const legacyCode = 'var differing = 0; function f(n) { if (n >= 1000) { differing++; if (differing > 3) { for (;;) {} } return -1; } return n; }';
    const result = await run(options({
      legacyCode,
      modernCode: 'export function f(n: number): number { return n; }',
      testCode: 'return fc.property(fc.integer({ min: 0, max: 1000000 }), function (n) { assertEquivalent(n); });',
      limits: QUICK,
    }));
    expect(result).toMatchObject({ status: 'FAILED', counterexample: { legacyOutcome: 'returned: -1' } });
    expectHygienic(result);
  });

  it('R5.3 a timeout before any difference gives SANDBOX_TIMEOUT and names the side', async () => {
    const result = await run(options({ legacyCode: 'function f(a) { for (;;) {} }', limits: QUICK }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'SANDBOX_TIMEOUT' });
    if (result.status === 'ERROR') expect(result.message).toContain('legacy');
    const modern = await run(options({ modernCode: 'export function f(a: number): number { for (;;) {} }', limits: QUICK }));
    if (modern.status === 'ERROR') expect(modern.message).toContain('modern');
    const test = await run(options({ testCode: 'for (;;) {}', limits: QUICK }));
    expect(test).toMatchObject({ code: 'SANDBOX_TIMEOUT' });
    if (test.status === 'ERROR') expect(test.message).toContain('test');
  });

  it('R6.5 a load error carries the name and the message, and no stack or path', async () => {
    const legacy = await run(options({ legacyCode: 'var x = null; x.y();', modernCode: MODERN_STUB }));
    expect(legacy).toMatchObject({ code: 'LEGACY_LOAD_ERROR' });
    if (legacy.status === 'ERROR') expect(legacy.message).toMatch(/threw while loading: TypeError: /);
    expectHygienic(legacy);

    const syntax = await run(options({ legacyCode: 'function f( {', modernCode: MODERN_STUB }));
    expect(syntax).toMatchObject({ code: 'LEGACY_LOAD_ERROR' });
    if (syntax.status === 'ERROR') expect(syntax.message).toMatch(/could not be loaded: SyntaxError/);

    const modern = await run(options({ modernCode: 'export function f(a: number): number { return a; }\nthrow new RangeError("at load");' }));
    expect(modern).toMatchObject({ code: 'MODERN_LOAD_ERROR' });
    if (modern.status === 'ERROR') expect(modern.message).toContain('RangeError: at load');

    const long = await run(options({ legacyCode: `throw new Error("${'m'.repeat(900)}");`, modernCode: MODERN_STUB }));
    if (long.status === 'ERROR') expect(long.message.length).toBeLessThanOrEqual(500);
    expectHygienic(long);
  });

  it('R4.9 a missing Entry_Function names the side', async () => {
    const legacy = await run(options({ legacyCode: 'function other() {}' }));
    expect(legacy).toMatchObject({ code: 'ENTRY_FUNCTION_NOT_FOUND' });
    if (legacy.status === 'ERROR') expect(legacy.message).toContain('legacy code');
    const modern = await run(options({ modernCode: 'export function other(a: number): number { return a; }' }));
    expect(modern).toMatchObject({ code: 'ENTRY_FUNCTION_NOT_FOUND' });
    if (modern.status === 'ERROR') expect(modern.message).toContain('modern code');
  });

  it('R7.3 a generator that yields a function gives UNSUPPORTED_VALUE', async () => {
    const result = await run(options({ testCode: 'return fc.property(fc.constant(function () {}), function (v) { assertEquivalent(v); });', modernCode: MODERN_STUB, legacyCode: 'function f(a) { return a; }' }));
    expect(result).toMatchObject({ status: 'ERROR', code: 'UNSUPPORTED_VALUE' });
  });

  it('R4.10 a function that mutates its input does not change the verdict', async () => {
    const result = await run(options({
      legacyCode: 'function f(a) { a.push(1); a.sort(); return a.length; }',
      modernCode: 'export function f(a: number[]): number { return a.length + 1; }',
      testCode: 'return fc.property(fc.array(fc.integer()), function (a) { assertEquivalent(a); });',
    }));
    expect(result).toMatchObject({ status: 'PASSED' });
  });
});
