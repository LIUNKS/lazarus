import { formatEvidence, sanitizeResult } from './evidence.js';
import {
  normalizeEquivalenceOptions,
  normalizeTestCodeOptions,
  type OptionsResult,
} from './options.js';
import type { RunResult } from './run/execute.js';
import { createRunState, type RunState } from './run/run-state.js';
import { describeThrown } from './sandbox/context.js';
import type {
  ErrorCode,
  VerificationResult,
  VerifyEquivalenceOptions,
  VerifyTestCodeOptions,
} from './types.js';
import { runEquivalence } from './verify-equivalence.js';
import { runTestCode } from './verify-test-code.js';

const MIN_EXECUTION_TIME_MS = 1;
const MAX_EXECUTION_TIME_MS = 600_000;

/** Wall-clock time since the call started: whole milliseconds from 1 to 600000 (Requirement 2, criterion 5). */
function elapsedMs(startedAt: number): number {
  const rounded = Math.round(performance.now() - startedAt);
  return Math.min(MAX_EXECUTION_TIME_MS, Math.max(MIN_EXECUTION_TIME_MS, rounded));
}

function errorResult(code: ErrorCode, message: string, startedAt: number): VerificationResult {
  return { status: 'ERROR', code, message, executionTimeMs: elapsedMs(startedAt) };
}

/** Adds the timing and the evidence sentence to a run result. */
function toVerificationResult(run: RunResult, startedAt: number): VerificationResult {
  if (run.status === 'ERROR') return errorResult(run.code, run.message, startedAt);
  const executionTimeMs = elapsedMs(startedAt);
  if (run.status === 'PASSED') {
    const passed = { ...run, executionTimeMs, evidence: '' };
    return { ...passed, evidence: formatEvidence({ ...passed }) };
  }
  const failed = { ...run, executionTimeMs, evidence: '' };
  return { ...failed, evidence: formatEvidence({ ...failed }) };
}

/**
 * The single flow of both entry points: guard, validate, load the legacy side, load the modern side,
 * build the property, run `fc.check`, classify, sanitize, and time. Whatever happens, the returned
 * promise resolves to a JSON-serializable result (Requirement 2, criteria 7 and 8): an unexpected
 * exception becomes `INTERNAL_ERROR` with the error name and message and no stack trace.
 */
async function runPipeline<T>(
  raw: unknown,
  normalize: (raw: unknown) => OptionsResult<T>,
  run: (options: T, state: RunState) => Promise<RunResult>,
  totalTimeoutOf: (options: T) => number,
): Promise<VerificationResult> {
  const startedAt = performance.now();
  try {
    const normalized = normalize(raw);
    if (!normalized.ok) return sanitizeResult(errorResult(normalized.code, normalized.message, startedAt));
    const state = createRunState(startedAt, totalTimeoutOf(normalized.value));
    const result = toVerificationResult(await run(normalized.value, state), startedAt);
    return sanitizeResult(result);
  } catch (error) {
    return sanitizeResult(errorResult('INTERNAL_ERROR', describeThrown(error), startedAt));
  }
}

/**
 * Programmatic mode (Requirement 7): compares the legacy and the modern function over inputs from
 * `inputArbitrary`. Never throws and never rejects.
 */
export function verifyEquivalence(options: VerifyEquivalenceOptions): Promise<VerificationResult> {
  return runPipeline(
    options,
    normalizeEquivalenceOptions,
    runEquivalence,
    (normalized) => normalized.totalTimeoutMs,
  );
}

/**
 * Stored-test mode (Requirement 8): runs the property that a `pbt_test_code` string builds. Never
 * throws and never rejects.
 */
export function verifyTestCode(options: VerifyTestCodeOptions): Promise<VerificationResult> {
  return runPipeline(
    options,
    normalizeTestCodeOptions,
    runTestCode,
    (normalized) => normalized.totalTimeoutMs,
  );
}
