import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResponse } from '@/lib/testing/assert-response';
import { bodyFor, buildHarness, OWNED_ID, requestFor } from '@/lib/testing/harness';
import { ERROR_CODES, ERROR_TABLE, errorResponse, jsonResponse, PipelineError, QuotaUnavailable, RATE_LIMITED_GLOBAL_MESSAGE, StoreError, type ErrorCode } from './errors';
import { containsForbiddenPhrase } from './forbidden';
import { runPipelineRoute } from './run-route';

const STATUS: Record<ErrorCode, number> = {
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

const codes = fc.constantFrom(...ERROR_CODES);
const anyNumber = fc.oneof(fc.integer({ min: -1_000_000, max: 10_000_000 }), fc.double({ noNaN: false }), fc.constantFrom(0, 1, 86_400, 86_401, Number.POSITIVE_INFINITY, Number.NaN));
const details = fc.record(
  { retryAfterSeconds: anyNumber, deniedBy: fc.constantFrom('user' as const, 'global' as const), line: fc.integer({ min: -5, max: 100_000 }), column: fc.integer({ min: -5, max: 100_000 }), safeDetail: fc.string({ maxLength: 20 }) },
  { requiredKeys: [] },
);

describe('R17 error envelope and table (Requirements 3, 8, and 17)', () => {
  it('R17.1 R17.2 R17.3 builds the envelope with the listed status, exactly two body keys, and a clean fixed message for any detail (Requirement 17)', async () => {
    // Feature: 05-llm-pipeline-api, Property 2: Envelope and error-table invariants
    await fc.assert(
      fc.asyncProperty(codes, details, async (code, detail) => {
        const response = errorResponse(new PipelineError(code, detail));
        const text = await response.text();
        const body = JSON.parse(text) as { ok: boolean; error: { code: string; message: string } };

        expect(response.status).toBe(STATUS[code]);
        expect(Object.keys(body)).toEqual(['ok', 'error']);
        expect(body.ok).toBe(false);
        expect(Object.keys(body.error)).toEqual(['code', 'message']);
        expect(body.error.code).toBe(code);

        const message = body.error.message;
        expect(message).toMatch(/^[\x20-\x7E]{1,200}$/);
        expect(containsForbiddenPhrase(message)).toBe(false);
        // The scan position (two integers) is the one legitimate number in a message, and is checked exactly below.
        const withoutPosition = message.replace(/ at line \d+, column \d+\./, '.');
        expect(withoutPosition).not.toMatch(/\n|\bat\s+\S+\s*\(|[A-Za-z]:\\|\/[\w.-]+\.(?:ts|js|mjs)\b|\b\d{2}[0-9A-Z]{3}\b|SQL|stack|Error:/i);

        // The message is fixed per code. Only the limit name and the scan position vary, and nothing else does.
        if (code === 'RATE_LIMITED') {
          expect(message).toBe(detail.deniedBy === 'global' ? RATE_LIMITED_GLOBAL_MESSAGE : ERROR_TABLE.RATE_LIMITED.message);
        } else if (code === 'SOURCE_SYNTAX_ERROR' || code === 'SOURCE_NOT_SCANNABLE') {
          const position = /^(.*?)(?: at line (\d+), column (\d+))?\.$/.exec(message);
          expect(position?.[1]).toBe(ERROR_TABLE[code].message);
          const valid = Number.isSafeInteger(detail.line) && Number.isSafeInteger(detail.column) && detail.line! >= 0 && detail.column! >= 0;
          if (valid) expect(position?.slice(2)).toEqual([String(detail.line), String(detail.column)]);
          else expect(position?.[2]).toBeUndefined();
        } else {
          expect(message).toBe(ERROR_TABLE[code].message);
        }
        // The text of safeDetail is for the log only.
        if (detail.safeDetail) expect(text.includes(detail.safeDetail) && detail.safeDetail.length > 3).toBe(ERROR_TABLE[code].message.includes(detail.safeDetail) && detail.safeDetail.length > 3);
      }),
      { numRuns: 200 },
    );
  });

  it('R3.8 R8.5 sets the two headers on every response, and Retry-After only on 429 as an integer from 1 to 86,400 (Requirement 3 and 8)', () => {
    // Feature: 05-llm-pipeline-api, Property 2: Envelope and error-table invariants
    fc.assert(
      fc.property(codes, details, (code, detail) => {
        const response = errorResponse(new PipelineError(code, detail));
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
        const retry = response.headers.get('Retry-After');
        if (code === 'RATE_LIMITED') {
          expect(retry).toMatch(/^\d+$/);
          expect(Number(retry)).toBeGreaterThanOrEqual(1);
          expect(Number(retry)).toBeLessThanOrEqual(86_400);
        } else expect(retry).toBeNull();
        expect(response.headers.get('Allow')).toBe(code === 'METHOD_NOT_ALLOWED' ? 'POST' : null);
      }),
      { numRuns: 200 },
    );
  });

  it('R3.8 jsonResponse keeps the two required headers even when the caller passes its own Content-Type or Cache-Control (Requirement 3)', () => {
    const response = jsonResponse(200, { ok: true }, { 'Content-Type': 'text/html', 'Cache-Control': 'public' });
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('R17.3 holds one fixed message per code, with a table that has every code once (Requirement 17)', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) {
      const messages = new Set([0, 1, 2].map(() => ERROR_TABLE[code].message));
      expect(messages.size).toBe(1);
    }
  });
});

describe('R17.4 unexpected failures (Requirement 17)', () => {
  const thrown: Array<[string, () => unknown]> = [
    ['an Error with a sentinel message', () => new Error('sentinel-thrown-message-7f3a')],
    ['a TypeError', () => new TypeError('sentinel-thrown-message-7f3a')],
    ['a string', () => 'sentinel-thrown-message-7f3a'],
    ['an object', () => ({ message: 'sentinel-thrown-message-7f3a', stack: 'at sentinel-stack-7f3a (file.ts:1:1)' })],
    ['null', () => null],
    ['undefined', () => undefined],
    ['a number', () => 42],
    ['a StoreError', () => new StoreError('42501')],
    ['a QuotaUnavailable', () => new QuotaUnavailable('sentinel-quota-detail-7f3a')],
  ];

  it.each(thrown)('R17.4 turns %s into the INTERNAL_ERROR envelope without rethrowing, and logs one safe line (Requirement 17)', async (_label, make) => {
    const h = buildHarness();
    const response = await runPipelineRoute({
      route: 'seance',
      request: requestFor('seance', bodyFor(OWNED_ID)),
      deps: h.deps,
      handle: async () => {
        throw make();
      },
    });
    const result = await checkResponse(response, ['sentinel-thrown-message-7f3a', 'sentinel-stack-7f3a', 'sentinel-quota-detail-7f3a']);
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: ERROR_TABLE.INTERNAL_ERROR.message } });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]).toMatchObject({ event: 'pipeline_error', route: 'seance', code: 'INTERNAL_ERROR', corpseId: OWNED_ID });
    expect(JSON.stringify(h.logs)).not.toContain('sentinel-thrown-message');
  });

  it('R17.4 any thrown value, generated at random, yields INTERNAL_ERROR (Requirement 17)', async () => {
    // Feature: 05-llm-pipeline-api, Property 2: Envelope and error-table invariants
    await fc.assert(
      fc.asyncProperty(fc.anything(), async (value) => {
        const h = buildHarness();
        const response = await runPipelineRoute({
          route: 'scan',
          request: requestFor('scan', bodyFor(OWNED_ID)),
          deps: h.deps,
          handle: async () => {
            throw value;
          },
        });
        expect(response.status).toBe(500);
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe('INTERNAL_ERROR');
      }),
      { numRuns: 100 },
    );
  });

  it('R17.4 a logger that throws does not change the response (Requirement 17)', async () => {
    const h = buildHarness();
    h.deps.log = () => {
      throw new Error('logger down');
    };
    const response = await runPipelineRoute({
      route: 'scan',
      request: requestFor('scan', bodyFor(OWNED_ID)),
      deps: h.deps,
      handle: async () => {
        throw new PipelineError('NOT_FOUND');
      },
    });
    expect(response.status).toBe(404);
  });
});
