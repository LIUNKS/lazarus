import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { liveWorkerCount } from '../../src/host/supervisor.ts';
import type { SandboxLimits, SandboxVerifyOptions } from '../../src/types.ts';

/** Small memory limits, with enough time for a normal run on a busy host. */
export const SMALL: SandboxLimits = { wallClockTimeoutMs: 5000, maxOldGenerationSizeMb: 32, caseTimeoutMs: 1000 };

/** For tests that expect a timeout: the run is cut short quickly. */
export const QUICK: SandboxLimits = { wallClockTimeoutMs: 400, maxOldGenerationSizeMb: 32, caseTimeoutMs: 200 };

export const INTEGER_TEST = 'return fc.property(fc.integer(), function (n) { assertEquivalent(n); });';

export const DOUBLE = {
  legacyCode: 'function f(a) { return a * 2; }',
  modernCode: 'export function f(a: number): number { return a + a; }',
  entryFunction: 'f',
};

/** Same as DOUBLE, but the modern version differs for inputs above 100. */
export const DOUBLE_DIFFERENT = { ...DOUBLE, modernCode: 'export function f(a: number): number { return a > 100 ? 0 : a * 2; }' };

export function options(overrides: Partial<SandboxVerifyOptions> = {}): SandboxVerifyOptions {
  return { ...DOUBLE, testCode: INTEGER_TEST, numRuns: 100, seed: 42, limits: SMALL, ...overrides };
}

/** A modern module that type-checks and is never the point of a test about the legacy side. */
export const MODERN_STUB = 'export function f(a: unknown): unknown { return a; }';

const read = (url: URL): string => readFileSync(url, 'utf8');

export interface Fixture {
  name: string;
  legacyCode: string;
  modernCode: string;
  testCode: string;
  entryFunction: string;
}

function loadFixture(name: string, directory: URL): Fixture {
  const modernCode = read(new URL('modern.ts', directory));
  const entry = /export function (\w+)/.exec(modernCode);
  if (entry === null) throw new Error(`No exported function in the fixture ${name}`);
  return {
    name,
    legacyCode: read(new URL('legacy.js', directory)),
    modernCode,
    testCode: read(new URL('test-code.js', directory)),
    entryFunction: entry[1]!,
  };
}

/** The three fixtures of 03-pbt-verifier, read as text (Requirement 12, criterion 6). */
export const VERIFIER_FIXTURES: Fixture[] = ['es3', 'es5-jquery', 'legacy-node'].map((name) =>
  loadFixture(name, new URL(`../../../pbt-verifier/test/fixtures/${name}/`, import.meta.url)),
);

/** The three sample corpses of the Foundation seed, read as text. */
export const SEED_SAMPLES: Fixture[] = ['batch-calculator', 'invoice-totals', 'query-string-parser'].map((name) =>
  loadFixture(name, new URL(`../../../../db/seed/${name}/`, import.meta.url)),
);

export const FORBIDDEN_PHRASES = ['100%', 'mathematical proof', 'mathematically proven', 'guaranteed'];

/** Result hygiene of Requirement 2: JSON-serializable, bounded, no stack, no host path, no phrase. */
export function expectHygienic(result: unknown): void {
  const text = JSON.stringify(result);
  expect(JSON.parse(text)).toEqual(result);
  expect(text).not.toMatch(/\n\s+at |node:internal|[A-Za-z]:\\\\|\/(home|Users|usr|var|tmp)\/|file:\/\//);
  for (const phrase of FORBIDDEN_PHRASES) expect(text.toLowerCase()).not.toContain(phrase);
  const record = result as { status: string; message?: string; executionTimeMs: number };
  expect(Number.isInteger(record.executionTimeMs)).toBe(true);
  expect(record.executionTimeMs).toBeGreaterThanOrEqual(1);
  expect(record.executionTimeMs).toBeLessThanOrEqual(600_000);
  if (record.status === 'ERROR') {
    expect(typeof record.message).toBe('string');
    expect(record.message!.length).toBeGreaterThan(0);
    expect(record.message!.length).toBeLessThanOrEqual(500);
  }
}

/** Waits until every Worker of earlier runs has exited, then reports the count. */
export async function settledWorkerCount(expected: number): Promise<number> {
  for (let i = 0; i < 100 && liveWorkerCount() !== expected; i++) await new Promise((resolve) => setTimeout(resolve, 20));
  return liveWorkerCount();
}
