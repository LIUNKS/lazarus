// Error codes, statuses, and fixed messages of POST /api/verify (Requirement 9). Pure module.
// The error table of 05 is not changed: the codes shared with it reuse its texts, and this route keeps its own
// list, so the tests of 05 keep their meaning.
import { clampRetryAfter, ERROR_TABLE, jsonResponse } from '@/lib/pipeline/errors';

export const VERIFY_ERROR_CODES = [
  'INVALID_REQUEST',
  'AUTH_REQUIRED',
  'FORBIDDEN_ORIGIN',
  'NOT_FOUND',
  'NOT_PRECOMPUTED',
  'METHOD_NOT_ALLOWED',
  'SEANCE_REQUIRED',
  'REINCARNATION_REQUIRED',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VERIFICATION_INCONCLUSIVE',
  'RATE_LIMITED',
  'VERIFICATION_BUSY',
  'INTERNAL_ERROR',
  'PERSISTENCE_FAILED',
  'QUOTA_UNAVAILABLE',
  'VERIFICATION_DISABLED',
  'SANDBOX_UNAVAILABLE',
] as const;
export type VerifyErrorCode = (typeof VERIFY_ERROR_CODES)[number];

/** Typed details that may shape a response or the log line. Nothing else about a failure leaves the server. */
export interface VerifyErrorDetail {
  /** `RATE_LIMITED` and `VERIFICATION_BUSY`: seconds for the Retry-After header. */
  retryAfterSeconds?: number;
  /** `RATE_LIMITED`: the limit that denied the request. */
  deniedBy?: 'user' | 'global';
  /** A short constant for the log line (a Sandbox_Runner code, a denial reason, a SQLSTATE). Never sent to the client. */
  safeDetail?: string;
}

export class VerifyError extends Error {
  constructor(
    readonly code: VerifyErrorCode,
    readonly detail: VerifyErrorDetail = {},
  ) {
    // The Error message is the code, so no accidental serialization can carry other text.
    super(code);
    this.name = 'VerifyError';
  }
}

interface VerifyErrorEntry {
  status: number;
  message: string;
}

const shared = (code: keyof typeof ERROR_TABLE): VerifyErrorEntry => ERROR_TABLE[code];

// All messages are ASCII English, 1 to 200 characters, and contain no Forbidden_Phrase.
export const VERIFY_ERROR_TABLE: Readonly<Record<VerifyErrorCode, VerifyErrorEntry>> = {
  INVALID_REQUEST: shared('INVALID_REQUEST'),
  AUTH_REQUIRED: shared('AUTH_REQUIRED'),
  FORBIDDEN_ORIGIN: shared('FORBIDDEN_ORIGIN'),
  NOT_FOUND: shared('NOT_FOUND'),
  NOT_PRECOMPUTED: shared('NOT_PRECOMPUTED'),
  METHOD_NOT_ALLOWED: shared('METHOD_NOT_ALLOWED'),
  SEANCE_REQUIRED: shared('SEANCE_REQUIRED'),
  REINCARNATION_REQUIRED: { status: 409, message: 'Generate the reincarnation for this corpse before verification.' },
  REQUEST_TOO_LARGE: shared('REQUEST_TOO_LARGE'),
  UNSUPPORTED_MEDIA_TYPE: shared('UNSUPPORTED_MEDIA_TYPE'),
  VERIFICATION_INCONCLUSIVE: { status: 422, message: 'The verification run did not complete. Nothing was stored.' },
  RATE_LIMITED: { status: 429, message: 'You have reached your limit of verification runs. Try again later.' },
  VERIFICATION_BUSY: { status: 429, message: 'The verification service is busy. Try again shortly.' },
  INTERNAL_ERROR: shared('INTERNAL_ERROR'),
  PERSISTENCE_FAILED: shared('PERSISTENCE_FAILED'),
  QUOTA_UNAVAILABLE: shared('QUOTA_UNAVAILABLE'),
  VERIFICATION_DISABLED: { status: 503, message: 'Live verification is not enabled.' },
  SANDBOX_UNAVAILABLE: { status: 503, message: 'The verification sandbox is not available.' },
};

export const VERIFY_RATE_LIMITED_GLOBAL_MESSAGE = 'The service-wide limit of verification runs was reached. Try again later.';

/** The fixed message of a code. The only variation is the limit named by RATE_LIMITED. */
export function verifyMessageFor(code: VerifyErrorCode, detail: VerifyErrorDetail = {}): string {
  if (code === 'RATE_LIMITED' && detail.deniedBy === 'global') return VERIFY_RATE_LIMITED_GLOBAL_MESSAGE;
  return VERIFY_ERROR_TABLE[code].message;
}

/**
 * Builds the Error_Envelope with the response builder of 05 (same Cache-Control and Content-Type headers). It reads
 * only the code and the typed numeric details, never the text of a caught exception.
 */
export function verifyErrorResponse(error: VerifyError): Response {
  const headers: Record<string, string> = {};
  if (error.code === 'RATE_LIMITED' || error.code === 'VERIFICATION_BUSY') {
    headers['Retry-After'] = String(clampRetryAfter(error.detail.retryAfterSeconds));
  }
  if (error.code === 'METHOD_NOT_ALLOWED') headers['Allow'] = 'POST';
  const body = { ok: false, error: { code: error.code, message: verifyMessageFor(error.code, error.detail) } };
  return jsonResponse(VERIFY_ERROR_TABLE[error.code].status, body, headers);
}

export function isVerifyErrorCode(value: unknown): value is VerifyErrorCode {
  return typeof value === 'string' && (VERIFY_ERROR_CODES as readonly string[]).includes(value);
}
