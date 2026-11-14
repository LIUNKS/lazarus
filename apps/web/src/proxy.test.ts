import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_TABLE } from '@/lib/pipeline/errors';
import { proxy } from './proxy';

const PATHS = ['/api/scan', '/api/seance', '/api/reincarnate'];
const METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

afterEach(() => {
  vi.unstubAllEnvs();
});

const requestFor = (path: string, method: string) => new NextRequest(`https://lazarus.example${path}`, { method });

describe('R3.1 proxy method guard (Requirement 3)', () => {
  it.each(PATHS.flatMap((path) => METHODS.map((method) => [method, path] as const)))(
    'R3.1 answers %s %s with the 405 envelope and Allow: POST (Requirement 3)',
    async (method, path) => {
      // The public configuration is unset here, so this also proves that the guard runs before the configuration check.
      const response = await proxy(requestFor(path, method));
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST');
      expect(response.headers.get('Cache-Control')).toBe('private, no-store');
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(await response.json()).toEqual({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: ERROR_TABLE.METHOD_NOT_ALLOWED.message } });
    },
  );

  it('R3.1 gives the same answer when the public configuration is valid (Requirement 3)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'public-anon-key');
    const response = await proxy(requestFor('/api/seance', 'GET'));
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('R3.1 lets a POST fall through to the existing behavior, which here is the configuration page (Requirement 3)', async () => {
    const response = await proxy(requestFor('/api/seance', 'POST'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Allow')).toBeNull();
  });

  it('R3.1 does not guard other paths, so a GET of the home page is untouched (Requirement 3)', async () => {
    const response = await proxy(requestFor('/', 'GET'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Allow')).toBeNull();
    const other = await proxy(requestFor('/api/other', 'GET'));
    expect(other.headers.get('Allow')).toBeNull();
  });
});
