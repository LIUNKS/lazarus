import type { DenialReason, GateConfig } from '../types.js';
import { decideLiveExecution, DEFAULT_GATE_CONFIG } from './policy.js';

/** One concurrency slot. `release()` frees it once; later calls do nothing. */
export interface Lease {
  release(): void;
}

export type AcquireResult =
  | { ok: true; executor: 'in-process' }
  | { ok: true; executor: 'sandbox'; lease: Lease }
  | { ok: false; reason: DenialReason };

export interface LiveExecutionGate {
  acquire(request: unknown): AcquireResult;
  /** Number of leases held right now, for all users. */
  activeLeases(): number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * Creates the gate (Requirement 3). The counters live in the memory of this process, so the limits
 * apply per process and not across several server instances.
 */
export function createLiveExecutionGate(config: Partial<GateConfig> = {}): LiveExecutionGate {
  const resolved: GateConfig = { ...DEFAULT_GATE_CONFIG, ...config };
  if (!isPositiveInteger(resolved.perUserConcurrency) || !isPositiveInteger(resolved.globalConcurrency)) {
    throw new TypeError('perUserConcurrency and globalConcurrency must be integers greater than or equal to 1.');
  }

  const perUser = new Map<string, number>();
  let total = 0;

  return {
    activeLeases: () => total,
    // The check and the increment run in one synchronous step, so callers cannot interleave.
    acquire(request) {
      const decision = decideLiveExecution(request, resolved);
      if (!decision.allow) return { ok: false, reason: decision.reason };
      if (decision.executor === 'in-process') return { ok: true, executor: 'in-process' };

      const { userId } = decision;
      const held = perUser.get(userId) ?? 0;
      if (held >= resolved.perUserConcurrency) return { ok: false, reason: 'USER_CONCURRENCY_LIMIT' };
      if (total >= resolved.globalConcurrency) return { ok: false, reason: 'GLOBAL_CONCURRENCY_LIMIT' };
      perUser.set(userId, held + 1);
      total += 1;

      let released = false;
      return {
        ok: true,
        executor: 'sandbox',
        lease: {
          release() {
            if (released) return;
            released = true;
            total -= 1;
            const remaining = (perUser.get(userId) ?? 1) - 1;
            if (remaining <= 0) perUser.delete(userId);
            else perUser.set(userId, remaining);
          },
        },
      };
    },
  };
}
