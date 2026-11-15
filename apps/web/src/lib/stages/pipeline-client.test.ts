import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PIPELINE_ERROR_CODES, presentFailure } from './errors';
import { formatRetryAfter } from './format';
import {
  CLIENT_TIMEOUT_MS,
  PIPELINE_PATHS,
  RESULT_SOURCES,
  VERIFY_CLIENT_TIMEOUT_MS,
  clientTimeoutFor,
  parseOutcome,
  parseRetryAfter,
  runPipeline,
  type PipelineOutcome,
  type PipelineRoute,
} from './pipeline-client';

const ROUTES = Object.keys(PIPELINE_PATHS) as PipelineRoute[];
const CORPSE_ID = '3f6c1b2e-7a4d-4e8b-9c15-2d0a8b6f4e73';
const KNOWN_FAILURES = [...PIPELINE_ERROR_CODES, 'NETWORK', 'CLIENT_TIMEOUT', 'UNKNOWN'] as string[];

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('R9.1 R9.2 route constants', () => {
  it('uses the four fixed paths', () => {
    expect(PIPELINE_PATHS).toEqual({
      scan: '/api/scan',
      seance: '/api/seance',
      reincarnate: '/api/reincarnate',
      verify: '/api/verify',
    });
  });

  it('R9.4 R18.5 waits 110,000 ms for the model routes and 70,000 ms for the verification route', () => {
    expect(CLIENT_TIMEOUT_MS).toBe(110_000);
    expect(VERIFY_CLIENT_TIMEOUT_MS).toBe(70_000);
    expect(clientTimeoutFor('scan')).toBe(110_000);
    expect(clientTimeoutFor('seance')).toBe(110_000);
    expect(clientTimeoutFor('reincarnate')).toBe(110_000);
    expect(clientTimeoutFor('verify')).toBe(70_000);
  });
});

