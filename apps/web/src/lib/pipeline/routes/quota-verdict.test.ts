import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse, errorCodeOf } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, OWNED_ID, requestFor, seanceRow, validReincarnationOutput, validSeanceOutput, type RouteName } from '@/lib/testing/harness';
import { outcomeFor } from '@/lib/testing/mock-gateway';
import { quotaUnavailable, type QuotaScript } from '@/lib/testing/memory-store';
import { ERROR_TABLE, RATE_LIMITED_GLOBAL_MESSAGE } from '../errors';
import { handleReincarnate } from './reincarnate';
import { handleSeance } from './seance';

const HANDLERS = { seance: handleSeance, reincarnate: handleReincarnate };
const routes = fc.constantFrom<Exclude<RouteName, 'scan'>>('seance', 'reincarnate');

/** Every shape of answer the quota call could give. Only a well-formed allow lets the request continue. */
const MALFORMED: unknown[] = [
  null,
  undefined,
  'allowed',
  42,
  [],
  {},
  { allowed: 'true' },
  { allowed: 1 },
  { allowed: false },
  { allowed: false, deniedBy: 'both', retryAfterSeconds: 5 },
  { allowed: false, deniedBy: 'user' },
  { allowed: false, deniedBy: 'user', retryAfterSeconds: 1.5 },
  { allowed: false, deniedBy: 'global', retryAfterSeconds: '5' },
  { allowed: false, deniedBy: 'global', retryAfterSeconds: null },
  { allowed: false, deniedBy: 'user', retryAfterSeconds: Number.NaN },
];

type Verdict = { script: QuotaScript; kind: 'allow' } | { script: QuotaScript; kind: 'deny'; deniedBy: 'user' | 'global'; retryAfterSeconds: number } | { script: QuotaScript; kind: 'unavailable' };

const verdicts: fc.Arbitrary<Verdict> = fc.oneof(
  fc.constant<Verdict>({ kind: 'allow', script: { allowed: true } }),
  fc
    .tuple(fc.constantFrom('user' as const, 'global' as const), fc.oneof(fc.integer({ min: -100_000, max: 300_000 }), fc.constantFrom(-1, 0, 1, 86_399, 86_400, 86_401)))
    .map<Verdict>(([deniedBy, retryAfterSeconds]) => ({ kind: 'deny', deniedBy, retryAfterSeconds, script: { allowed: false, deniedBy, retryAfterSeconds } })),
  fc.constantFrom(...MALFORMED).map<Verdict>((raw) => ({ kind: 'unavailable', script: { raw } })),
  fc.constant<Verdict>({ kind: 'unavailable', script: quotaUnavailable() }),
  fc.constant<Verdict>({ kind: 'unavailable', script: { throws: new Error('sentinel-quota-error-8e21') } }),
);

function options(route: 'seance' | 'reincarnate', verdict: Verdict) {
  return {
    quota: [verdict.script],
    seances: route === 'reincarnate' ? [seanceRow(OWNED_ID)] : [],
    script: [outcomeFor('ok', route === 'seance' ? validSeanceOutput() : validReincarnationOutput())],
  };
}

describe('R8 quota verdict handling (Requirement 8)', () => {
  it('R8.5 R8.6 R8.7 R8.8 continues only on a well-formed allow, answers 429 or 503 otherwise, and never writes on a non-allow (Requirement 8)', async () => {
    // Feature: 05-llm-pipeline-api, Property 9: Quota verdict handling
    await fc.assert(
      fc.asyncProperty(routes, verdicts, async (route, verdict) => {
        const h = buildHarness(options(route, verdict));
        const result = await checkResponse(await HANDLERS[route](requestFor(route, bodyFor(OWNED_ID)), h.deps), ['sentinel-quota-error-8e21']);

        expect(h.store.quotaCalls).toBe(1);
        if (verdict.kind === 'allow') {
          expect(result.status).toBe(200);
          expect(h.gateway.calls.length).toBeGreaterThan(0);
          return;
        }
        // No provider call, no write, no reservation row on anything but an allow.
        expect(h.gateway.calls).toHaveLength(0);
        expect(h.store.writes).toEqual([]);

        if (verdict.kind === 'deny') {
          expect(result.status).toBe(429);
          expect(errorCodeOf(result)).toBe('RATE_LIMITED');
          const retry = result.headers.get('Retry-After');
          expect(retry).toBe(String(Math.min(86_400, Math.max(1, verdict.retryAfterSeconds))));
          expect(Number.isInteger(Number(retry))).toBe(true);
          // The message names only the limit that denied the request: no count, no id.
          const message = (result.body['error'] as { message: string }).message;
          expect(message).toBe(verdict.deniedBy === 'global' ? RATE_LIMITED_GLOBAL_MESSAGE : ERROR_TABLE.RATE_LIMITED.message);
          expect(message).not.toMatch(/\d/);
        } else {
          expect(result.status).toBe(503);
          expect(errorCodeOf(result)).toBe('QUOTA_UNAVAILABLE');
          expect(result.headers.get('Retry-After')).toBeNull();
        }
      }),
      { numRuns: 150 },
    );
  });

  it('R8.8 keeps the reservation and issues no call that changes it when generation fails afterwards (Requirement 8)', async () => {
    // Feature: 05-llm-pipeline-api, Property 9: Quota verdict handling
    const failures = ['provider-error', 'timeout', 'auth', 'invalid-output', 'deadline', 'disconnect'] as const;
    await fc.assert(
      fc.asyncProperty(routes, fc.constantFrom(...failures), async (route, failure) => {
        const h = buildHarness({ ...options(route, { kind: 'allow', script: { allowed: true } }), script: [outcomeFor(failure), outcomeFor(failure)] });
        const result = await checkResponse(await HANDLERS[route](requestFor(route, bodyFor(OWNED_ID)), h.deps));
        expect(result.status).toBeGreaterThanOrEqual(502);
        // The reservation stays: it is the only write, and nothing deletes, updates, or repeats it.
        expect(h.store.writes).toEqual([{ kind: 'quota.reserve', route }]);
        expect(h.store.quotaCalls).toBe(1);
        expect(h.store.calls.filter((method) => method === 'reserveQuota')).toHaveLength(1);
      }),
      { numRuns: 60 },
    );
  });

  it('R8.5 clamps Retry-After to 1 and 86,400 at the boundaries (Requirement 8)', async () => {
    for (const [given, sent] of [[-5, '1'], [0, '1'], [1, '1'], [3_600, '3600'], [86_400, '86400'], [86_401, '86400'], [9_999_999, '86400']] as const) {
      const h = buildHarness({ quota: [{ allowed: false, deniedBy: 'user', retryAfterSeconds: given }], script: [] });
      const result = await checkResponse(await handleSeance(requestFor('seance', bodyFor(OWNED_ID)), h.deps));
      expect(result.headers.get('Retry-After'), String(given)).toBe(sent);
    }
  });
});
