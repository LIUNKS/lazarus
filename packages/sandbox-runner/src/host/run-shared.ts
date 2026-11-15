import { sanitizeResult, type VerificationResult } from '@lazarus/pbt-verifier/shared';
import type { DenialReason, Executor, ResolvedLimits, SandboxErrorCode, SandboxErrorResult, SharedErrorCode } from '../types.js';
import type { SpawnLimits, WorkerEnd } from './supervisor.js';

const MAX_MESSAGE = 500;
/** The host waits this long after the wall-clock limit before it terminates the Worker. */
export const KILL_GRACE_MS = 2_000;

export interface Failure {
  code: SandboxErrorCode | SharedErrorCode;
  message: string;
}

export function errorResult(failure: Failure, executor: Executor, reason?: DenialReason): SandboxErrorResult {
  const message = failure.message.length > MAX_MESSAGE ? `${failure.message.slice(0, MAX_MESSAGE - 3)}...` : failure.message;
  return {
    status: 'ERROR',
    executor,
    code: failure.code,
    message: message === '' ? 'The run failed.' : message,
    executionTimeMs: 0,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * Last step of every run: sets `executionTimeMs` (measured on the host, 1 to 600000) and redacts
 * Forbidden_Phrases from every string, with the sanitizer of the Verifier.
 */
export function finalize<T extends { executionTimeMs: number }>(result: T, startedAt: number): T {
  const elapsed = Math.round(performance.now() - startedAt);
  const timed = { ...result, executionTimeMs: Math.min(600_000, Math.max(1, elapsed)) };
  return sanitizeResult(timed as unknown as VerificationResult) as unknown as T;
}

/** Limits for an Exec_Worker. The kill timer is the wall-clock limit plus the kill grace. */
export function execSpawnLimits(limits: ResolvedLimits): SpawnLimits {
  return {
    killAfterMs: limits.wallClockTimeoutMs + KILL_GRACE_MS,
    maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
    maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
    maxExternalMemoryMb: limits.maxExternalMemoryMb,
    maxResultBytes: limits.maxResultBytes,
  };
}

/** The result for every way a Worker can end without a usable message. */
export function failureOfEnd(end: Exclude<WorkerEnd, { kind: 'message' }>, stage: 'compile' | 'run'): Failure {
  switch (end.kind) {
    case 'timeout':
      return {
        code: 'SANDBOX_TIMEOUT',
        message:
          stage === 'compile'
            ? 'The compile stage did not finish within the limit "compileTimeoutMs".'
            : 'The run did not finish within the wall-clock limit and was stopped by the host.',
      };
    case 'oom':
      return { code: 'SANDBOX_OUT_OF_MEMORY', message: `The ${stage} stage reached its memory limit.` };
    case 'output-limit':
      return { code: 'OUTPUT_LIMIT_EXCEEDED', message: 'The result is larger than the limit "maxResultBytes".' };
    case 'unavailable':
      return { code: 'SANDBOX_UNAVAILABLE', message: 'The sandbox worker files could not be loaded. Build the package first.' };
    case 'crash':
      return { code: 'SANDBOX_CRASH', message: `The ${stage} stage ended without a result.` };
  }
}

/** Name and message only, for an unexpected exception in the host code. Never a stack or a path. */
export function internalFailure(error: unknown): Failure {
  const name = error instanceof Error ? error.name : 'Error';
  return { code: 'INTERNAL_ERROR', message: `The sandbox runner failed unexpectedly (${name}).` };
}
