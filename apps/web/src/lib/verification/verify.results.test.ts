import fc from 'fast-check';
import { describe, it } from 'vitest';
import { errored } from '@/lib/testing/mock-sandbox';
import {
  buildVerifyHarness,
  checkVerifyResponse,
  DENIAL_REASONS,
  INCONCLUSIVE_SANDBOX_CODES,
  OWNED_ID,
  storeState,
  verifyRequest,
} from '@/lib/testing/verification-arbitraries';
import { isVerifyErrorCode } from './errors';
import { handleVerify } from './verify';

const MESSAGE_SENTINEL = 'sentinel-sandbox-message-9c41';

// Results that are not a verdict: every ERROR code, every denial, unknown codes, and malformed values.
const nonConclusive = fc.oneof(
  fc.constantFrom(...INCONCLUSIVE_SANDBOX_CODES, 'INVALID_OPTIONS', 'INTERNAL_ERROR', 'SANDBOX_UNAVAILABLE', 'SOMETHING_NEW').map((code) => errored(code)),
  fc.constantFrom(...DENIAL_REASONS).map((reason) => errored('LIVE_EXECUTION_DENIED', { executor: 'none', reason })),
  fc.constantFrom<unknown>(
    null,
    'PASSED',
    { status: 'PASSED', totalRuns: 50, executionTimeMs: 1, message: MESSAGE_SENTINEL },
    { status: 'FAILED', totalRuns: 0, executionTimeMs: 1, message: MESSAGE_SENTINEL },
    { status: 'PASSED', totalRuns: 1000, executionTimeMs: -1, message: MESSAGE_SENTINEL },
    { status: 'UNKNOWN', message: MESSAGE_SENTINEL },
  ),
);

describe('non-conclusive results', () => {
  it('R7.5 store nothing, keep the status and the reservation, and never show the sandbox message or code (Requirement 7)', async () => {
    // Feature: 08-live-verification-api, Property 5: Result classification
    await fc.assert(
      fc.asyncProperty(nonConclusive, fc.constantFrom('INFECTED' as const, 'IN_SEANCE' as const), async (result, status) => {
        const harness = buildVerifyHarness({ ...storeState({ reincarnation: true, verdict: null, seance: 'valid', status }), results: [result] });
        const code = typeof result === 'object' && result !== null ? (result as { code?: unknown }).code : undefined;
        // INTERNAL_ERROR and SANDBOX_UNAVAILABLE are also codes of this route, so their presence is not a leak.
        const sentinels = [MESSAGE_SENTINEL, ...(typeof code === 'string' && !isVerifyErrorCode(code) ? [code] : [])];
        const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps), sentinels);
        return (
          checked.status >= 400 &&
          harness.store.recordCalls === 0 &&
          harness.store.verdictWrites.length === 0 &&
          harness.store.reservations === 1 &&
          harness.store.corpseOf(OWNED_ID)?.status === status &&
          harness.store.reincarnationOf(OWNED_ID)?.pbtPassed === null
        );
      }),
      { numRuns: 150 },
    );
  });
});
