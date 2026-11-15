import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsForbiddenPhrase } from '@/lib/pipeline/forbidden';
import {
  VERIFY_ERROR_CODES,
  VERIFY_ERROR_TABLE,
  VERIFY_RATE_LIMITED_GLOBAL_MESSAGE,
  VerifyError,
  verifyErrorResponse,
  verifyMessageFor,
  type VerifyErrorCode,
} from './errors';

const EXPECTED_STATUSES: Record<VerifyErrorCode, number> = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  FORBIDDEN_ORIGIN: 403,
  NOT_FOUND: 404,
  NOT_PRECOMPUTED: 404,
  METHOD_NOT_ALLOWED: 405,
  SEANCE_REQUIRED: 409,
  REINCARNATION_REQUIRED: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  VERIFICATION_INCONCLUSIVE: 422,
  RATE_LIMITED: 429,
  VERIFICATION_BUSY: 429,
  INTERNAL_ERROR: 500,
  PERSISTENCE_FAILED: 500,
  QUOTA_UNAVAILABLE: 503,
  VERIFICATION_DISABLED: 503,
  SANDBOX_UNAVAILABLE: 503,
};

const LEAK_PATTERN = /\n\s+at |[A-Za-z]:\\|\/(home|Users|usr|var|tmp)\/|SQLSTATE|\b[0-9A-Z]{5}\b.*error|node_modules/;

describe('verification error envelope', () => {
  it('R9.1 uses exactly the 18 codes and statuses of Requirement 9, including the five new codes', () => {
    expect([...VERIFY_ERROR_CODES].sort()).toEqual(Object.keys(EXPECTED_STATUSES).sort());
    for (const code of VERIFY_ERROR_CODES) expect(VERIFY_ERROR_TABLE[code].status, code).toBe(EXPECTED_STATUSES[code]);
    for (const code of ['REINCARNATION_REQUIRED', 'VERIFICATION_DISABLED', 'VERIFICATION_BUSY', 'VERIFICATION_INCONCLUSIVE', 'SANDBOX_UNAVAILABLE']) {
      expect(VERIFY_ERROR_CODES).toContain(code);
    }
  });

  it('R9.2 builds an envelope with the listed status, fixed message, and headers for any details (Requirement 9)', async () => {
    // Feature: 08-live-verification-api, Property 9: Envelope and non-leakage
    const detail = fc.record(
      {
        retryAfterSeconds: fc.oneof(fc.integer({ min: -100_000, max: 200_000 }), fc.double(), fc.constant(Number.NaN)),
        deniedBy: fc.constantFrom('user' as const, 'global' as const),
        safeDetail: fc.string({ maxLength: 40 }),
      },
      { requiredKeys: [] },
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...VERIFY_ERROR_CODES), detail, async (code, details) => {
        const response = verifyErrorResponse(new VerifyError(code, details));
        const text = await response.text();
        const body = JSON.parse(text) as { ok: unknown; error: { code: unknown; message: string } };
        const message = body.error.message;
        const retryAfter = response.headers.get('retry-after');
        const withRetry = code === 'RATE_LIMITED' || code === 'VERIFICATION_BUSY';
        return (
          response.status === EXPECTED_STATUSES[code] &&
          JSON.stringify(Object.keys(body).sort()) === '["error","ok"]' &&
          JSON.stringify(Object.keys(body.error).sort()) === '["code","message"]' &&
          body.ok === false &&
          body.error.code === code &&
          message === verifyMessageFor(code, details) &&
          message.length >= 1 &&
          message.length <= 200 &&
          /^[\x20-\x7e]+$/.test(message) &&
          !containsForbiddenPhrase(message) &&
          !LEAK_PATTERN.test(message) &&
          (details.safeDetail === undefined || details.safeDetail.length < 4 || !text.includes(details.safeDetail)) &&
          response.headers.get('cache-control') === 'private, no-store' &&
          response.headers.get('content-type') === 'application/json; charset=utf-8' &&
          (withRetry
            ? retryAfter !== null && /^\d+$/.test(retryAfter) && Number(retryAfter) >= 1 && Number(retryAfter) <= 86_400
            : retryAfter === null)
        );
      }),
      { numRuns: 200 },
    );
  });

  it('R5.6 names only the limit that denied the run, and verification runs, in the RATE_LIMITED message (Requirement 5)', () => {
    const user = verifyMessageFor('RATE_LIMITED', { deniedBy: 'user' });
    const global = verifyMessageFor('RATE_LIMITED', { deniedBy: 'global' });
    expect(user).toBe('You have reached your limit of verification runs. Try again later.');
    expect(global).toBe(VERIFY_RATE_LIMITED_GLOBAL_MESSAGE);
    for (const message of [user, global]) {
      expect(message).toContain('verification runs');
      expect(message).not.toMatch(/generation|\d/);
    }
  });

  it('R9.4 sets Retry-After 15 for VERIFICATION_BUSY and Allow POST for METHOD_NOT_ALLOWED (Requirement 9)', () => {
    expect(verifyErrorResponse(new VerifyError('VERIFICATION_BUSY', { retryAfterSeconds: 15 })).headers.get('retry-after')).toBe('15');
    expect(verifyErrorResponse(new VerifyError('METHOD_NOT_ALLOWED')).headers.get('allow')).toBe('POST');
  });
});
