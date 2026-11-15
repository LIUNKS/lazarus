import { formatEvidence } from '@lazarus/pbt-verifier/shared';
import { compileStage } from './host/compile-stage.js';
import { parsePropertyResult } from './host/result-parser.js';
import { errorResult, execSpawnLimits, failureOfEnd, finalize, internalFailure } from './host/run-shared.js';
import { spawnRun } from './host/supervisor.js';
import { resolveVerifyOptions } from './options.js';
import type { SandboxResult, SandboxVerifyOptions } from './types.js';

const EXECUTOR = 'sandbox-worker' as const;

/**
 * Property mode (Requirement 9): runs the stored Test_Code with fast-check entirely inside the
 * Sandbox and returns a result shaped like the Verifier's. It never throws and never rejects.
 */
export async function runSandboxedVerification(options: SandboxVerifyOptions): Promise<SandboxResult> {
  const startedAt = performance.now();
  try {
    const resolved = resolveVerifyOptions(options);
    if (!resolved.ok) return finalize(errorResult(resolved, EXECUTOR), startedAt);
    const { legacyCode, modernCode, entryFunction, testCode, numRuns, seed, allowDynamicCode, limits } = resolved.value;

    // No Exec_Worker is created when the compile stage fails (Requirement 5, criterion 12).
    const compiled = await compileStage(modernCode, entryFunction, limits);
    if (!compiled.ok) return finalize(errorResult(compiled, EXECUTOR), startedAt);

    const end = await spawnRun(
      'exec',
      {
        mode: 'property',
        legacyCode,
        modernJs: compiled.js,
        entryFunction,
        testCode,
        numRuns,
        seed,
        allowDynamicCode,
        wallClockTimeoutMs: limits.wallClockTimeoutMs,
        caseTimeoutMs: limits.caseTimeoutMs,
        maxValueBytes: limits.maxValueBytes,
        maxResultBytes: limits.maxResultBytes,
        inputs: '[]',
      },
      execSpawnLimits(limits),
    );
    if (end.kind !== 'message') return finalize(errorResult(failureOfEnd(end, 'run'), EXECUTOR), startedAt);

    const parsed = parsePropertyResult(end.payload, limits.maxResultBytes, numRuns);
    if (!parsed.ok) {
      const message =
        parsed.code === 'OUTPUT_LIMIT_EXCEEDED'
          ? 'The result is larger than the limit "maxResultBytes".'
          : 'The sandbox returned a result that does not have the expected shape.';
      return finalize(errorResult({ code: parsed.code, message }, EXECUTOR), startedAt);
    }

    const value = parsed.value;
    if (value.kind === 'error') return finalize(errorResult(value, EXECUTOR), startedAt);

    if (value.kind === 'passed') {
      const base = { status: 'PASSED' as const, totalRuns: value.totalRuns, seed, executionTimeMs: 0, evidence: '' };
      return finalize({ ...base, executor: EXECUTOR, evidence: formatEvidence(base) }, startedAt);
    }

    const counterexample = {
      input: value.input,
      legacyOutcome: value.legacyOutcome,
      modernOutcome: value.modernOutcome,
      shrunk: value.shrunk,
    };
    const base = { status: 'FAILED' as const, totalRuns: value.totalRuns, seed, executionTimeMs: 0, counterexample, evidence: '' };
    return finalize({ ...base, executor: EXECUTOR, evidence: formatEvidence(base) }, startedAt);
  } catch (error) {
    return finalize(errorResult(internalFailure(error), EXECUTOR), startedAt);
  }
}
