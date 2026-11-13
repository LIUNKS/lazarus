import { compileStage } from './host/compile-stage.js';
import { parseCasesResult } from './host/result-parser.js';
import { errorResult, execSpawnLimits, failureOfEnd, finalize, internalFailure } from './host/run-shared.js';
import { spawnRun } from './host/supervisor.js';
import { encodeInput } from './host/tagged-value.js';
import { resolveCasesOptions } from './options.js';
import type { CasesResult, SandboxCasesOptions } from './types.js';

const EXECUTOR = 'sandbox-worker' as const;

/**
 * Cases mode (Requirement 10): runs both functions on explicit inputs and returns one outcome per
 * input. A list of cases is not a verification, so the result has no evidence text.
 */
export async function runSandboxedCases(options: SandboxCasesOptions): Promise<CasesResult> {
  const startedAt = performance.now();
  try {
    const resolved = resolveCasesOptions(options);
    if (!resolved.ok) return finalize(errorResult(resolved, EXECUTOR), startedAt);
    const { legacyCode, modernCode, entryFunction, inputs, allowDynamicCode, limits } = resolved.value;

    // Every input is encoded on the host first, so an unsupported value fails before any Worker exists.
    const encoded: string[] = [];
    let totalBytes = 0;
    for (let index = 0; index < inputs.length; index++) {
      const result = encodeInput(inputs[index], limits.maxValueBytes);
      if (!result.ok) {
        return finalize(errorResult({ code: 'UNSUPPORTED_VALUE', message: `Input ${index}: ${result.message}.` }, EXECUTOR), startedAt);
      }
      totalBytes += Buffer.byteLength(result.text, 'utf8');
      encoded.push(result.text);
    }
    if (totalBytes > limits.maxResultBytes) {
      return finalize(
        errorResult({ code: 'INVALID_OPTIONS', message: 'The encoded inputs are larger than the limit "maxResultBytes".' }, EXECUTOR),
        startedAt,
      );
    }

    const compiled = await compileStage(modernCode, entryFunction, limits);
    if (!compiled.ok) return finalize(errorResult(compiled, EXECUTOR), startedAt);

    const end = await spawnRun(
      'exec',
      {
        mode: 'cases',
        legacyCode,
        modernJs: compiled.js,
        entryFunction,
        testCode: '',
        numRuns: 0,
        seed: 0,
        allowDynamicCode,
        wallClockTimeoutMs: limits.wallClockTimeoutMs,
        caseTimeoutMs: limits.caseTimeoutMs,
        maxValueBytes: limits.maxValueBytes,
        maxResultBytes: limits.maxResultBytes,
        inputs: JSON.stringify(encoded),
      },
      execSpawnLimits(limits),
    );
    if (end.kind !== 'message') return finalize(errorResult(failureOfEnd(end, 'run'), EXECUTOR), startedAt);

    const parsed = parseCasesResult(end.payload, limits.maxResultBytes, encoded.length);
    if (!parsed.ok) {
      const message =
        parsed.code === 'OUTPUT_LIMIT_EXCEEDED'
          ? 'The result is larger than the limit "maxResultBytes".'
          : 'The sandbox returned a result that does not have the expected shape.';
      return finalize(errorResult({ code: parsed.code, message }, EXECUTOR), startedAt);
    }
    if (parsed.value.kind === 'error') return finalize(errorResult(parsed.value, EXECUTOR), startedAt);

    return finalize({ status: 'COMPLETED' as const, executor: EXECUTOR, executionTimeMs: 0, cases: parsed.value.cases }, startedAt);
  } catch (error) {
    return finalize(errorResult(internalFailure(error), EXECUTOR), startedAt);
  }
}
