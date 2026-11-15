import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { QuotaUnavailable, StoreError } from '@/lib/pipeline/errors';
import { fakeClient, writeCalls, type FakeResult } from '@/lib/testing/fake-client';
import { VERIFICATION_LIMITS } from './limits';
import { createSupabaseVerificationStore } from './store';

const DB_SENTINEL = 'sentinel-database-error-text-5d2e';
const ALLOW = [{ allowed: true, denied_by: 'none', retry_after_seconds: 0 }];
const RECORDED = [{ was_updated: true, stored_passed: true, stored_total_runs: 1000, stored_execution_time_ms: 420, corpse_status: 'RESURRECTED' }];
const INPUT = { reincarnationId: 'r-1', passed: true, totalRuns: 1000, executionTimeMs: 420 };

const storeFor = (result: FakeResult | FakeResult[]) => {
  const { client, calls } = fakeClient(result);
  return { store: createSupabaseVerificationStore(client), calls };
};

describe('verification store: quota reservation', () => {
  it('R5.1 R5.10 calls reserve_verification_run once with the limits of limits.ts and an abort signal (Requirement 5)', async () => {
    const { store, calls } = storeFor({ data: ALLOW });
    expect(await store.reserveVerificationRun()).toEqual({ allowed: true });
    expect(calls.filter(([method]) => method === 'rpc')).toEqual([
      [
        'rpc',
        [
          'reserve_verification_run',
          {
            p_user_limit: VERIFICATION_LIMITS.userQuota.limit,
            p_user_window: '3600 seconds',
            p_global_limit: VERIFICATION_LIMITS.globalQuota.limit,
            p_global_window: '86400 seconds',
          },
        ],
      ],
    ]);
    expect(calls.find(([method]) => method === 'abortSignal')?.[1][0]).toBeInstanceOf(AbortSignal);
    expect(writeCalls(calls)).toHaveLength(1);
  });

  it('R5.5 returns a deny with the limit that denied and the clamped retry-after (Requirement 5)', async () => {
    expect(await storeFor({ data: [{ allowed: false, denied_by: 'user', retry_after_seconds: 120 }] }).store.reserveVerificationRun()).toEqual({
      allowed: false,
      deniedBy: 'user',
      retryAfterSeconds: 120,
    });
    expect(await storeFor({ data: [{ allowed: false, denied_by: 'global', retry_after_seconds: 999_999 }] }).store.reserveVerificationRun()).toEqual({
      allowed: false,
      deniedBy: 'global',
      retryAfterSeconds: 86_400,
    });
  });

  it('R5.7 accepts only a well-formed verdict and treats anything else as QuotaUnavailable (Requirement 5)', async () => {
    const malformed: FakeResult[] = [
      { data: [] },
      { data: null },
      { data: [ALLOW[0], ALLOW[0]] },
      { data: [{ allowed: true, denied_by: 'user', retry_after_seconds: 0 }] },
      { data: [{ allowed: false, denied_by: 'none', retry_after_seconds: 5 }] },
      { data: [{ allowed: false, denied_by: 'user', retry_after_seconds: 1.5 }] },
      { data: [{ allowed: 'yes', denied_by: 'none', retry_after_seconds: 0 }] },
      { error: { code: '42501', message: DB_SENTINEL } },
    ];
    for (const result of malformed) {
      await expect(storeFor(result).store.reserveVerificationRun(), JSON.stringify(result)).rejects.toBeInstanceOf(QuotaUnavailable);
    }
  });

  it('R5.7 treats no answer within 5,000 ms as QuotaUnavailable (Requirement 5)', async () => {
    const never = new Promise(() => undefined);
    const client = { rpc: () => ({ abortSignal: () => never }) } as unknown as SupabaseClient;
    const store = createSupabaseVerificationStore(client, { ...VERIFICATION_LIMITS, quotaCallTimeoutMs: 30 });
    const started = Date.now();
    await expect(store.reserveVerificationRun()).rejects.toBeInstanceOf(QuotaUnavailable);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('verification store: verdict recording', () => {
  it('R7.6 calls record_verification once with the four arguments and maps an update (Requirement 7)', async () => {
    const { store, calls } = storeFor({ data: RECORDED });
    expect(await store.recordVerification(INPUT)).toEqual({ wasUpdated: true, passed: true, totalRuns: 1000, executionTimeMs: 420, corpseStatus: 'RESURRECTED' });
    expect(calls.filter(([method]) => method === 'rpc')).toEqual([
      ['rpc', ['record_verification', { p_reincarnation_id: 'r-1', p_passed: true, p_total_runs: 1000, p_execution_time_ms: 420 }]],
    ]);
    expect(calls.map(([method]) => method).filter((method) => ['update', 'delete', 'insert', 'upsert'].includes(method))).toEqual([]);
  });

  it('R7.8 maps was_updated false to no update (Requirement 7)', async () => {
    const data = [{ was_updated: false, stored_passed: null, stored_total_runs: null, stored_execution_time_ms: null, corpse_status: null }];
    expect(await storeFor({ data }).store.recordVerification(INPUT)).toEqual({ wasUpdated: false });
  });

  it('R7.9 throws a StoreError with a safe detail and never the database text on an error (Requirement 7)', async () => {
    const attempt = storeFor({ error: { code: '42501', message: DB_SENTINEL } }).store.recordVerification(INPUT);
    await expect(attempt).rejects.toBeInstanceOf(StoreError);
    const error = await attempt.catch((caught: unknown) => caught);
    expect(JSON.stringify(error)).not.toContain(DB_SENTINEL);
    expect(String((error as Error).message)).not.toContain(DB_SENTINEL);
    expect((error as StoreError).detail).toBe('42501');
  });

  it('R7.9 rejects an unexpected result shape as a StoreError (Requirement 7)', async () => {
    const shapes = [
      null,
      [],
      [{ was_updated: true, stored_passed: 'yes', stored_total_runs: 1000, stored_execution_time_ms: 1, corpse_status: 'RESURRECTED' }],
      [{ was_updated: true, stored_passed: true, stored_total_runs: 1.5, stored_execution_time_ms: 1, corpse_status: 'RESURRECTED' }],
      [{ was_updated: true, stored_passed: true, stored_total_runs: 1000, stored_execution_time_ms: 1, corpse_status: 'DEAD' }],
      [{ was_updated: 'no' }],
    ];
    for (const data of shapes) await expect(storeFor({ data }).store.recordVerification(INPUT), JSON.stringify(data)).rejects.toBeInstanceOf(StoreError);
  });

  it('R1.4 reads through the store of 05 with the same client (Requirement 1)', async () => {
    const corpse = { id: 'c-1', user_id: 'u-1', is_sample: false, source_language: 'es3', original_code: 'function f(){}', code_hash: 'h', status: 'IN_SEANCE' };
    const { store, calls } = storeFor({ data: corpse });
    expect(await store.loadCorpse('c-1')).toMatchObject({ id: 'c-1', userId: 'u-1', status: 'IN_SEANCE' });
    expect(calls[0]).toEqual(['from', ['corpses']]);
  });
});
