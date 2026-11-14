import { isUtf8 } from 'node:buffer';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ErrorCode } from './errors';
import { preflight } from './preflight';

const APP_ORIGIN = 'https://lazarus.example';
const UUID_ORACLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

// Oracle written independently of the implementation: node:buffer's UTF-8 validator and plain JSON.parse.
function oracleCorpseId(bytes: Uint8Array): string | null {
  if (!isUtf8(bytes)) return null;
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== 'corpseId') return null;
  const id = (value as { corpseId: unknown }).corpseId;
  return typeof id === 'string' && UUID_ORACLE.test(id) ? id : null;
}

function oracle(input: Scenario): { ok: true; corpseId: string } | { ok: false; code: ErrorCode } {
  if (input.method !== 'POST') return { ok: false, code: 'METHOD_NOT_ALLOWED' };
  if (input.appOrigin === null || input.origin !== input.appOrigin) return { ok: false, code: 'FORBIDDEN_ORIGIN' };
  const media = (input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (input.contentType === undefined || media !== 'application/json') return { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' };
  if (input.body.length > 1024) return { ok: false, code: 'REQUEST_TOO_LARGE' };
  const corpseId = oracleCorpseId(input.body);
  return corpseId === null ? { ok: false, code: 'INVALID_REQUEST' } : { ok: true, corpseId };
}

interface Scenario {
  method: string;
  appOrigin: string | null;
  origin: string | undefined;
  contentType: string | undefined;
  body: Uint8Array;
  query: string;
  extraHeader: string | undefined;
}

function makeRequest(input: Scenario): Request {
  const headers = new Headers();
  if (input.origin !== undefined) headers.set('origin', input.origin);
  if (input.contentType !== undefined) headers.set('content-type', input.contentType);
  if (input.extraHeader !== undefined) headers.set('x-extra', input.extraHeader);
  const hasBody = input.method !== 'GET' && input.method !== 'HEAD';
  return new Request(`${APP_ORIGIN}/api/seance${input.query}`, {
    method: input.method,
    headers,
    // Bytes built here are always backed by a plain ArrayBuffer, which BodyInit requires.
    ...(hasBody ? { body: input.body as BodyInit } : {}),
  });
}

const uuid = fc.uuid().chain((value) => fc.constantFrom(value, value.toUpperCase()));
const padTo = (text: string, size: number) => text + ' '.repeat(Math.max(0, size - encoder.encode(text).length));

const bodies: fc.Arbitrary<Uint8Array> = fc.oneof(
  { weight: 4, arbitrary: uuid.map((id) => encoder.encode(JSON.stringify({ corpseId: id }))) },
  // Valid bodies padded to sizes around the 1,024-byte limit.
  { weight: 3, arbitrary: fc.tuple(uuid, fc.integer({ min: 1018, max: 1030 })).map(([id, size]) => encoder.encode(padTo(JSON.stringify({ corpseId: id }), size))) },
  { weight: 1, arbitrary: uuid.map((id) => encoder.encode(JSON.stringify({ corpseId: id, extra: 1 }))) },
  { weight: 1, arbitrary: uuid.map((id) => encoder.encode(JSON.stringify([{ corpseId: id }]))) },
  { weight: 1, arbitrary: uuid.map((id) => encoder.encode(`\uFEFF${JSON.stringify({ corpseId: id })}`)) },
  { weight: 1, arbitrary: uuid.map((id) => encoder.encode(`{"__proto__":1,"corpseId":"${id}"}`)) },
  { weight: 1, arbitrary: fc.string({ maxLength: 60 }).map((text) => encoder.encode(JSON.stringify({ corpseId: text }))) },
  { weight: 1, arbitrary: fc.uint8Array({ maxLength: 80 }) },
  { weight: 1, arbitrary: fc.constant(new Uint8Array(0)) },
  { weight: 1, arbitrary: fc.constant(Uint8Array.of(0x7b, 0xff, 0xfe, 0x7d)) },
);

const scenarios: fc.Arbitrary<Scenario> = fc.record({
  method: fc.oneof({ weight: 6, arbitrary: fc.constant('POST') }, { weight: 3, arbitrary: fc.constantFrom('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS') }),
  appOrigin: fc.oneof({ weight: 9, arbitrary: fc.constant<string | null>(APP_ORIGIN) }, { weight: 1, arbitrary: fc.constant<string | null>(null) }),
  origin: fc.oneof(
    { weight: 6, arbitrary: fc.constant<string | undefined>(APP_ORIGIN) },
    { weight: 1, arbitrary: fc.constant<string | undefined>(undefined) },
    { weight: 2, arbitrary: fc.constantFrom<string | undefined>('https://evil.example', 'http://lazarus.example', `${APP_ORIGIN}/`, 'HTTPS://LAZARUS.EXAMPLE', 'null') },
  ),
  contentType: fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom<string | undefined>('application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'Application/Json;charset=UTF-8') },
    { weight: 1, arbitrary: fc.constant<string | undefined>(undefined) },
    { weight: 2, arbitrary: fc.constantFrom<string | undefined>('text/plain', 'application/jsonx', 'application/x-www-form-urlencoded', 'json', 'multipart/form-data; boundary=x') },
  ),
  body: bodies,
  query: fc.constantFrom('', '?corpseId=ignored', '?a=1&b=2', '?model=other'),
  extraHeader: fc.option(fc.constantFrom('1', 'value', 'groq'), { nil: undefined }),
});

describe('R3 preflight decision (Requirement 3)', () => {
  it('R3.10 returns the first failing check, and ok only when every check passes (Requirements 3 and 7)', async () => {
    // Feature: 05-llm-pipeline-api, Property 1: Preflight decision
    await fc.assert(
      fc.asyncProperty(scenarios, async (input) => {
        const request = makeRequest(input);
        const expected = oracle(input);
        const result = await preflight(request, input.appOrigin);
        if (expected.ok) {
          expect(result).toEqual({ ok: true, corpseId: expected.corpseId });
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe(expected.code);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('R3.5 R20.4 every accepted body is a JSON object with exactly the key corpseId holding a UUID (Requirements 3 and 20)', async () => {
    // Feature: 05-llm-pipeline-api, Property 1: Preflight decision
    await fc.assert(
      fc.asyncProperty(bodies, async (body) => {
        const input: Scenario = { method: 'POST', appOrigin: APP_ORIGIN, origin: APP_ORIGIN, contentType: 'application/json', body, query: '', extraHeader: undefined };
        const result = await preflight(makeRequest(input), APP_ORIGIN);
        if (!result.ok) return;
        const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
        expect(Object.keys(parsed as object)).toEqual(['corpseId']);
        expect(UUID_ORACLE.test(result.corpseId)).toBe(true);
        expect(body.length).toBeLessThanOrEqual(1024);
      }),
      { numRuns: 200 },
    );
  });

  it('R3.9 ignores the query string and extra headers when the checks pass (Requirement 3)', async () => {
    // Feature: 05-llm-pipeline-api, Supporting check: query string and headers do not matter
    const id = '3f2b8c1e-6d4a-4f7b-9c21-0a5e8d7b1c34';
    const body = encoder.encode(JSON.stringify({ corpseId: id }));
    for (const query of ['', '?corpseId=other', '?model=x&runs=9']) {
      const input: Scenario = { method: 'POST', appOrigin: APP_ORIGIN, origin: APP_ORIGIN, contentType: 'application/json', body, query, extraHeader: query === '' ? undefined : 'x' };
      expect(await preflight(makeRequest(input), APP_ORIGIN)).toEqual({ ok: true, corpseId: id });
    }
  });
});
