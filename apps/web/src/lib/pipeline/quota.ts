import 'server-only';

// Wrapper around public.reserve_llm_call (Requirement 8). It makes one RPC call with the limits of limits.ts,
// accepts only a well-formed verdict, and fails closed: any error, malformed result, or timeout throws QuotaUnavailable.
// It never deletes or updates a reservation: a failure after an allow keeps the row.
import type { SupabaseClient } from '@supabase/supabase-js';
import { clampRetryAfter, PipelineError, QuotaUnavailable } from './errors';
import { LIMITS, type PipelineLimits } from './limits';
import type { QuotaVerdict } from './types';

type QuotaLimits = Pick<PipelineLimits, 'userQuota' | 'globalQuota' | 'quotaCallTimeoutMs'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts exactly one row: an allow with `none`, or a deny by `user` or `global` with an integer retry-after. */
export function parseVerdict(data: unknown): QuotaVerdict {
  if (!Array.isArray(data) || data.length !== 1) throw new QuotaUnavailable('verdict-shape');
  const row: unknown = data[0];
  if (!isRecord(row)) throw new QuotaUnavailable('verdict-shape');
  const { allowed, denied_by: deniedBy, retry_after_seconds: retryAfter } = row;
  if (allowed === true && deniedBy === 'none') return { allowed: true };
  if (allowed === false && (deniedBy === 'user' || deniedBy === 'global') && typeof retryAfter === 'number' && Number.isInteger(retryAfter)) {
    return { allowed: false, deniedBy, retryAfterSeconds: clampRetryAfter(retryAfter) };
  }
  throw new QuotaUnavailable('verdict-shape');
}

/**
 * Calls the quota function once and lets the request continue only on a well-formed allow (Requirement 8).
 * A deny becomes RATE_LIMITED with the limit that denied it. An error, a malformed value, or no answer becomes
 * QUOTA_UNAVAILABLE, so the route fails closed. The route checks the value again here even though the store
 * already did, because the store is an interface and a misbehaving implementation must not open the gate.
 */
export async function reserveOrFail(store: { reserveQuota(route: 'seance' | 'reincarnate'): Promise<unknown> }, route: 'seance' | 'reincarnate'): Promise<void> {
  let verdict: unknown;
  try {
    verdict = await store.reserveQuota(route);
  } catch {
    throw new PipelineError('QUOTA_UNAVAILABLE');
  }
  if (isRecord(verdict)) {
    if (verdict['allowed'] === true) return;
    const { deniedBy, retryAfterSeconds } = verdict;
    if (verdict['allowed'] === false && (deniedBy === 'user' || deniedBy === 'global') && typeof retryAfterSeconds === 'number' && Number.isInteger(retryAfterSeconds)) {
      throw new PipelineError('RATE_LIMITED', { deniedBy, retryAfterSeconds });
    }
  }
  throw new PipelineError('QUOTA_UNAVAILABLE');
}

export async function reserveQuota(
  client: SupabaseClient,
  route: 'seance' | 'reincarnate',
  limits: QuotaLimits = LIMITS,
): Promise<QuotaVerdict> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = client
      .rpc('reserve_llm_call', {
        p_route: route,
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
    return parseVerdict(response.data);
  } catch (error) {
    throw error instanceof QuotaUnavailable ? error : new QuotaUnavailable('rpc-failure');
  } finally {
    clearTimeout(timer);
  }
}
