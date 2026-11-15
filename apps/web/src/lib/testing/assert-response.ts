// A response check shared by the route tests (Requirement 20 criterion 8). Test-only.
// Every status and code must be in the closed list of Requirement 17 criterion 1, and no body may contain a sentinel
// (mock provider error text, mock SQL error text, the mock API key, or any part of a prompt).
import { expect } from 'vitest';
import { ERROR_CODES, ERROR_TABLE, type ErrorCode } from '@/lib/pipeline/errors';

export interface CheckedResponse {
  status: number;
  /** The parsed JSON body. */
  body: Record<string, unknown>;
  /** The raw body text, for further assertions. */
  text: string;
  headers: Headers;
}

export async function checkResponse(response: Response, sentinels: readonly string[] = []): Promise<CheckedResponse> {
  const text = await response.text();
  expect(response.headers.get('cache-control'), 'Cache-Control').toBe('private, no-store');
  expect(response.headers.get('content-type'), 'Content-Type').toBe('application/json; charset=utf-8');

  const parsed: unknown = JSON.parse(text);
  expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'the body is a JSON object').toBe(true);
  const body = parsed as Record<string, unknown>;

  if (response.status === 200) {
    expect(body['ok'], 'a 200 response has ok true').toBe(true);
  } else {
    expect(response.status, `status ${response.status} is in the closed list`).toBeGreaterThanOrEqual(400);
    expect(body['ok']).toBe(false);
    const error = body['error'] as { code?: string; message?: string } | undefined;
    expect((ERROR_CODES as readonly string[]).includes(String(error?.code)), `code ${String(error?.code)} is in the closed list`).toBe(true);
    expect(response.status, `status for ${String(error?.code)}`).toBe(ERROR_TABLE[error?.code as ErrorCode].status);
    expect(Object.keys(body).sort()).toEqual(['error', 'ok']);
    expect(Object.keys(error ?? {}).sort()).toEqual(['code', 'message']);
  }

  for (const sentinel of sentinels) {
    expect(text.includes(sentinel), `the body contains the sentinel ${sentinel.slice(0, 24)}`).toBe(false);
  }
  return { status: response.status, body, text, headers: response.headers };
}

export function errorCodeOf(checked: CheckedResponse): ErrorCode | null {
  const error = checked.body['error'] as { code?: ErrorCode } | undefined;
  return error?.code ?? null;
}
