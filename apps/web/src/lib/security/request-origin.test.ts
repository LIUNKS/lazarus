import { describe, expect, it } from 'vitest';
import { requestOrigin } from './request-origin';

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe('R6 requestOrigin', () => {
  it('uses http for localhost and https elsewhere', () => {
    expect(requestOrigin(headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(requestOrigin(headers({ host: 'lazarus.example' }))).toBe('https://lazarus.example');
  });

  it('prefers forwarded headers', () => {
    expect(requestOrigin(headers({ host: 'internal:3000', 'x-forwarded-host': 'lazarus.example', 'x-forwarded-proto': 'https' }))).toBe(
      'https://lazarus.example',
    );
  });

  it('uses only the first value of a comma-separated header', () => {
    expect(requestOrigin(headers({ 'x-forwarded-host': 'a.example, b.example', 'x-forwarded-proto': 'https, http' }))).toBe('https://a.example');
  });

  it.each(['evil.test/path', 'a b', 'host@evil', '', '-bad.example', 'a.example:99999999'])('rejects the host %j', (host) => {
    expect(requestOrigin(headers({ host }))).toBeNull();
  });

  it('returns null without a host', () => {
    expect(requestOrigin(headers({}))).toBeNull();
  });
});