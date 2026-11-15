// Error codes, the fixed message and status table, and the response builders (Requirements 3 and 17).
// Pure module: no server-only import, so the Proxy can use `methodNotAllowedResponse`.

export const ERROR_CODES = [
  'INVALID_REQUEST',
  'AUTH_REQUIRED',
  'FORBIDDEN_ORIGIN',
  'NOT_FOUND',
  'NOT_PRECOMPUTED',
  'METHOD_NOT_ALLOWED',
  'SEANCE_REQUIRED',
  'REQUEST_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'SOURCE_TOO_LARGE',
  'SOURCE_SYNTAX_ERROR',
  'SOURCE_NOT_SCANNABLE',
  'NO_ENTRY_FUNCTION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'PERSISTENCE_FAILED',
  'LLM_OUTPUT_INVALID',
  'LLM_PROVIDER_ERROR',
  'LLM_NOT_CONFIGURED',
  'QUOTA_UNAVAILABLE',
  'LLM_TIMEOUT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Typed details that may influence a response. Everything else about a failure stays server-side. */
export interface PipelineErrorDetail {
  /** `RATE_LIMITED` only: seconds until the exceeded window frees a slot. */
  retryAfterSeconds?: number;
  /** `RATE_LIMITED` only: the limit that denied the request. */
  deniedBy?: 'user' | 'global';
  /** Scan errors only: position reported by the scanner. */
  line?: number;
  column?: number;
  /** Short constant for the log line (a SQLSTATE, an HTTP status, or a rule name). Never sent to the client. */
  safeDetail?: string;
}

export class PipelineError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail: PipelineErrorDetail = {},
  ) {
    // The Error message is the code, so no accidental serialization can carry other text.
    super(code);
    this.name = 'PipelineError';
  }
}

/** A failure to read or write rows through the store. `detail` is a SQLSTATE or PostgREST code, never database text. */
export class StoreError extends Error {
  constructor(readonly detail: string = 'store') {
    super('StoreError');
    this.name = 'StoreError';
  }
}

/**
 * The quota check failed: an RPC error, a malformed result, or no answer in time. The generation gate maps it to
 * QUOTA_UNAVAILABLE and fails closed. The class carries no message from the database.
 */
export class QuotaUnavailable extends Error {
  constructor(readonly detail: string = 'quota') {
    super('QuotaUnavailable');
    this.name = 'QuotaUnavailable';
  }
}

interface ErrorEntry {
  status: number;
  message: string;
}

// All messages are ASCII English, 1 to 200 characters, and contain no Forbidden_Phrase.
export const ERROR_TABLE: Record<ErrorCode, ErrorEntry> = {
  INVALID_REQUEST: { status: 400, message: 'The request body must be a JSON object with a single corpseId UUID.' },
  AUTH_REQUIRED: { status: 401, message: 'Sign in to use this corpse.' },
  FORBIDDEN_ORIGIN: { status: 403, message: 'The request origin is not allowed.' },
  NOT_FOUND: { status: 404, message: 'The corpse was not found.' },
  NOT_PRECOMPUTED: { status: 404, message: 'No precomputed result exists for this sample corpse.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'Only the POST method is supported.' },
  SEANCE_REQUIRED: { status: 409, message: 'Run the Seance for this corpse before reincarnation.' },
  REQUEST_TOO_LARGE: { status: 413, message: 'The request body is larger than 1,024 bytes.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'The request must have the content type application/json.' },
  SOURCE_TOO_LARGE: { status: 422, message: 'The source code is larger than the limit of 20,000 bytes.' },
  SOURCE_SYNTAX_ERROR: { status: 422, message: 'The source code has a syntax error' },
  SOURCE_NOT_SCANNABLE: {
    status: 422,
    message: 'The source code could not be analyzed because of its size, nesting, or analysis time',
  },
  NO_ENTRY_FUNCTION: {
    status: 422,
    message: 'The source code has no top-level named function declaration to use as the entry function.',
  },
  RATE_LIMITED: { status: 429, message: 'You have reached your limit of generation requests. Try again later.' },
  INTERNAL_ERROR: { status: 500, message: 'An internal error occurred.' },
  PERSISTENCE_FAILED: { status: 500, message: 'The result could not be stored or read.' },
  LLM_OUTPUT_INVALID: { status: 502, message: 'The model output did not meet the required format.' },
  LLM_PROVIDER_ERROR: { status: 502, message: 'The model provider returned an error.' },
  LLM_NOT_CONFIGURED: { status: 503, message: 'The generation service is not configured.' },
  QUOTA_UNAVAILABLE: { status: 503, message: 'The request limit could not be checked. Try again later.' },
  LLM_TIMEOUT: { status: 504, message: 'The model did not answer in time.' },
};

export const RATE_LIMITED_GLOBAL_MESSAGE = 'The service-wide limit of generation requests was reached. Try again later.';

const MAX_RETRY_AFTER_SECONDS = 86_400;

export function clampRetryAfter(seconds: unknown): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 1;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds)));
}

function isPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The fixed message for a code. Only the two documented variations exist (limit name, scan position). */
export function messageFor(code: ErrorCode, detail: PipelineErrorDetail = {}): string {
  if (code === 'RATE_LIMITED') {
    return detail.deniedBy === 'global' ? RATE_LIMITED_GLOBAL_MESSAGE : ERROR_TABLE.RATE_LIMITED.message;
  }
  if (code === 'SOURCE_SYNTAX_ERROR' || code === 'SOURCE_NOT_SCANNABLE') {
    const base = ERROR_TABLE[code].message;
    return isPosition(detail.line) && isPosition(detail.column)
      ? `${base} at line ${detail.line}, column ${detail.column}.`
      : `${base}.`;
  }
  return ERROR_TABLE[code].message;
}

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json; charset=utf-8',
} as const;

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, ...BASE_HEADERS } });
}

/**
 * Builds the Error_Envelope response. It reads only `code` and the typed numeric details of the error,
 * never the text of a caught exception.
 */
export function errorResponse(error: PipelineError): Response {
  const { status } = ERROR_TABLE[error.code];
  const headers: Record<string, string> = {};
  if (error.code === 'RATE_LIMITED') headers['Retry-After'] = String(clampRetryAfter(error.detail.retryAfterSeconds));
  if (error.code === 'METHOD_NOT_ALLOWED') headers['Allow'] = 'POST';
  return jsonResponse(status, { ok: false, error: { code: error.code, message: messageFor(error.code, error.detail) } }, headers);
}

export function methodNotAllowedResponse(): Response {
  return errorResponse(new PipelineError('METHOD_NOT_ALLOWED'));
}
