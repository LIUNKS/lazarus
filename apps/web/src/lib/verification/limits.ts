// The Verification_Limits (Requirements 5 and 6). Pure module.
// The quota function receives these values as arguments, so a change needs no migration. Both windows are at
// most 24 hours, because the function deletes ledger rows older than 24 hours.
export const VERIFICATION_LIMITS = {
  userQuota: { limit: 10, windowSeconds: 3_600 },
  globalQuota: { limit: 100, windowSeconds: 86_400 },
  /** Runs per verification, from 100 to 1,000. Never taken from the client. */
  numRuns: 1_000,
  quotaCallTimeoutMs: 5_000,
  /** About one default sandbox run (10 s) plus its 2 s kill grace. A hint: the Gate has no wait queue. */
  busyRetryAfterSeconds: 15,
  perUserConcurrency: 1,
  globalConcurrency: 4,
} as const;

export type VerificationLimits = typeof VERIFICATION_LIMITS;
