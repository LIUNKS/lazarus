import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { QuotaUnavailable } from '@/lib/pipeline/errors';
import type { QuotaScript } from '@/lib/testing/memory-store';
import { errored, passed } from '@/lib/testing/mock-sandbox';
import { buildVerifyHarness, checkVerifyResponse, OWNED_ID, storeState, verifyRequest } from '@/lib/testing/verification-arbitraries';
import { VERIFY_RATE_LIMITED_GLOBAL_MESSAGE, VERIFY_ERROR_TABLE } from './errors';
import { handleVerify } from './verify';

type Kind = 'allow' | 'deny' | 'other';

const anyRetry = fc.oneof(fc.integer({ min: -100_000, max: 300_000 }), fc.constantFrom(0, 1, 86_400, 86_401));
const quotaAnswer: fc.Arbitrary<{ script: QuotaScript; kind: Kind; deniedBy?: 'user' | 'global'; retry?: number }> = fc.oneof(
  fc.constant({ script: { allowed: true } as QuotaScript, kind: 'allow' as Kind }),
  fc.tuple(fc.constantFrom('user' as const, 'global' as const), anyRetry).map(([deniedBy, retry]) => ({
    script: { allowed: false, deniedBy, retryAfterSeconds: retry } as QuotaScript,
    kind: 'deny' as Kind,
    deniedBy,
    retry,
  })),
  fc
    .constantFrom<unknown>(
      null,
      undefined,
      {},
      { allowed: 'true' },
      { allowed: false },
      { allowed: false, deniedBy: 'none', retryAfterSeconds: 3 },
      { allowed: false, deniedBy: 'user', retryAfterSeconds: 1.5 },
      { allowed: false, deniedBy: 'user', retryAfterSeconds: '60' },
      [{ allowed: true }],
    )
    .map((raw) => ({ script: { raw } as QuotaScript, kind: 'other' as Kind })),
  fc.constantFrom<unknown>(new QuotaUnavailable('timeout'), new Error('sentinel-quota-error-77aa')).map((error) => ({ script: { throws: error } as QuotaScript, kind: 'other' as Kind })),
);

describe('quota verdict handling', () => {
  it('R5.1 continues only on a well-formed allow and fails closed otherwise (Requirement 5)', async () => {
    // Feature: 08-live-verification-api, Property 8: Quota verdict handling
    await fc.assert(
      fc.asyncProperty(quotaAnswer, async (answer) => {
        const harness = buildVerifyHarness({ ...storeState({ reincarnation: true, verdict: null, seance: 'valid' }), quota: [answer.script] });
        const checked = await checkVerifyResponse(await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps), ['sentinel-quota-error']);
        if (harness.store.quotaCalls !== 1) return false;
        if (answer.kind === 'allow') return checked.status === 200 && harness.sandbox.calls === 1;
        const noEffect = harness.sandbox.calls === 0 && harness.store.verdictWrites.length === 0 && harness.store.reservations === 0;
        if (answer.kind === 'other') return checked.code === 'QUOTA_UNAVAILABLE' && noEffect;
        const message = (checked.body['error'] as { message: string }).message;
        const expectedMessage = answer.deniedBy === 'global' ? VERIFY_RATE_LIMITED_GLOBAL_MESSAGE : VERIFY_ERROR_TABLE.RATE_LIMITED.message;
        const expectedRetry = Math.min(86_400, Math.max(1, answer.retry ?? 1));
        return (
          checked.code === 'RATE_LIMITED' &&
          Number(checked.headers.get('retry-after')) === expectedRetry &&
          message === expectedMessage &&
          !/\d/.test(message) &&
          !message.includes(String(answer.retry)) &&
          noEffect
        );
      }),
      { numRuns: 150 },
    );
  });

  it('R5.8 keeps the reservation after any later failure and never removes or changes it (Requirement 5)', async () => {
    for (const result of [errored('SANDBOX_TIMEOUT'), errored('INTERNAL_ERROR'), errored('SANDBOX_UNAVAILABLE'), passed()]) {
      const harness = buildVerifyHarness({ ...storeState({ reincarnation: true, verdict: null, seance: 'valid' }), results: [result] });
      await handleVerify(verifyRequest({ corpseId: OWNED_ID }), harness.deps);
      expect(harness.store.reservations).toBe(1);
      expect(harness.store.writes.filter((write) => write.kind !== 'quota.reserve' && write.kind !== 'verification.record')).toEqual([]);
    }
  });
});
