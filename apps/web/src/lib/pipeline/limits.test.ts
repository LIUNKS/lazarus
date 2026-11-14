import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ERROR_TABLE, methodNotAllowedResponse } from './errors';
import { LIMITS, TARGET_STACK } from './limits';

// Statuses of Requirement 17 criterion 1, written out independently of ERROR_TABLE.
const EXPECTED_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  NOT_PRECOMPUTED: 404,
  METHOD_NOT_ALLOWED: 405,
  SEANCE_REQUIRED: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  SOURCE_TOO_LARGE: 422,
  SOURCE_SYNTAX_ERROR: 422,
  SOURCE_NOT_SCANNABLE: 422,
  NO_ENTRY_FUNCTION: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PERSISTENCE_FAILED: 500,
  LLM_OUTPUT_INVALID: 502,
  LLM_PROVIDER_ERROR: 502,
  LLM_NOT_CONFIGURED: 503,
  QUOTA_UNAVAILABLE: 503,
  LLM_TIMEOUT: 504,
};

describe('R8.11 quota constants (Requirement 8)', () => {
  it('R8.11 holds 20 per 3,600 s for a user and 500 per 86,400 s in total (Requirement 8)', () => {
    expect(LIMITS.userQuota).toEqual({ limit: 20, windowSeconds: 3_600 });
    expect(LIMITS.globalQuota).toEqual({ limit: 500, windowSeconds: 86_400 });
  });

  it('R8.9 keeps both windows within the 24-hour cleanup horizon of the quota function (Requirement 8)', () => {
    expect(LIMITS.userQuota.windowSeconds).toBeLessThanOrEqual(86_400);
    expect(LIMITS.globalQuota.windowSeconds).toBeLessThanOrEqual(86_400);
  });

  it('R3.4 R6.2 R15.2 holds the documented size and time limits (Requirements 3, 6, and 15)', () => {
    expect(LIMITS.maxBodyBytes).toBe(1_024);
    expect(LIMITS.maxLlmSourceBytes).toBe(20_000);
    expect(LIMITS.providerCallTimeoutMs).toBe(45_000);
    expect(LIMITS.requestDeadlineMs).toBe(100_000);
    expect(LIMITS.quotaCallTimeoutMs).toBe(5_000);
    expect(LIMITS.seanceMaxOutputTokens).toBe(4_000);
    expect(LIMITS.reincarnateMaxOutputTokens).toBe(8_000);
    expect(TARGET_STACK).toBe('TypeScript (strict, ES2022)');
  });
});

describe('R17.1 error table (Requirement 17)', () => {
  it('R17.1 is total over ERROR_CODES and lists exactly the closed set (Requirement 17)', () => {
    expect([...ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_STATUS).sort());
    expect(Object.keys(ERROR_TABLE).sort()).toEqual([...ERROR_CODES].sort());
  });

  it('R17.1 maps every code to the status of the requirement (Requirement 17)', () => {
    for (const code of ERROR_CODES) expect(ERROR_TABLE[code].status, code).toBe(EXPECTED_STATUS[code]);
  });

  it('R3.1 sets Allow: POST on the 405 response (Requirement 3)', async () => {
    const response = methodNotAllowedResponse();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: ERROR_TABLE.METHOD_NOT_ALLOWED.message },
    });
  });
});
