import { describe, expect, it } from 'vitest';
import { USER_EXECUTION_ENABLED } from './flags';
import { VERIFICATION_LIMITS } from './limits';

// Flipping the Execution_Flag needs an edit of flags.ts and of this constant, which a reviewer sees.
const EXPECTED_USER_EXECUTION_ENABLED = false;

describe('verification limits and flag', () => {
  it('R5.10 holds the quota values of Requirement 5: 10 per user per 60 minutes, 100 in total per 24 hours', () => {
    expect(VERIFICATION_LIMITS.userQuota).toEqual({ limit: 10, windowSeconds: 3_600 });
    expect(VERIFICATION_LIMITS.globalQuota).toEqual({ limit: 100, windowSeconds: 86_400 });
  });

  it('R5.10 keeps both windows at most 24 hours, because the function deletes older rows (Requirement 5)', () => {
    expect(VERIFICATION_LIMITS.userQuota.windowSeconds).toBeLessThanOrEqual(86_400);
    expect(VERIFICATION_LIMITS.globalQuota.windowSeconds).toBeLessThanOrEqual(86_400);
  });

  it('R6.2 runs an integer number of inputs from 100 to 1,000 (Requirement 6)', () => {
    expect(Number.isInteger(VERIFICATION_LIMITS.numRuns)).toBe(true);
    expect(VERIFICATION_LIMITS.numRuns).toBeGreaterThanOrEqual(100);
    expect(VERIFICATION_LIMITS.numRuns).toBeLessThanOrEqual(1_000);
    expect(VERIFICATION_LIMITS.numRuns).toBe(1_000);
  });

  it('R6.6 uses an integer busy retry-after from 1 to 86,400 and the concurrency limits 1 and 4 (Requirement 6)', () => {
    expect(Number.isInteger(VERIFICATION_LIMITS.busyRetryAfterSeconds)).toBe(true);
    expect(VERIFICATION_LIMITS.busyRetryAfterSeconds).toBe(15);
    expect(VERIFICATION_LIMITS.perUserConcurrency).toBe(1);
    expect(VERIFICATION_LIMITS.globalConcurrency).toBe(4);
    expect(VERIFICATION_LIMITS.quotaCallTimeoutMs).toBe(5_000);
  });

  it('R4.1 ships the Execution_Flag as false (Requirement 4)', () => {
    expect(USER_EXECUTION_ENABLED).toBe(EXPECTED_USER_EXECUTION_ENABLED);
  });
});
