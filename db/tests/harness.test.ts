// Verification_Suite: the harness that records and replays pbt_test_code (Requirement 20, criteria 7 and 8).
// A harness that cannot fail would make the seeded pbt_passed values meaningless, so these tests prove it can.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deepEquivalent, equivalentOutcomes } from '../harness/deep-equivalent.ts';
import { runPbtTestCode } from '../harness/pbt-runner.ts';
import { typecheckStrict } from '../harness/typecheck.ts';

const LEGACY = 'function double(x) { return x * 2; }';
const TEST_CODE = `return fc.property(fc.integer({ min: -1000, max: 1000 }), (x) => { assertEquivalent(x); });`;

const base = {
  legacyCode: LEGACY,
  entryFunction: 'double',
  testCode: TEST_CODE,
  numRuns: 100,
  seed: 42,
};

describe('R20.7 PBT harness', () => {
  it('R20.7 reports a pass and the exact run count for an equivalent implementation', async () => {
    const result = await runPbtTestCode({
      ...base,
      modernCode: 'export function double(x: number): number { return x * 2; }',
    });
    expect(result.passed).toBe(true);
    expect(result.totalRuns).toBe(100);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(1);
  });

  it('R20.7 reports a failure when the implementations differ for some inputs', async () => {
    const result = await runPbtTestCode({
      ...base,
      modernCode: 'export function double(x: number): number { return x < 0 ? x * 3 : x * 2; }',
    });
    expect(result.passed).toBe(false);
    expect(result.message).toContain('Outcomes differ');
  });

  it('R20.7 refuses modern code that does not compile under strict mode', async () => {
    await expect(
      runPbtTestCode({ ...base, modernCode: 'export function double(x) { return x * 2; }' }),
    ).rejects.toThrow(/strict/);
  });

  it('R20.7 treats a different thrown error name as a difference', async () => {
    const result = await runPbtTestCode({
      ...base,
      legacyCode: 'function double(x) { if (x === 0) { throw new TypeError("zero"); } return x * 2; }',
      testCode: 'return fc.property(fc.constant(0), (x) => { assertEquivalent(x); });',
      modernCode: 'export function double(x: number): number { if (x === 0) { throw new RangeError("zero"); } return x * 2; }',
    });
    expect(result.passed).toBe(false);
  });
});

describe('R20.7 outcome comparison', () => {
  it('R20.7 compares values structurally across vm realms and ignores prototypes', () => {
    const foreign = vm.runInNewContext('({ list: [1, 2, { a: NaN }], when: new Date(5) })') as unknown;
    expect(deepEquivalent(foreign, { list: [1, 2, { a: NaN }], when: new Date(5) })).toBe(true);
  });

  it('R20.7 treats NaN as equal to NaN and +0 as different from -0', () => {
    expect(deepEquivalent(NaN, NaN)).toBe(true);
    expect(deepEquivalent(0, -0)).toBe(false);
  });

  it('R20.7 never treats a returned value and a thrown value as equivalent', () => {
    expect(equivalentOutcomes({ kind: 'returned', value: 1 }, { kind: 'threw', name: 'Error' })).toBe(false);
    expect(equivalentOutcomes({ kind: 'threw', name: 'Error' }, { kind: 'threw', name: 'Error' })).toBe(true);
  });

  it('R20.7 reports strict type errors with line and column', () => {
    const errors = typecheckStrict('export const value: number = "text";');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^1:\d+ TS2322/);
  });
});
