// One accepted and one rejected example for each Request_Body case of Requirement 20 criterion 4.
// The route-level half (zero provider calls, zero writes) is asserted in routes/examples.test.ts.
import { describe, expect, it } from 'vitest';
import { ERROR_TABLE, errorResponse, type ErrorCode } from './errors';
import { preflight } from './preflight';

const APP_ORIGIN = 'https://lazarus.example';
const ID = '3f2b8c1e-6d4a-4f7b-9c21-0a5e8d7b1c34';
const encoder = new TextEncoder();

interface Options {
  origin?: string | null;
  contentType?: string | null;
  body?: string | Uint8Array;
}

function post({ origin = APP_ORIGIN, contentType = 'application/json', body = JSON.stringify({ corpseId: ID }) }: Options = {}): Request {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (contentType !== null) headers.set('content-type', contentType);
  // Bytes built here are always backed by a plain ArrayBuffer, which BodyInit requires.
  return new Request(`${APP_ORIGIN}/api/seance`, { method: 'POST', headers, body: body as BodyInit });
}

async function rejectedWith(request: Request, code: ErrorCode): Promise<void> {
  const result = await preflight(request, APP_ORIGIN);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
  const response = errorResponse(result.error);
  expect(response.status).toBe(ERROR_TABLE[code].status);
  expect((await response.json()) as unknown).toEqual({ ok: false, error: { code, message: ERROR_TABLE[code].message } });
}

const accepted = async (request: Request) => expect(await preflight(request, APP_ORIGIN)).toEqual({ ok: true, corpseId: ID });

describe('R20.4 Request_Body examples (Requirement 20)', () => {
  it('R3.5 accepts a body with only corpseId, and rejects a body without the key (Requirement 3)', async () => {
    await accepted(post());
    await rejectedWith(post({ body: '{}' }), 'INVALID_REQUEST');
  });

  it('R3.5 rejects a body with an extra key (Requirement 3)', async () => {
    await rejectedWith(post({ body: JSON.stringify({ corpseId: ID, extra: true }) }), 'INVALID_REQUEST');
  });

  it('R3.5 accepts an upper-case UUID, and rejects a value that is not a UUID (Requirement 3)', async () => {
    expect(await preflight(post({ body: JSON.stringify({ corpseId: ID.toUpperCase() }) }), APP_ORIGIN)).toEqual({ ok: true, corpseId: ID.toUpperCase() });
    await rejectedWith(post({ body: JSON.stringify({ corpseId: 'not-a-uuid' }) }), 'INVALID_REQUEST');
    await rejectedWith(post({ body: JSON.stringify({ corpseId: 42 }) }), 'INVALID_REQUEST');
  });

  it('R3.5 rejects a JSON array body, an empty body, invalid JSON, and invalid UTF-8 (Requirement 3)', async () => {
    await rejectedWith(post({ body: JSON.stringify([{ corpseId: ID }]) }), 'INVALID_REQUEST');
    await rejectedWith(post({ body: '' }), 'INVALID_REQUEST');
    await rejectedWith(post({ body: '{"corpseId":' }), 'INVALID_REQUEST');
    await rejectedWith(post({ body: Uint8Array.of(0x7b, 0xff, 0x7d) }), 'INVALID_REQUEST');
  });

  it('R3.4 accepts a body of exactly 1,024 bytes and rejects a body of 1,025 bytes (Requirement 3)', async () => {
    const base = JSON.stringify({ corpseId: ID });
    const exact = base + ' '.repeat(1024 - encoder.encode(base).length);
    expect(encoder.encode(exact).length).toBe(1024);
    await accepted(post({ body: exact }));
    await rejectedWith(post({ body: `${exact} ` }), 'REQUEST_TOO_LARGE');
  });

  it('R3.4 rejects without reading when Content-Length declares more than 1,024 bytes (Requirement 3)', async () => {
    const request = post();
    request.headers.set('content-length', '5000');
    await rejectedWith(request, 'REQUEST_TOO_LARGE');
  });

  it('R3.3 accepts content-type parameters and any letter case, and rejects another media type or none (Requirement 3)', async () => {
    await accepted(post({ contentType: 'Application/JSON; charset=utf-8' }));
    await rejectedWith(post({ contentType: 'text/plain' }), 'UNSUPPORTED_MEDIA_TYPE');
    await rejectedWith(post({ contentType: null, body: JSON.stringify({ corpseId: ID }) }), 'UNSUPPORTED_MEDIA_TYPE');
  });

  it('R3.2 rejects a missing Origin and a different Origin, and accepts the app origin (Requirement 3)', async () => {
    await accepted(post({ origin: APP_ORIGIN }));
    await rejectedWith(post({ origin: null }), 'FORBIDDEN_ORIGIN');
    await rejectedWith(post({ origin: 'https://evil.example' }), 'FORBIDDEN_ORIGIN');
  });

  it('R3.2 rejects every request when the app origin cannot be derived (Requirement 3)', async () => {
    const result = await preflight(post(), null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('R3.1 rejects a method other than POST before the other checks (Requirement 3)', async () => {
    const request = new Request(`${APP_ORIGIN}/api/seance`, { method: 'GET' });
    const result = await preflight(request, APP_ORIGIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('R3.10 reports only the first failing check when several fail (Requirement 3)', async () => {
    await rejectedWith(post({ origin: null, contentType: 'text/plain', body: 'x'.repeat(2000) }), 'FORBIDDEN_ORIGIN');
    await rejectedWith(post({ contentType: 'text/plain', body: 'x'.repeat(2000) }), 'UNSUPPORTED_MEDIA_TYPE');
    await rejectedWith(post({ body: 'x'.repeat(2000) }), 'REQUEST_TOO_LARGE');
  });
});
