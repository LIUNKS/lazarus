import { verifyTestCode } from '@lazarus/pbt-verifier';
import type { Lease, LiveExecutionGate } from './gate/gate.js';
import { errorResult, finalize, internalFailure } from './host/run-shared.js';
import { runSandboxedVerification } from './property-mode.js';
import type { LiveRequest, SandboxResult } from './types.js';

/**
 * The one entry point for a live run (Requirement 3). The gate decides first. A denied request
 * touches no code and creates no Worker. A sample corpus runs in-process through the Verifier; a
 * user corpus runs only in the Sandbox, and never falls back to in-process execution.
 */
export async function verifyLive(request: LiveRequest, gate: LiveExecutionGate): Promise<SandboxResult> {
  const startedAt = performance.now();
  let lease: Lease | undefined;
  try {
    const acquired = gate.acquire(request);
    if (!acquired.ok) {
      const failure = { code: 'LIVE_EXECUTION_DENIED' as const, message: `Live execution was denied (${acquired.reason}).` };
      return finalize(errorResult(failure, 'none', acquired.reason), startedAt);
    }

    if (acquired.executor === 'in-process') {
      const result = await verifyTestCode({
        origin: 'sample',
        legacyCode: request.legacyCode,
        modernCode: request.modernCode,
        entryFunction: request.entryFunction,
        testCode: request.testCode,
        ...(request.numRuns === undefined ? {} : { numRuns: request.numRuns }),
        ...(request.seed === undefined ? {} : { seed: request.seed }),
      });
      if (result.status !== 'ERROR') return finalize({ ...result, executor: 'in-process' as const }, startedAt);
      // The Verifier has two timeout codes of its own; both are a timeout for the caller.
      const code =
        result.code === 'CALL_TIMEOUT' || result.code === 'TOTAL_TIMEOUT'
          ? 'SANDBOX_TIMEOUT'
          : result.code === 'UNSUPPORTED_ORIGIN'
            ? 'INTERNAL_ERROR'
            : result.code;
      return finalize(errorResult({ code, message: result.message }, 'in-process'), startedAt);
    }

    lease = acquired.lease;
    return await runSandboxedVerification(request);
  } catch (error) {
    return finalize(errorResult(internalFailure(error), 'none'), startedAt);
  } finally {
    // Released on every path: success, timeout, crash, and internal error.
    lease?.release();
  }
}
