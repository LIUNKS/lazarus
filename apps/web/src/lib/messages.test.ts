import { describe, expect, it } from 'vitest';
import { authErrorMessage, firstParam, noticeMessage } from './messages';

describe('R6 fixed messages', () => {
  it('maps known codes to fixed text', () => {
    expect(authErrorMessage('callback')).toContain('Sign-in could not be completed');
    expect(noticeMessage('already-imported')).toContain('already imported');
  });

  it.each([undefined, '', 'unknown', '__proto__', 'constructor', '<script>alert(1)</script>'])('selects nothing for %j', (code) => {
    expect(authErrorMessage(code)).toBeNull();
    expect(noticeMessage(code)).toBeNull();
  });

  it('takes the first value of a repeated parameter', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam('a')).toBe('a');
    expect(firstParam(undefined)).toBeUndefined();
  });
});