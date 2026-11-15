import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifySandboxResult, INCONCLUSIVE_CODES, type Classification } from './classify';

const SANDBOX_CODES = [
  'LIVE_EXECUTION_DENIED', 'SANDBOX_UNAVAILABLE', 'SANDBOX_TIMEOUT', 'SANDBOX_OUT_OF_MEMORY', 'SANDBOX_FORBIDDEN_CAPABILITY',
  'SANDBOX_CRASH', 'OUTPUT_LIMIT_EXCEEDED', 'UNSUPPORTED_VALUE', 'INVALID_OPTIONS', 'LEGACY_LOAD_ERROR', 'ENTRY_FUNCTION_NOT_FOUND',
  'MODERN_COMPILE_ERROR', 'MODERN_LOAD_ERROR', 'TEST_CODE_ERROR', 'INTERNAL_ERROR',
];
const REASONS = ['INVALID_REQUEST', 'ANONYMOUS_NOT_ALLOWED', 'AUTH_REQUIRED', 'USER_EXECUTION_DISABLED', 'NOT_OWNER', 'USER_CONCURRENCY_LIMIT', 'GLOBAL_CONCURRENCY_LIMIT'];
const MESSAGE_SENTINEL = 'sentinel-sandbox-message-44b1';

// Oracle written from the table of the design, independently of the implementation.
function expected(result: Record<string, unknown>): Classification['kind'] {
  const runs = result['totalRuns'];
  const time = result['executionTimeMs'];
  const intIn = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
  if (result['status'] === 'PASSED') return intIn(runs, 100, 1000) && intIn(time, 0, Number.MAX_SAFE_INTEGER) ? 'conclusive' : 'internal';
  if (result['status'] === 'FAILED') return intIn(runs, 1, 1000) && intIn(time, 0, Number.MAX_SAFE_INTEGER) ? 'conclusive' : 'internal';
  if (result['status'] !== 'ERROR') return 'internal';
  const code = result['code'];
  if (code === 'LIVE_EXECUTION_DENIED') {
    if (result['reason'] === 'USER_EXECUTION_DISABLED') return 'denied-disabled';
    if (result['reason'] === 'USER_CONCURRENCY_LIMIT' || result['reason'] === 'GLOBAL_CONCURRENCY_LIMIT') return 'denied-busy';
    return 'internal';
  }
  if (code === 'SANDBOX_UNAVAILABLE') return 'unavailable';
  if (typeof code === 'string' && INCONCLUSIVE_CODES.has(code)) return 'inconclusive';
  return 'internal';
}

const count = fc.oneof(fc.integer({ min: -5, max: 1_200 }), fc.constantFrom(0, 1, 99, 100, 1_000, 1_001, 1.5, Number.NaN, Infinity), fc.string({ maxLength: 4 }), fc.constant(null));
const result = fc.record(
  {
    status: fc.constantFrom<unknown>('PASSED', 'FAILED', 'ERROR', 'passed', 'OTHER', null, 5),
    executor: fc.constantFrom('sandbox-worker', 'in-process', 'none'),
    code: fc.oneof(fc.constantFrom<unknown>(...SANDBOX_CODES), fc.string({ maxLength: 12 }), fc.constant(undefined)),
    reason: fc.oneof(fc.constantFrom<unknown>(...REASONS), fc.string({ maxLength: 8 }), fc.constant(undefined)),
    message: fc.oneof(fc.constant(MESSAGE_SENTINEL), fc.string({ maxLength: 30 })),
    totalRuns: count,
    seed: fc.integer(),
    executionTimeMs: count,
    extra: fc.anything(),
  },
  { requiredKeys: ['status'] },
);

