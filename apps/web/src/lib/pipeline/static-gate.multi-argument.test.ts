// 11-multi-argument-entry, Requirement 3: the Static_Gate rule for the comparison helper, the reincarnate prompt, and
// the wiring of the route.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, makeCorpse, requestFor, seanceRow, validReincarnationOutput } from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { buildReincarnatePrompts, REINCARNATE_INSTRUCTIONS, RULE_HINTS } from './prompts';
import { handleReincarnate } from './routes/reincarnate';
import { runStaticGate } from './static-gate';

const MODERN = 'export function calc(a: number, b: number): number {\n  return a + b;\n}\n';

const TESTS = {
  single: 'return fc.property(fc.integer(), (input) => {\n  assertEquivalent(input);\n});\n',
  args: 'return fc.property(fc.tuple(fc.integer(), fc.integer()), (args) => {\n  assertEquivalentArgs(args);\n});\n',
  both: 'return fc.property(fc.tuple(fc.integer(), fc.integer()), (args) => {\n  assertEquivalentArgs(args);\n  assertEquivalent(args[0]);\n});\n',
} as const;
type Use = keyof typeof TESTS;

function helperRules(count: number | null, use: Use): string[] {
  const verdict = runStaticGate({ modernCode: MODERN, pbtTestCode: TESTS[use] }, 'calc', { entryParamCount: count });
  return verdict.ok ? [] : verdict.failedRules.filter((rule) => rule.startsWith('TEST_ASSERT'));
}

describe('Static_Gate helper rule', () => {
  it('R3.3 R3.4 reports TEST_ASSERT_EQUIVALENT_ARGS if and only if a Multi_Parameter test does not use only assertEquivalentArgs', () => {
    // Feature: 11-multi-argument-entry, Property 4: Static_Gate helper rule
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), fc.constantFrom<Use>('single', 'args', 'both'), (count, use) => {
        const rules = helperRules(count, use);
        const expectArgsRule = count >= 2 && use !== 'args';
        const expectSingleRule = count < 2 && use === 'args';
        expect(rules.includes('TEST_ASSERT_EQUIVALENT_ARGS')).toBe(expectArgsRule);
        expect(rules.includes('TEST_ASSERT_EQUIVALENT')).toBe(expectSingleRule);
      }),
      { numRuns: 100 },
    );
  });

  it('R3.4 an unknown parameter count keeps the rules of 05', () => {
    expect(helperRules(null, 'single')).toEqual([]);
    expect(helperRules(null, 'args')).toEqual(['TEST_ASSERT_EQUIVALENT']);
  });
});

describe('reincarnate prompt', () => {
  const input = {
    sourceLanguage: 'es5-jquery' as const,
    originalCode: 'function calc(a, b) { return a + b; }',
    requirementsMd: 'r',
    designMd: 'd',
    invariantsJsonText: '{}',
    curses: [],
  };

  it('R3.1 holds the Entry_Params as JSON before the untrusted blocks, and nothing when they are unknown', () => {
    const { prompt } = buildReincarnatePrompts({ ...input, entryParams: ['a', 'b'] }, 'LAZARUS-UNTRUSTED-x', null);
    const lines = prompt.split('\n');
    const at = lines.indexOf('["a","b"]');
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1]).toContain('derived from the untrusted code');
    expect(at).toBeLessThan(lines.indexOf('LAZARUS-UNTRUSTED-x'));
    expect(buildReincarnatePrompts({ ...input, entryParams: null }, 'LAZARUS-UNTRUSTED-x', null).prompt).not.toContain('Entry parameters');
  });

  it('R3.2 the instructions describe both helpers and keep the parameters', () => {
    expect(REINCARNATE_INSTRUCTIONS).toContain('sixth parameter, assertEquivalentArgs');
    expect(REINCARNATE_INSTRUCTIONS).toContain('no parameter or one parameter, the property calls assertEquivalent(input)');
    expect(REINCARNATE_INSTRUCTIONS).toContain('two or more parameters, the property calls assertEquivalentArgs(args)');
    expect(REINCARNATE_INSTRUCTIONS).toContain('keeps the parameters of the legacy function, in the same order');
  });

  it('R3.2 the Multi_Parameter example passes the Static_Gate with three parameters', () => {
    const lines = REINCARNATE_INSTRUCTIONS.split('\n');
    const start = lines.findIndex((line) => line.startsWith('Example of a valid pbtTestCode for an entry function with the parameters'));
    expect(start).toBeGreaterThan(-1);
    const example = lines.slice(start + 1, start + 5).join('\n');
    const modernCode = 'export function calculateShipping(weightKg: number, zone: string, isExpress: boolean): number {\n  return isExpress ? weightKg : zone.length;\n}\n';
    expect(runStaticGate({ modernCode, pbtTestCode: example }, 'calculateShipping', { entryParamCount: 3 })).toEqual({ ok: true });
  });

  it('R3.5 the retry hint explains TEST_ASSERT_EQUIVALENT_ARGS', () => {
    expect(RULE_HINTS.TEST_ASSERT_EQUIVALENT_ARGS).toContain('assertEquivalentArgs(args)');
  });
});

describe('POST /api/reincarnate wiring', () => {
  const call = async (h: ReturnType<typeof buildHarness>) =>
    checkResponse(await handleReincarnate(requestFor('reincarnate', bodyFor(makeCorpse().id)), h.deps), []);

  it('R3.1 R3.3 sends the parameters of calc(a, b) and repairs a one-argument test with the new rule', async () => {
    const oneArgument = { ...validReincarnationOutput(), pbtTestCode: 'return fc.property(fc.tuple(fc.integer(), fc.integer()), (input) => {\n  assertEquivalent(input);\n});\n' };
    const h = buildHarness({
      seances: [seanceRow(makeCorpse().id)],
      script: [outcomeFor('ok', oneArgument), outcomeFor('ok', validReincarnationOutput())],
    });
    const result = await call(h);
    expect(result.body).toMatchObject({ ok: true, source: 'generated' });
    expect(h.gateway.calls).toHaveLength(2);
    expect(h.gateway.calls[0]!.prompt).toContain('["a","b"]');
    expect(h.gateway.calls[1]!.prompt).toContain('TEST_ASSERT_EQUIVALENT_ARGS');
  });
});
