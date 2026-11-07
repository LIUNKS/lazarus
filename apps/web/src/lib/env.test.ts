import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validatePublicConfig } from './env';

const KEY = 'sb-anon-key-value';

describe('R2 Public_Config validation', () => {
  it('accepts an https URL with a key', () => {
    const result = validatePublicConfig({ url: 'https://abc.supabase.co', anonKey: KEY });
    expect(result).toEqual({ ok: true, config: { supabaseUrl: 'https://abc.supabase.co', supabaseAnonKey: KEY } });
  });

  it.each(['http://localhost:54321', 'http://127.0.0.1:54321'])('accepts the local http URL %s', (url) => {
    expect(validatePublicConfig({ url, anonKey: KEY }).ok).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('reports a %s URL as missing', (_label, url) => {
    const result = validatePublicConfig({ url, anonKey: KEY });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'missing' }] });
  });

  it.each(['not a url', 'ftp://abc.supabase.co', 'http://abc.supabase.co', 'https://', 'javascript:alert(1)'])(
    'reports the URL %s as invalid',
    (url) => {
      const result = validatePublicConfig({ url, anonKey: KEY });
      expect(result).toEqual({ ok: false, problems: [{ variable: 'NEXT_PUBLIC_SUPABASE_URL', reason: 'invalid' }] });
    },
  );

  it.each([undefined, '', '  '])('reports a missing anon key (%j)', (anonKey) => {
    const result = validatePublicConfig({ url: 'https://abc.supabase.co', anonKey });
    expect(result).toEqual({ ok: false, problems: [{ variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', reason: 'missing' }] });
  });

  it('reports both variables when both are missing', () => {
    const result = validatePublicConfig({ url: undefined, anonKey: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.map((p) => p.variable)).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  });

  it('never puts a supplied value into the problems', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 4 }), fc.string({ minLength: 4 }), (url, anonKey) => {
        const result = validatePublicConfig({ url, anonKey });
        if (result.ok) return;
        const text = JSON.stringify(result.problems);
        // A value can only appear if the problem text contains it; problems hold names and reasons only.
        expect(Object.keys(result.problems[0] ?? {}).sort()).toEqual(['reason', 'variable']);
        for (const value of [url.trim(), anonKey.trim()]) {
          if (value.length >= 4 && !/^(missing|invalid|NEXT_PUBLIC_[A-Z_]+)$/.test(value)) {
            expect(text.includes(value)).toBe(false);
          }
        }
      }),
    );
  });
});