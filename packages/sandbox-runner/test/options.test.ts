import { describe, expect, it } from 'vitest';
import { LIMIT_RANGES, resolveCasesOptions, resolveVerifyOptions } from '../src/options.ts';
import type { ResolvedLimits } from '../src/types.ts';

const base = {
  legacyCode: 'function f(a) { return a; }',
  modernCode: 'export function f(a: number): number { return a; }',
  entryFunction: 'f',
  testCode: 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });',
};

const LIMIT_NAMES = Object.keys(LIMIT_RANGES) as (keyof ResolvedLimits)[];

describe('option validation', () => {
  it('R9.1 applies the defaults of numRuns, seed, allowDynamicCode, and every limit', () => {
    const result = resolveVerifyOptions(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numRuns).toBe(1000);
    expect(Number.isInteger(result.value.seed)).toBe(true);
    expect(result.value.allowDynamicCode).toBe(false);
    expect(result.value.limits).toEqual({
      wallClockTimeoutMs: 10_000,
      caseTimeoutMs: 1_000,
      compileTimeoutMs: 10_000,
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
      maxExternalMemoryMb: 256,
      maxValueBytes: 65_536,
      maxResultBytes: 524_288,
      maxSourceBytes: 262_144,
    });
  });

  it.each(LIMIT_NAMES)('R5.1 accepts the lowest and highest value of %s and rejects one outside', (name) => {
    const { min, max } = LIMIT_RANGES[name];
    for (const value of [min, max]) expect(resolveVerifyOptions({ ...base, limits: { [name]: value } }).ok).toBe(true);
    for (const value of [min - 1, max + 1, min + 0.5, String(min), null, NaN]) {
      const result = resolveVerifyOptions({ ...base, limits: { [name]: value } });
      expect(result).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
      if (!result.ok) expect(result.message).toContain(name);
    }
  });

  it('R9.1 accepts numRuns from 100 to 1000 and rejects values outside or non-integers', () => {
    for (const numRuns of [100, 1000]) expect(resolveVerifyOptions({ ...base, numRuns }).ok).toBe(true);
    for (const numRuns of [99, 1001, 100.5, '100', null]) {
      expect(resolveVerifyOptions({ ...base, numRuns })).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    }
  });

  it('R9.1 accepts a 32-bit signed seed and rejects anything else', () => {
    for (const seed of [-2_147_483_648, 0, 2_147_483_647]) {
      expect(resolveVerifyOptions({ ...base, seed })).toMatchObject({ ok: true, value: { seed } });
    }
    for (const seed of [2_147_483_648, -2_147_483_649, 1.5, '1']) {
      expect(resolveVerifyOptions({ ...base, seed }).ok).toBe(false);
    }
  });

  it('R9.1 rejects an entry function that is not an identifier or is a reserved word', () => {
    for (const entryFunction of ['', '1f', 'a-b', 'a.b', 'f()', 'class', 'return', 5, undefined]) {
      expect(resolveVerifyOptions({ ...base, entryFunction }).ok).toBe(false);
    }
    expect(resolveVerifyOptions({ ...base, entryFunction: '$_ok9' }).ok).toBe(true);
  });

  it('R9.1 rejects code fields that are not strings and a non-boolean allowDynamicCode', () => {
    for (const field of ['legacyCode', 'modernCode', 'testCode']) {
      expect(resolveVerifyOptions({ ...base, [field]: 5 }).ok).toBe(false);
    }
    expect(resolveVerifyOptions({ ...base, allowDynamicCode: 'yes' }).ok).toBe(false);
    expect(resolveVerifyOptions({ ...base, allowDynamicCode: true })).toMatchObject({ value: { allowDynamicCode: true } });
  });

  it('R5.2 rejects a code string longer than maxSourceBytes, counted in UTF-8 bytes', () => {
    const limits = { maxSourceBytes: 1024 };
    expect(resolveVerifyOptions({ ...base, legacyCode: '/'.repeat(1024), limits }).ok).toBe(true);
    for (const field of ['legacyCode', 'modernCode', 'testCode']) {
      const result = resolveVerifyOptions({ ...base, [field]: '/'.repeat(1025), limits });
      expect(result).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    }
    // 342 three-byte characters are 1026 bytes but only 342 UTF-16 units.
    expect(resolveVerifyOptions({ ...base, legacyCode: '€'.repeat(342), limits }).ok).toBe(false);
  });

  it('R2.7 never repeats the code text or the entry function in a message', () => {
    const marker = 'LzSecretMarker77';
    const results = [
      resolveVerifyOptions({ ...base, legacyCode: marker.repeat(200), limits: { maxSourceBytes: 1024 } }),
      resolveVerifyOptions({ ...base, entryFunction: `${marker}-x` }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).not.toContain(marker);
    }
  });

  it('R2.4 never throws for values that are not option objects', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
    for (const value of [undefined, null, 5, 'x', [], hostile]) {
      expect(resolveVerifyOptions(value).ok).toBe(false);
      expect(resolveCasesOptions(value).ok).toBe(false);
    }
  });

  it('R10.1 accepts 1 to 1000 inputs in cases mode and rejects other sizes', () => {
    const cases = { legacyCode: base.legacyCode, modernCode: base.modernCode, entryFunction: 'f' };
    for (const size of [1, 1000]) expect(resolveCasesOptions({ ...cases, inputs: new Array(size).fill(0) }).ok).toBe(true);
    for (const inputs of [[], new Array(1001).fill(0), 'abc', undefined]) {
      expect(resolveCasesOptions({ ...cases, inputs })).toMatchObject({ ok: false, code: 'INVALID_OPTIONS' });
    }
  });
});
