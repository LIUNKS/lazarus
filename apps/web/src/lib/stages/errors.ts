// The closed list of Error_Codes of the Pipeline_API, and the fixed English text shown for each failure and each success.
// Pure module: no framework imports, no process.env. The text of a server response is never read or shown.
import { formatRetryAfter } from './format';
import type { PipelineOutcome, PipelineRoute, ResultSource } from './pipeline-client';

/** The 21 codes of 05-llm-pipeline-api followed by the 5 codes of 08-live-verification-api (26 in total). */
export const PIPELINE_ERROR_CODES = [
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
  'REINCARNATION_REQUIRED',
  'VERIFICATION_DISABLED',
  'VERIFICATION_BUSY',
  'VERIFICATION_INCONCLUSIVE',
  'SANDBOX_UNAVAILABLE',
] as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

/** A server code, or one of the three outcomes that the browser itself produces. */
export type FailureKind = PipelineErrorCode | 'NETWORK' | 'CLIENT_TIMEOUT' | 'UNKNOWN';

export interface FailurePresentation {
  title: string;
  message: string;
  /** Show the link to the sign-in page (`AUTH_REQUIRED`). */
  signIn: boolean;
  /** Disable the control for this many seconds (`RATE_LIMITED` or `VERIFICATION_BUSY` with a valid `Retry-After`). */
  waitSeconds: number | null;
}

type BasePresentation = Omit<FailurePresentation, 'waitSeconds'>;

const CONTRACT: BasePresentation = {
  title: 'Request not completed',
  message: 'The request could not be completed. Reload the page and try again.',
  signIn: false,
};
const SERVICE: BasePresentation = {
  title: 'Service unavailable',
  message: 'The service is unavailable right now. Try again later.',
  signIn: false,
};
const MODEL: BasePresentation = {
  title: 'Model request failed',
  message: 'The model request failed. A failed attempt can still count toward your request limit.',
  signIn: false,
};
const NOT_AVAILABLE: BasePresentation = {
  title: 'Not available',
  message: 'This corpse or result is not available.',
  signIn: false,
};
const GENERIC: BasePresentation = {
  title: 'Request not completed',
  message: 'The request could not be completed. Try again later.',
  signIn: false,
};

/** One entry per kind: `Record` makes a missing or an extra code a compile error (Requirement 11 criterion 1). */
export const FAILURE_PRESENTATIONS: Record<FailureKind, BasePresentation> = {
  INVALID_REQUEST: CONTRACT,
  AUTH_REQUIRED: { title: 'Sign in required', message: 'Sign in to run this stage.', signIn: true },
  FORBIDDEN_ORIGIN: CONTRACT,
  NOT_FOUND: NOT_AVAILABLE,
  NOT_PRECOMPUTED: NOT_AVAILABLE,
  METHOD_NOT_ALLOWED: CONTRACT,
  SEANCE_REQUIRED: { title: 'Séance required', message: 'Run the séance first.', signIn: false },
  REQUEST_TOO_LARGE: CONTRACT,
  UNSUPPORTED_MEDIA_TYPE: CONTRACT,
  SOURCE_TOO_LARGE: {
    title: 'Source cannot be processed',
    message: 'This source cannot be processed: it is too large for the model stages.',
    signIn: false,
  },
  SOURCE_SYNTAX_ERROR: {
    title: 'Source cannot be processed',
    message: 'This source cannot be processed: it contains a syntax error.',
    signIn: false,
  },
  SOURCE_NOT_SCANNABLE: {
    title: 'Source cannot be processed',
    message: 'This source cannot be processed: the scanner cannot analyze it.',
    signIn: false,
  },
  NO_ENTRY_FUNCTION: {
    title: 'Source cannot be processed',
    message: 'This source cannot be processed: no entry function was found. The code needs a top-level function declaration.',
    signIn: false,
  },
  RATE_LIMITED: { title: 'Request limit reached', message: 'The request limit was reached.', signIn: false },
  INTERNAL_ERROR: SERVICE,
  PERSISTENCE_FAILED: SERVICE,
  LLM_OUTPUT_INVALID: MODEL,
  LLM_PROVIDER_ERROR: MODEL,
  LLM_NOT_CONFIGURED: SERVICE,
  QUOTA_UNAVAILABLE: SERVICE,
  LLM_TIMEOUT: MODEL,
  REINCARNATION_REQUIRED: {
    title: 'Reincarnation required',
    message: 'Generate the module first, then verify it.',
    signIn: false,
  },
  VERIFICATION_DISABLED: {
    title: 'Live verification is off',
    message: 'Live verification is switched off on this server. Nothing was run.',
    signIn: false,
  },
  VERIFICATION_BUSY: { title: 'Verification service busy', message: 'The verification service is busy.', signIn: false },
  VERIFICATION_INCONCLUSIVE: {
    title: 'The check did not finish',
    message:
      'The check could not complete, for example because it ran out of time or memory. No result was stored. This attempt may count toward the verification limit.',
    signIn: false,
  },
  SANDBOX_UNAVAILABLE: {
    title: 'Isolated environment unavailable',
    message: 'The isolated environment is not available right now. Nothing was run.',
    signIn: false,
  },
  NETWORK: GENERIC,
  CLIENT_TIMEOUT: {
    title: 'Request timed out',
    message: 'The request took too long. Reload the page to see what was stored, then try again if needed.',
    signIn: false,
  },
  UNKNOWN: GENERIC,
};

