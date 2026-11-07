import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

const BASE = 'https://app.example';

describe('R13 safeRedirectPath', () => {
  it.each(['/', '/crypt', '/corpses/abc?x=1', '/import#top', '/sign-in?next=%2Fcrypt'])('accepts %s', (value) => {
    expect(safeRedirectPath(value)).toBe(value);
  });

  it.each([
    ['protocol-relative', '//evil.test'],
    ['slash-backslash', '/\\evil.test'],
    ['absolute URL', 'https://evil.test'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['newline', '/ok\n/evil'],
    ['carriage return', '/ok\r'],
    ['tab', '/ok\t'],
    ['NUL', '/ok\u0000'],
    ['DEL', '/ok\u007f'],
    ['backslash inside', '/a\\b'],
    ['empty', ''],
    ['no leading slash', 'crypt'],
    ['too long', `/${'a'.repeat(512)}`],
  ])('rejects %s', (_label, value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ['/crypt']])('rejects the non-string %j', (value) => {
    expect(safeRedirectPath(value)).toBeNull();
  });

  it('accepts a path of exactly 512 characters', () => {
    const value = `/${'a'.repeat(511)}`;
    expect(safeRedirectPath(value)).toBe(value);
  });

  it('only returns values that start with a single slash and stay on the same origin', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: 'binary' }), fc.constantFrom('//x', '/\\x', '/%5Cx', '/.//x')), (input) => {
        const result = safeRedirectPath(input);
        if (result === null) return;
        expect(result.startsWith('/')).toBe(true);
        expect(result.startsWith('//')).toBe(false);
        expect(new URL(result, BASE).origin).toBe(BASE);
      }),
      { numRuns: 1000 },
    );
  });
});