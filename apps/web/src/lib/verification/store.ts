import 'server-only';

// The store seam of POST /api/verify. Every read and write goes through the Server_Client of the request, so Row
// Level Security decides what each caller sees and may change. The three reads come from the store of 05. The two
// writes are RPC calls of migration V4: the quota reservation and the verdict recording. No other client exists and
// no service role key is used.
import type { SupabaseClient } from '@supabase/supabase-js';
import { CORPSE_STATUSES } from '@/lib/data/types';
import { QuotaUnavailable, StoreError } from '@/lib/pipeline/errors';
import { parseVerdict } from '@/lib/pipeline/quota';
import { createSupabaseStore, type PipelineStore } from '@/lib/pipeline/store';
import type { CorpseStatus, QuotaVerdict } from '@/lib/pipeline/types';
import { VERIFICATION_LIMITS } from './limits';

export interface RecordInput {
  reincarnationId: string;
  passed: boolean;
  totalRuns: number;
  executionTimeMs: number;
}

export type RecordResult =
  | { wasUpdated: true; passed: boolean; totalRuns: number; executionTimeMs: number; corpseStatus: CorpseStatus }
  | { wasUpdated: false };

export interface VerificationStore extends Pick<PipelineStore, 'loadCorpse' | 'getSeance' | 'getReincarnation'> {
  /** One call of `reserve_verification_run`. Anything but a well-formed verdict throws QuotaUnavailable. */
  reserveVerificationRun(): Promise<QuotaVerdict>;
  /** One call of `record_verification`. A database error or an unexpected shape throws StoreError. */
  recordVerification(input: RecordInput): Promise<RecordResult>;
}

interface QuotaLimits {
  userQuota: { limit: number; windowSeconds: number };
  globalQuota: { limit: number; windowSeconds: number };
  quotaCallTimeoutMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/** The detail of a failure is the PostgREST or SQLSTATE code only. The database message is never copied. */
function failure(error: unknown): StoreError {
  const code = isRecord(error) ? error['code'] : undefined;
  return new StoreError(typeof code === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(code) ? code : 'db');
}

/** Exactly one row: `was_updated` false, or true with the written values and a known corpse status. */
function parseRecorded(data: unknown): RecordResult {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) throw new StoreError('record-shape');
  const row = data[0];
  if (row['was_updated'] === false) return { wasUpdated: false };
  const passed = row['stored_passed'];
  const totalRuns = row['stored_total_runs'];
  const executionTimeMs = row['stored_execution_time_ms'];
  const corpseStatus = row['corpse_status'];
  if (
    row['was_updated'] !== true ||
    typeof passed !== 'boolean' ||
    !isInteger(totalRuns) ||
    !isInteger(executionTimeMs) ||
    typeof corpseStatus !== 'string' ||
    !(CORPSE_STATUSES as readonly string[]).includes(corpseStatus)
  ) {
    throw new StoreError('record-shape');
  }
  return { wasUpdated: true, passed, totalRuns, executionTimeMs, corpseStatus: corpseStatus as CorpseStatus };
}

export function createSupabaseVerificationStore(client: SupabaseClient, limits: QuotaLimits = VERIFICATION_LIMITS): VerificationStore {
  const reads = createSupabaseStore(client);
  return {
    loadCorpse: (id) => reads.loadCorpse(id),
    getSeance: (corpseId) => reads.getSeance(corpseId),
    getReincarnation: (corpseId) => reads.getReincarnation(corpseId),

    async reserveVerificationRun() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const call = client
          .rpc('reserve_verification_run', {
            p_user_limit: limits.userQuota.limit,
            p_user_window: `${limits.userQuota.windowSeconds} seconds`,
            p_global_limit: limits.globalQuota.limit,
            p_global_window: `${limits.globalQuota.windowSeconds} seconds`,
          })
          .abortSignal(AbortSignal.timeout(limits.quotaCallTimeoutMs));
        // The abort signal cancels the HTTP request. The race also covers a client that ignores it.
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new QuotaUnavailable('timeout')), limits.quotaCallTimeoutMs);
        });
        const response = (await Promise.race([Promise.resolve(call), timeout])) as { data: unknown; error: unknown };
        if (response.error) throw new QuotaUnavailable('rpc-error');
        // The verdict guard of 05: exactly one well-formed row, otherwise QuotaUnavailable.
        return parseVerdict(response.data);
      } catch (error) {
        throw error instanceof QuotaUnavailable ? error : new QuotaUnavailable('rpc-failure');
      } finally {
        clearTimeout(timer);
      }
    },

    async recordVerification(input) {
      let response: { data: unknown; error: unknown };
      try {
        response = (await client.rpc('record_verification', {
          p_reincarnation_id: input.reincarnationId,
          p_passed: input.passed,
          p_total_runs: input.totalRuns,
          p_execution_time_ms: input.executionTimeMs,
        })) as { data: unknown; error: unknown };
      } catch (error) {
        throw failure(error);
      }
      if (response.error) throw failure(response.error);
      return parseRecorded(response.data);
    },
  };
}