describe('R9.6 R9.7 R11.2 R11.3 parseOutcome', () => {
  it('never throws, accepts only a source of its route, and never exposes server text', () => {
    // Feature: 06-resurrection-ui, Property 5: Outcome parsing is total and does not echo
    const sentinel = fc.string({ minLength: 6, maxLength: 24 }).map((text) => `SENTINEL<${text}>`);
    fc.assert(
      fc.property(
        fc.constantFrom(...ROUTES),
        fc.integer({ min: 100, max: 599 }),
        fc.option(fc.string({ maxLength: 12 }), { nil: null }),
        fc.jsonValue(),
        sentinel,
        fc.constantFrom(...PIPELINE_ERROR_CODES, 'NOT_A_CODE'),
        (route, status, header, body, leak, code) => {
          // Arbitrary JSON, and an error envelope that carries a server message the UI must never show.
          const arbitrary = parseOutcome(route, status, header, body);
          const envelope = parseOutcome(route, status, header, { ok: false, error: { code, message: leak }, message: leak });
          for (const outcome of [arbitrary, envelope]) {
            if (outcome.kind === 'success') {
              const ok = typeof body === 'object' && body !== null && !Array.isArray(body) && (body as Record<string, unknown>)['ok'] === true;
              if (!ok || status !== 200 || !(RESULT_SOURCES[route] as readonly string[]).includes(outcome.source)) return false;
            } else {
              if (!KNOWN_FAILURES.includes(outcome.failure)) return false;
              if (JSON.stringify(presentFailure(outcome, route)).includes('SENTINEL<')) return false;
            }
            if (JSON.stringify(outcome).includes('SENTINEL<')) return false;
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reads status 200 with ok true and a source of the route as a success', () => {
    expect(parseOutcome('seance', 200, null, { ok: true, source: 'cache', extra: 1 })).toEqual({ kind: 'success', source: 'cache' });
  });

  it.each([
    ['status other than 200', 201, { ok: true, source: 'generated' }],
    ['a missing source', 200, { ok: true }],
    ['an unknown source', 200, { ok: true, source: 'magic' }],
    ['a numeric source', 200, { ok: true, source: 1 }],
    ['ok as the text "true"', 200, { ok: 'true', source: 'generated' }],
    ['an error envelope without a code', 400, { ok: false, error: {} }],
    ['an error envelope with a code that is not in the list', 400, { ok: false, error: { code: 'TELEPORT_FAILED' } }],
    ['an error code of the wrong type', 400, { ok: false, error: { code: 5 } }],
    ['a body that is null', 200, null],
    ['a body that is an array', 200, [{ ok: true, source: 'stored' }]],
    ['a body that is text', 500, 'Internal Server Error'],
  ])('R9.6 reads %s as UNKNOWN', (_label, status, body) => {
    expect(parseOutcome('scan', status, null, body)).toEqual({ kind: 'failure', failure: 'UNKNOWN', status, retryAfterSeconds: null });
  });

  it('R11.1 reads every code of the closed list from an error envelope and keeps the HTTP status', () => {
    for (const code of PIPELINE_ERROR_CODES) {
      expect(parseOutcome('scan', 418, null, { ok: false, error: { code } })).toEqual({
        kind: 'failure',
        failure: code,
        status: 418,
        retryAfterSeconds: null,
      });
    }
  });

  it('R11.3 does not read the message field of an error response', () => {
    const outcome = parseOutcome('scan', 500, null, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'stack trace at db.ts:10' } });
    expect(JSON.stringify(outcome)).not.toContain('stack trace');
  });
});

describe('R11.4 Retry-After', () => {
  it.each([
    ['missing', null, null],
    ['0', '0', null],
    ['-5', '-5', null],
    ['abc', 'abc', null],
    ['1', '1', 1],
    ['59', '59', 59],
    ['60', '60', 60],
    ['3600', '3600', 3600],
    ['86400', '86400', 86400],
    ['86401', '86401', null],
    ['padded text', ' 5 ', null],
    ['a decimal', '1.5', null],
    ['an exponent', '1e3', null],
    ['an empty text', '', null],
  ])('R16.5 reads the header %s as %s seconds', (_label, header, expected) => {
    expect(parseRetryAfter(header)).toBe(expected);
  });

  it.each(['RATE_LIMITED', 'VERIFICATION_BUSY'] as const)('R16.5 reads the header examples for %s through parseOutcome', (code) => {
    const read = (header: string | null) => {
      const outcome = parseOutcome('seance', 429, header, { ok: false, error: { code } });
      return outcome.kind === 'failure' ? outcome.retryAfterSeconds : 'not a failure';
    };
    expect([null, '0', '-5', 'abc', '1', '59', '60', '3600', '86400', '86401'].map(read)).toEqual([
      null,
      null,
      null,
      null,
      1,
      59,
      60,
      3600,
      86400,
      null,
    ]);
  });

  it('ignores the header for every code that does not wait', () => {
    for (const code of PIPELINE_ERROR_CODES.filter((item) => item !== 'RATE_LIMITED' && item !== 'VERIFICATION_BUSY')) {
      const outcome = parseOutcome('scan', 503, '30', { ok: false, error: { code } });
      expect(outcome).toMatchObject({ kind: 'failure', retryAfterSeconds: null });
    }
  });

  it('reads an integer from 1 to 86,400 as itself and every other input as null, and states a wait that is not shorter', () => {
    // Feature: 06-resurrection-ui, Property 6: Retry-after
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 86_400 }), (seconds) => {
        if (parseRetryAfter(String(seconds)) !== seconds) return false;
        const stated = formatRetryAfter(seconds).match(/^(\d+) (second|minute|hour)s?$/);
        if (stated === null) return false;
        const unit = { second: 1, minute: 60, hour: 3600 }[stated[2] as 'second' | 'minute' | 'hour'];
        const total = Number(stated[1]) * unit;
        // At least the wait, and less than the wait plus one unit of the granularity that was used.
        return total >= seconds && total < seconds + unit;
      }),
      { numRuns: 300 },
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -1_000_000, max: 0 }).map(String),
          fc.integer({ min: 86_401, max: 10_000_000 }).map(String),
          fc.string({ maxLength: 10 }).filter((text) => !/^[0-9]+$/.test(text)),
        ),
        (header) => parseRetryAfter(header) === null,
      ),
      { numRuns: 300 },
    );
  });
});

