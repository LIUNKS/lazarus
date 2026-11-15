// The browser side of the Pipeline_API: the fixed paths, the accepted result sources per route, the defensive parsing of
// a response, and one call function with an injected `fetch`. Pure module: no framework imports, no process.env, and it
// never reads the text of a server message. `runPipeline` and `parseOutcome` never throw.
import { PIPELINE_ERROR_CODES, type FailureKind, type PipelineErrorCode } from './errors';

/** The route paths are constants. They are never built from stored or user-supplied data. */
export const PIPELINE_PATHS = {
  scan: '/api/scan',
  seance: '/api/seance',
  reincarnate: '/api/reincarnate',
  verify: '/api/verify',
} as const;

export type PipelineRoute = keyof typeof PIPELINE_PATHS;

/** Scan, séance, and reincarnation: longer than the 100 s request deadline of 05-llm-pipeline-api. */
export const CLIENT_TIMEOUT_MS = 110_000;
/** Verification: longer than the 60 s server deadline fixed by 08-live-verification-api. */
export const VERIFY_CLIENT_TIMEOUT_MS = 70_000;

export function clientTimeoutFor(route: PipelineRoute): number {
  return route === 'verify' ? VERIFY_CLIENT_TIMEOUT_MS : CLIENT_TIMEOUT_MS;
}

/** `verify` accepts `executed` where the other routes accept `generated` and `cache`. */
export const RESULT_SOURCES = {
  scan: ['precomputed', 'stored', 'cache', 'generated'],
  seance: ['precomputed', 'stored', 'cache', 'generated'],
  reincarnate: ['precomputed', 'stored', 'cache', 'generated'],
  verify: ['precomputed', 'stored', 'executed'],
} as const satisfies Record<PipelineRoute, readonly string[]>;

export type ResultSource = (typeof RESULT_SOURCES)[PipelineRoute][number];

export function isResultSource(route: PipelineRoute, value: unknown): value is ResultSource {
  return typeof value === 'string' && (RESULT_SOURCES[route] as readonly string[]).includes(value);
}

export type PipelineOutcome =
  | { kind: 'success'; source: ResultSource }
  | { kind: 'failure'; failure: FailureKind; status: number | null; retryAfterSeconds: number | null };

/** The longest wait the UI honors: 24 hours. */
const MAX_RETRY_AFTER_SECONDS = 86_400;

/** An integer number of seconds from 1 to 86,400 in its plain form, otherwise null. */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^[1-9][0-9]*$/.test(header)) return null;
  const seconds = Number(header);
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null;
}

const WAIT_CODES: readonly PipelineErrorCode[] = ['RATE_LIMITED', 'VERIFICATION_BUSY'];

function isErrorCode(value: unknown): value is PipelineErrorCode {
  return typeof value === 'string' && (PIPELINE_ERROR_CODES as readonly string[]).includes(value);
}

function failure(kind: FailureKind, status: number | null, retryAfterSeconds: number | null = null): PipelineOutcome {
  return { kind: 'failure', failure: kind, status, retryAfterSeconds };
}

/**
 * Turns one response into an outcome. A success needs status 200, `ok: true`, and a `source` accepted for the route. An
 * error needs `ok: false` and a code from the closed list. Everything else is `UNKNOWN`. Only `ok`, `source`, and
 * `error.code` are read: the other fields of the body, including a `message` and the extra objects of a `verify`
 * success, are ignored. `Retry-After` is read only for `RATE_LIMITED` and `VERIFICATION_BUSY`.
 */
export function parseOutcome(
  route: PipelineRoute,
  status: number,
  retryAfterHeader: string | null,
  body: unknown,
): PipelineOutcome {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return failure('UNKNOWN', status);
  const record = body as Record<string, unknown>;
  if (record['ok'] === true) {
    const source = record['source'];
    return status === 200 && isResultSource(route, source) ? { kind: 'success', source } : failure('UNKNOWN', status);
  }
  if (record['ok'] === false) {
    const error = record['error'];
    const code = typeof error === 'object' && error !== null ? (error as Record<string, unknown>)['code'] : undefined;
    if (isErrorCode(code)) return failure(code, status, WAIT_CODES.includes(code) ? parseRetryAfter(retryAfterHeader) : null);
  }
  return failure('UNKNOWN', status);
}

export interface PipelineDeps {
  fetch: typeof fetch;
  /** Replaces the timeout of the route. It exists for tests only. */
  timeoutMs?: number;
}

/**
 * Sends `{ "corpseId": "<uuid>" }` to the route and returns the outcome. A network error gives `NETWORK`, the timer gives
 * `CLIENT_TIMEOUT`, and an abort by the caller (the component unmounted) gives `NETWORK`, which the caller ignores.
 */
export async function runPipeline(
  deps: PipelineDeps,
  route: PipelineRoute,
  corpseId: string,
  signal?: AbortSignal,
): Promise<PipelineOutcome> {
  // The component already unmounted: send nothing.
  if (signal?.aborted === true) return failure('NETWORK', null);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? clientTimeoutFor(route));
  const abortFromCaller = (): void => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await deps.fetch(PIPELINE_PATHS[route], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ corpseId }),
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // A body that is not JSON is parsed as `UNKNOWN`. An abort while reading it is reported as a network failure.
      if (controller.signal.aborted) throw new Error('aborted');
    }
    return parseOutcome(route, response.status, response.headers.get('Retry-After'), body);
  } catch {
    return failure(timedOut ? 'CLIENT_TIMEOUT' : 'NETWORK', null);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
