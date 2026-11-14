// The five request checks that run before any database access (Requirement 3 criteria 1 to 5 and 10). Pure module.
// It reads only the method, the Origin and Content-Type headers, Content-Length, and the body.
// The query string and every other header are never read.
import { isUuid } from '@/lib/security/uuid';
import { PipelineError } from './errors';
import { LIMITS } from './limits';

export type PreflightResult = { ok: true; corpseId: string } | { ok: false; error: PipelineError };

const fail = (code: ConstructorParameters<typeof PipelineError>[0]): PreflightResult => ({
  ok: false,
  error: new PipelineError(code),
});

function mediaTypeOf(contentType: string | null): string | null {
  if (contentType === null) return null;
  return (contentType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Reads at most maxBodyBytes + 1 bytes. Returns null when the body is larger than maxBodyBytes. */
async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | null | 'unreadable'> {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return 'unreadable';
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseCorpseId(bytes: Uint8Array): string | null {
  let value: unknown;
  try {
    // fatal: invalid UTF-8 throws. ignoreBOM: a byte order mark stays in the text and makes the JSON invalid.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // Own property names, so a `__proto__` key created by JSON.parse counts as an extra key.
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length !== 1 || keys[0] !== 'corpseId') return null;
  const corpseId = (value as Record<string, unknown>)['corpseId'];
  return isUuid(corpseId) ? corpseId : null;
}

export async function preflight(
  request: Pick<Request, 'method' | 'headers' | 'body'>,
  appOrigin: string | null,
): Promise<PreflightResult> {
  // 1. Method. The Proxy answers first in production. This check keeps the function total.
  if (request.method !== 'POST') return fail('METHOD_NOT_ALLOWED');

  // 2. Origin: a string-for-string match with the origin of the app.
  const origin = request.headers.get('origin');
  if (origin === null || appOrigin === null || origin !== appOrigin) return fail('FORBIDDEN_ORIGIN');

  // 3. Media type, case-insensitive, parameters ignored.
  if (mediaTypeOf(request.headers.get('content-type')) !== 'application/json') return fail('UNSUPPORTED_MEDIA_TYPE');

  // 4. Body size, counted on raw bytes. A declared length over the limit is rejected without reading.
  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared.trim()) > LIMITS.maxBodyBytes) {
    return fail('REQUEST_TOO_LARGE');
  }
  const bytes = await readBounded(request.body, LIMITS.maxBodyBytes);
  if (bytes === null) return fail('REQUEST_TOO_LARGE');
  if (bytes === 'unreadable') return fail('INVALID_REQUEST');

  // 5. Body content.
  const corpseId = parseCorpseId(bytes);
  return corpseId === null ? fail('INVALID_REQUEST') : { ok: true, corpseId };
}
