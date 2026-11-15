import type * as fc from 'fast-check';
import { normalizeEquivalenceOptions, normalizeTestCodeOptions } from '../../src/options.ts';
import type { RunResult } from '../../src/run/execute.ts';
import { createRunState } from '../../src/run/run-state.ts';
import { runEquivalence } from '../../src/verify-equivalence.ts';
import { runTestCode } from '../../src/verify-test-code.ts';

export interface PairOptions {
  legacyCode: string;
  modernCode: string;
  entryFunction?: string;
  numRuns?: number;
  seed?: number;
  callTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/** Validates the options like the pipeline does, starts the clock, and runs the programmatic mode. */
export async function runEq(
  pair: PairOptions & { inputArbitrary: fc.Arbitrary<unknown> },
): Promise<RunResult> {
  const startedAt = performance.now();
  const normalized = normalizeEquivalenceOptions({
    origin: 'sample',
    entryFunction: 'f',
    numRuns: 100,
    seed: 1,
    ...pair,
  });
  if (!normalized.ok) throw new Error(`Invalid test options: ${normalized.message}`);
  return runEquivalence(normalized.value, createRunState(startedAt, normalized.value.totalTimeoutMs));
}

/** Same as `runEq` for the stored-test mode. */
export async function runTc(pair: PairOptions & { testCode: string }): Promise<RunResult> {
  const startedAt = performance.now();
  const normalized = normalizeTestCodeOptions({
    origin: 'sample',
    entryFunction: 'f',
    numRuns: 100,
    seed: 1,
    ...pair,
  });
  if (!normalized.ok) throw new Error(`Invalid test options: ${normalized.message}`);
  return runTestCode(normalized.value, createRunState(startedAt, normalized.value.totalTimeoutMs));
}

/** Narrows a result to `FAILED` or fails the test with the actual result. */
export function expectFailed(result: RunResult): Extract<RunResult, { status: 'FAILED' }> {
  if (result.status !== 'FAILED') throw new Error(`Expected FAILED, got ${JSON.stringify(result)}`);
  return result;
}

export function expectError(result: RunResult): Extract<RunResult, { status: 'ERROR' }> {
  if (result.status !== 'ERROR') throw new Error(`Expected ERROR, got ${JSON.stringify(result)}`);
  return result;
}