describe('R9.1 R9.4 R9.6 runPipeline', () => {
  it('sends one POST with a JSON body that holds only the corpse id', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return json(200, { ok: true, source: 'generated' });
    }) as unknown as typeof fetch;
    const outcome = await runPipeline({ fetch: fakeFetch }, 'seance', CORPSE_ID);
    expect(outcome).toEqual({ kind: 'success', source: 'generated' });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/seance');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.credentials).toBe('same-origin');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe(`{"corpseId":"${CORPSE_ID}"}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads a failure with its status and its Retry-After header', async () => {
    const fakeFetch = (async () => json(429, { ok: false, error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '120' })) as unknown as typeof fetch;
    expect(await runPipeline({ fetch: fakeFetch }, 'reincarnate', CORPSE_ID)).toEqual({
      kind: 'failure',
      failure: 'RATE_LIMITED',
      status: 429,
      retryAfterSeconds: 120,
    });
  });

  it('gives NETWORK when fetch rejects, and also when it throws before returning a promise', async () => {
    const rejecting = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const throwing = (() => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    for (const fakeFetch of [rejecting, throwing]) {
      expect(await runPipeline({ fetch: fakeFetch }, 'scan', CORPSE_ID)).toEqual({
        kind: 'failure',
        failure: 'NETWORK',
        status: null,
        retryAfterSeconds: null,
      });
    }
  });

  it('gives UNKNOWN for a response that is not JSON, and keeps the status', async () => {
    const fakeFetch = (async () => new Response('<html>Bad gateway</html>', { status: 502 })) as unknown as typeof fetch;
    expect(await runPipeline({ fetch: fakeFetch }, 'scan', CORPSE_ID)).toEqual({
      kind: 'failure',
      failure: 'UNKNOWN',
      status: 502,
      retryAfterSeconds: null,
    });
  });

  const hangsUntilAborted = (async (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;

  it('R9.4 aborts the request and gives CLIENT_TIMEOUT when no response arrives in time', async () => {
    const outcome = await runPipeline({ fetch: hangsUntilAborted, timeoutMs: 20 }, 'scan', CORPSE_ID);
    expect(outcome).toEqual({ kind: 'failure', failure: 'CLIENT_TIMEOUT', status: null, retryAfterSeconds: null });
  });

  it('R9.5 gives NETWORK, not CLIENT_TIMEOUT, when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = runPipeline({ fetch: hangsUntilAborted, timeoutMs: 5_000 }, 'scan', CORPSE_ID, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'failure', failure: 'NETWORK' });
  });

  it('R9.5 sends nothing when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return json(200, { ok: true, source: 'stored' });
    }) as unknown as typeof fetch;
    const outcome = await runPipeline({ fetch: counting, timeoutMs: 5_000 }, 'scan', CORPSE_ID, controller.signal);
    expect(outcome).toMatchObject({ kind: 'failure', failure: 'NETWORK' });
    expect(calls).toBe(0);
  });

  it('R9.6 never throws, whatever the response', async () => {
    // Feature: 06-resurrection-ui, Property 5: Outcome parsing is total and does not echo
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...ROUTES), fc.integer({ min: 200, max: 599 }), fc.jsonValue(), async (route, status, body) => {
        const fakeFetch = (async () => new Response(JSON.stringify(body), { status: status === 204 || status === 205 || status === 304 ? 200 : status })) as unknown as typeof fetch;
        const outcome: PipelineOutcome = await runPipeline({ fetch: fakeFetch }, route, CORPSE_ID);
        return outcome.kind === 'success' || KNOWN_FAILURES.includes(outcome.failure);
      }),
      { numRuns: 100 },
    );
  });
});
