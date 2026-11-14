// Maps a Sandbox_Result to what the route does next (Requirement 7). Pure and total: any value, including an
// unknown code or a malformed shape, gives a classification and nothing throws. The input is typed `unknown` on
// purpose: only `sandbox.ts` imports the Sandbox_Runner, and the route must not trust the shape of a result.
// The `detail` of a classification goes to the log only. It is a code or a denial reason, never a message.

export type Classification =
  | { kind: 'conclusive'; passed: boolean; totalRuns: number; executionTimeMs: number }
  | { kind: 'inconclusive'; detail: string }
  | { kind: 'denied-disabled' }
  | { kind: 'denied-busy' }
  | { kind: 'unavailable' }
  | { kind: 'internal'; detail: string };

/** Sandbox_Runner codes of a run that started but did not finish with a verdict (Requirement 7 criterion 4). */
export const INCONCLUSIVE_CODES: ReadonlySet<string> = new Set([
  'SANDBOX_TIMEOUT',
  'SANDBOX_OUT_OF_MEMORY',
  'SANDBOX_FORBIDDEN_CAPABILITY',
  'SANDBOX_CRASH',
  'OUTPUT_LIMIT_EXCEEDED',
  'UNSUPPORTED_VALUE',
  'MODERN_COMPILE_ERROR',
  'LEGACY_LOAD_ERROR',
  'ENTRY_FUNCTION_NOT_FOUND',
  'MODERN_LOAD_ERROR',
  'TEST_CODE_ERROR',
]);

const SAFE_DETAIL = /^[A-Z][A-Z_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

/** A code or reason as a log detail, only when it looks like one. Anything else becomes a constant. */
function safeDetail(value: unknown, fallback: string): string {
  return typeof value === 'string' && SAFE_DETAIL.test(value) ? value : fallback;
}

function classify(result: unknown): Classification {
  if (!isRecord(result)) return { kind: 'internal', detail: 'malformed' };
  const { status } = result;

  if (status === 'PASSED' || status === 'FAILED') {
    const { totalRuns, executionTimeMs } = result;
    const passed = status === 'PASSED';
    // Requirement 7 criterion 3. A failed run counts the runs up to the first failure, so it can be below 100.
    const runsOk = passed ? isIntegerIn(totalRuns, 100, 1_000) : isIntegerIn(totalRuns, 1, 1_000);
    if (!runsOk || !isIntegerIn(executionTimeMs, 0, Number.MAX_SAFE_INTEGER)) return { kind: 'internal', detail: 'invalid-values' };
    return { kind: 'conclusive', passed, totalRuns: totalRuns as number, executionTimeMs: executionTimeMs as number };
  }

  if (status !== 'ERROR') return { kind: 'internal', detail: 'malformed' };
  const { code, reason } = result;
  if (code === 'LIVE_EXECUTION_DENIED') {
    if (reason === 'USER_EXECUTION_DISABLED') return { kind: 'denied-disabled' };
    if (reason === 'USER_CONCURRENCY_LIMIT' || reason === 'GLOBAL_CONCURRENCY_LIMIT') return { kind: 'denied-busy' };
    return { kind: 'internal', detail: safeDetail(reason, 'denied') };
  }
  if (code === 'SANDBOX_UNAVAILABLE') return { kind: 'unavailable' };
  if (typeof code === 'string' && INCONCLUSIVE_CODES.has(code)) return { kind: 'inconclusive', detail: code };
  return { kind: 'internal', detail: safeDetail(code, 'unknown-code') };
}

export function classifySandboxResult(result: unknown): Classification {
  try {
    return classify(result);
  } catch {
    // A getter on a hostile value threw. The value cannot be trusted, so nothing is stored.
    return { kind: 'internal', detail: 'malformed' };
  }
}