describe('sandbox result classification', () => {
  it('R7.1 is total and maps every result as the table of Requirement 7 says', () => {
    // Feature: 08-live-verification-api, Property 5: Result classification
    fc.assert(
      fc.property(result, (value) => {
        const classification = classifySandboxResult(value);
        const detail = 'detail' in classification ? classification.detail : '';
        return (
          classification.kind === expected(value) &&
          !detail.includes(MESSAGE_SENTINEL) &&
          /^[A-Za-z0-9_-]{1,64}$/.test(detail || 'x')
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R7.1 never throws, whatever the value (Requirement 7)', () => {
    const hostile = new Proxy({}, { get: () => { throw new Error('boom'); } });
    for (const value of [undefined, null, 1, 'PASSED', [], hostile, { status: 'PASSED', get totalRuns(): number { throw new Error('x'); } }]) {
      expect(classifySandboxResult(value).kind).toBe('internal');
    }
  });

  it('R7.2 a passing and a failing run are conclusive with their counts (Requirement 7)', () => {
    expect(classifySandboxResult({ status: 'PASSED', executor: 'sandbox-worker', totalRuns: 1000, seed: 1, executionTimeMs: 0, evidence: 'x' }))
      .toEqual({ kind: 'conclusive', passed: true, totalRuns: 1000, executionTimeMs: 0 });
    expect(classifySandboxResult({ status: 'FAILED', executor: 'sandbox-worker', totalRuns: 1, seed: 1, executionTimeMs: 25 }))
      .toEqual({ kind: 'conclusive', passed: false, totalRuns: 1, executionTimeMs: 25 });
  });

  it('R7.3 a pass below 100 runs or above 1,000, and a negative time, are internal errors (Requirement 7)', () => {
    for (const bad of [{ status: 'PASSED', totalRuns: 99, executionTimeMs: 1 }, { status: 'PASSED', totalRuns: 1001, executionTimeMs: 1 }, { status: 'FAILED', totalRuns: 0, executionTimeMs: 1 }, { status: 'FAILED', totalRuns: 5, executionTimeMs: -1 }, { status: 'PASSED', totalRuns: 100.5, executionTimeMs: 1 }]) {
      expect(classifySandboxResult(bad)).toEqual({ kind: 'internal', detail: 'invalid-values' });
    }
  });

  it.each([...INCONCLUSIVE_CODES])('R7.4 %s is inconclusive (Requirement 7)', (code) => {
    expect(classifySandboxResult({ status: 'ERROR', executor: 'sandbox-worker', code, message: MESSAGE_SENTINEL, executionTimeMs: 3 })).toEqual({ kind: 'inconclusive', detail: code });
  });

  it.each(['INVALID_OPTIONS', 'INTERNAL_ERROR', 'SOMETHING_NEW'])('R7.4 %s is an internal error (Requirement 7)', (code) => {
    expect(classifySandboxResult({ status: 'ERROR', code, message: MESSAGE_SENTINEL, executionTimeMs: 3 })).toEqual({ kind: 'internal', detail: code });
  });

  it.each(REASONS)('R6.6 the denial reason %s is mapped as Requirement 6 states', (reason) => {
    const classification = classifySandboxResult({ status: 'ERROR', executor: 'none', code: 'LIVE_EXECUTION_DENIED', reason, message: 'x', executionTimeMs: 1 });
    if (reason === 'USER_EXECUTION_DISABLED') expect(classification).toEqual({ kind: 'denied-disabled' });
    else if (reason === 'USER_CONCURRENCY_LIMIT' || reason === 'GLOBAL_CONCURRENCY_LIMIT') expect(classification).toEqual({ kind: 'denied-busy' });
    else expect(classification).toEqual({ kind: 'internal', detail: reason });
  });

  it('R6.7 SANDBOX_UNAVAILABLE is its own kind (Requirement 6)', () => {
    expect(classifySandboxResult({ status: 'ERROR', executor: 'sandbox-worker', code: 'SANDBOX_UNAVAILABLE', message: 'x', executionTimeMs: 1 })).toEqual({ kind: 'unavailable' });
  });
});
