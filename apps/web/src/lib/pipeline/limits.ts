// All numeric constants of the Pipeline_API in one pure module (Requirement 8 criterion 11).
// Production code uses LIMITS as is. Tests receive a modified copy through `deps.limits`,
// but they never override the quota values.

export interface PipelineLimits {
  /** User_Quota: reservations per user per rolling window. */
  userQuota: { limit: number; windowSeconds: number };
  /** Global_Quota: reservations in total per rolling window. */
  globalQuota: { limit: number; windowSeconds: number };
  maxBodyBytes: number;
  /** Max_LLM_Source_Bytes: UTF-8 bytes of `original_code`. */
  maxLlmSourceBytes: number;
  /** Provider_Call_Timeout in ms. */
  providerCallTimeoutMs: number;
  /** Request_Deadline in ms. */
  requestDeadlineMs: number;
  quotaCallTimeoutMs: number;
  seanceMaxOutputTokens: number;
  reincarnateMaxOutputTokens: number;
  typecheckTimeoutMs: number;
  maxDiagnostics: number;
  delimiterAttempts: number;
  cacheCandidateLimit: number;
}

export const LIMITS = {
  userQuota: { limit: 20, windowSeconds: 3_600 },
  globalQuota: { limit: 500, windowSeconds: 86_400 },
  maxBodyBytes: 1_024,
  maxLlmSourceBytes: 20_000,
  providerCallTimeoutMs: 45_000,
  requestDeadlineMs: 100_000,
  quotaCallTimeoutMs: 5_000,
  seanceMaxOutputTokens: 4_000,
  reincarnateMaxOutputTokens: 8_000,
  typecheckTimeoutMs: 10_000,
  maxDiagnostics: 10,
  delimiterAttempts: 5,
  cacheCandidateLimit: 25,
} as const satisfies PipelineLimits;

/** Value of `reincarnations.target_stack` for every generated row. */
export const TARGET_STACK = 'TypeScript (strict, ES2022)';
