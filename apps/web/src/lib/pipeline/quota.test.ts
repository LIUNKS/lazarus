import type { SupabaseClient } from '@supabase/supabase-js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fakeClient, writeCalls, type FakeResult } from '@/lib/testing/fake-client';
import { QuotaUnavailable } from './errors';
import { LIMITS } from './limits';
import { parseVerdict, reserveQuota } from './quota';

const ALLOW = [{ allowed: true, denied_by: 'none', retry_after_seconds: 0 }];
const deny = (deniedBy: string, retryAfter: unknown) => [{ allowed: false, denied_by: deniedBy, retry_after_seconds: retryAfter }];
const reserve = (result: FakeResult) => {
  const { client, calls } = fakeClient(result);
  return { promise: reserveQuota(client, 'seance'), calls };
};

describe('R8 quota wrapper (Requirement 8)', () => {
  it('R8.1 R8.11 calls reserve_llm_call once with the limits of limits.ts and a 5,000 ms abort signal (Requirement 8)', async () => {
    const { promise, calls } = reserve({ data: ALLOW });
    expect(await promise).toEqual({ allowed: true });
    const rpcCalls = calls.filter(([method]) => method === 'rpc');
    expect(rpcCalls).toEqual([
      [
        'rpc',
        [
          'reserve_llm_call',
          {
            p_route: 'seance',
            p_user_limit: LIMITS.userQuota.limit,
            p_user_window: '3600 seconds',
            p_global_limit: LIMITS.globalQuota.limit,
            p_global_window: '86400 seconds',
          },
        ],
      ],
    ]);
    const signal = calls.find(([method]) => method === 'abortSignal')?.[1][0];
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it('R8.1 passes the route name through for the reincarnate route (Requirement 8)', async () => {
    const { client, calls } = fakeClient({ data: ALLOW });
    await reserveQuota(client, 'reincarnate');
    expect(calls.find(([method]) => method === 'rpc')?.[1][1]).toMatchObject({ p_route: 'reincarnate' });
  });

  it('R8.5 R8.6 returns a deny with the limit that denied and the retry-after (Requirement 8)', async () => {
    expect(await reserve({ data: deny('user', 120) }).promise).toEqual({ allowed: false, deniedBy: 'user', retryAfterSeconds: 120 });
    expect(await reserve({ data: deny('global', 7) }).promise).toEqual({ allowed: false, deniedBy: 'global', retryAfterSeconds: 7 });
  });

  it('R8.5 clamps the retry-after to 1 through 86,400 seconds (Requirement 8)', async () => {
    // Feature: 05-llm-pipeline-api, Supporting check: retry-after clamp
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -1_000_000, max: 10_000_000 }), async (seconds) => {
        const verdict = await reserve({ data: deny('user', seconds) }).promise;
        expect(verdict.allowed).toBe(false);
        if (!verdict.allowed) expect(verdict.retryAfterSeconds).toBe(Math.min(86_400, Math.max(1, seconds)));
      }),
      { numRuns: 100 },
    );
  });

  it('R8.7 treats every malformed result as QuotaUnavailable (Requirement 8)', async () => {
    const malformed: unknown[] = [
      null,
      undefined,
      [],
      {},
      'allowed',
      [ALLOW[0], ALLOW[0]],
      [null],
      [{}],
      [{ allowed: 'true', denied_by: 'none', retry_after_seconds: 0 }],
      [{ allowed: true, denied_by: 'user', retry_after_seconds: 0 }],
      [{ allowed: false, denied_by: 'none' }],
      deny('none', 5),
      deny('both', 5),
      deny('user', 1.5),
      deny('user', '5'),
      deny('user', null),
      deny('user', Number.NaN),
      deny(' user', 5),
    ];
    for (const data of malformed) {
      await expect(reserve({ data }).promise, JSON.stringify(data)).rejects.toBeInstanceOf(QuotaUnavailable);
      expect(() => parseVerdict(data)).toThrow(QuotaUnavailable);
    }
  });

  it('R8.7 treats an RPC error as QuotaUnavailable without copying the database message (Requirement 8)', async () => {
    const { promise } = reserve({ data: null, error: { code: '28000', message: 'sentinel-database-message-3e8a' } });
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuotaUnavailable);
    expect(JSON.stringify(error) + String((error as Error).message) + String((error as QuotaUnavailable).detail)).not.toContain('sentinel');
  });

  it('R8.7 treats a thrown error as QuotaUnavailable (Requirement 8)', async () => {
    const client = {
      rpc: () => {
        throw new Error('sentinel-thrown-text');
      },
    } as unknown as SupabaseClient;
    const error = await reserveQuota(client, 'seance').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuotaUnavailable);
    expect(String((error as Error).message)).not.toContain('sentinel');
  });

  it('R8.7 treats no answer within the quota timeout as QuotaUnavailable (Requirement 8)', async () => {
    const never = new Promise(() => undefined);
    const client = { rpc: () => ({ abortSignal: () => never }) } as unknown as SupabaseClient;
    const started = Date.now();
    await expect(reserveQuota(client, 'seance', { ...LIMITS, quotaCallTimeoutMs: 30 })).rejects.toBeInstanceOf(QuotaUnavailable);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('R8.8 issues no call that changes or removes a reservation, only the one RPC (Requirement 8)', async () => {
    const { promise, calls } = reserve({ data: deny('user', 30) });
    await promise;
    expect(writeCalls(calls)).toHaveLength(1);
    expect(calls.map(([method]) => method).filter((method) => ['update', 'delete', 'insert', 'upsert'].includes(method))).toEqual([]);
  });
});