/** Wording that differs by route. Only the verification limit differs today (Requirement 11 criterion 11). */
export const ROUTE_FAILURE_OVERRIDES: Partial<Record<PipelineRoute, Partial<Record<FailureKind, BasePresentation>>>> = {
  verify: {
    RATE_LIMITED: { title: 'Verification limit reached', message: 'The verification limit was reached.', signIn: false },
  },
};

/** The two kinds that carry a `Retry-After` wait. */
const WAIT_KINDS: readonly FailureKind[] = ['RATE_LIMITED', 'VERIFICATION_BUSY'];

export function presentFailure(
  outcome: Extract<PipelineOutcome, { kind: 'failure' }>,
  route: PipelineRoute,
): FailurePresentation {
  const base = ROUTE_FAILURE_OVERRIDES[route]?.[outcome.failure] ?? FAILURE_PRESENTATIONS[outcome.failure];
  if (!WAIT_KINDS.includes(outcome.failure)) return { ...base, waitSeconds: null };
  const seconds = outcome.retryAfterSeconds;
  const suffix = seconds === null ? 'Try again later.' : `Try again in about ${formatRetryAfter(seconds)}.`;
  return { ...base, message: `${base.message} ${suffix}`, waitSeconds: seconds };
}

const REUSED = 'Reused a stored result for identical code. No model request was made.';
const PRECOMPUTED = 'The result is precomputed. Showing it.';

/** The fixed success message for a route and a source. Any pair that no route produces falls back to "Done.". */
export function presentSuccess(route: PipelineRoute, source: ResultSource): string {
  switch (route) {
    case 'scan':
      if (source === 'generated') return 'Scan finished. The stored curses were updated.';
      if (source === 'stored' || source === 'precomputed') return 'The stored scan result is shown.';
      return 'Done.';
    case 'seance':
      if (source === 'precomputed') return PRECOMPUTED;
      if (source === 'generated') return 'The séance finished. A new spec was stored.';
      if (source === 'stored') return 'A séance was already stored. Showing it.';
      if (source === 'cache') return REUSED;
      return 'Done.';
    case 'reincarnate':
      if (source === 'precomputed') return PRECOMPUTED;
      if (source === 'generated') return 'The reincarnation finished. A new module was stored.';
      if (source === 'stored') return 'A reincarnation was already stored. Showing it.';
      if (source === 'cache') return REUSED;
      return 'Done.';
    case 'verify':
      if (source === 'executed') return 'The check finished. The stored result is shown below.';
      if (source === 'stored') return 'A result was already stored. Showing it.';
      if (source === 'precomputed') return PRECOMPUTED;
      return 'Done.';
  }
}
