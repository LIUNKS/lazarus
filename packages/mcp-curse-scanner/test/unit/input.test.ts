import { describe, expect, it } from 'vitest';
import { LIMITS, scanCurses } from '../../src/lib.ts';
import { checkInput } from '../../src/scanner/input.ts';

const padTo = (bytes: number): string => '//' + 'a'.repeat(bytes - 2);

describe('input validation', () => {
  it('R3.8 a non-string source gives INVALID_INPUT', () => {
    for (const value of [undefined, null, 1, true, {}, [], Symbol('s'), () => 'x']) {
      const result = checkInput(value, 'es3');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('R3.7 a language that is not exactly one of the three names gives INVALID_INPUT (case-sensitive)', () => {
    for (const value of ['ES3', 'es5', 'legacy_node', 'es5-jQuery', ' es3', '', undefined, null, 5]) {
      const result = checkInput('var a;', value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('R12.2 a source of exactly 1,048,576 bytes is accepted and one byte more is rejected', () => {
    expect(checkInput(padTo(LIMITS.sourceSizeBytes), 'es3').ok).toBe(true);
    const tooLarge = checkInput(padTo(LIMITS.sourceSizeBytes + 1), 'es3');
    expect(tooLarge.ok).toBe(false);
    if (!tooLarge.ok) expect(tooLarge.error.code).toBe('INPUT_TOO_LARGE');
  });

  it('R12.9 INVALID_INPUT takes precedence over INPUT_TOO_LARGE', () => {
    const result = scanCurses(padTo(LIMITS.sourceSizeBytes + 1), 'nope' as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('R12.9 INPUT_TOO_LARGE takes precedence over SYNTAX_ERROR', () => {
    const result = scanCurses('@' + 'a'.repeat(LIMITS.sourceSizeBytes), 'es3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INPUT_TOO_LARGE');
  });

  it('R12.2 a multi-byte character counts by its UTF-8 length', () => {
    // U+20AC is 3 bytes in UTF-8.
    const fits = '//' + '€'.repeat(Math.floor((LIMITS.sourceSizeBytes - 2) / 3));
    expect(checkInput(fits, 'es3').ok).toBe(true);
    expect(checkInput(fits + 'abc', 'es3').ok).toBe(false);
  });

  it('R12.5 error results carry no line, column, or list', () => {
    const result = scanCurses(1 as never, 'es3');
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT', message: expect.any(String) });
  });
});
