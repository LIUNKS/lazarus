import { describe, expect, it } from 'vitest';
import { formatDateUtc, pluralize } from './format';

describe('R9 formatting', () => {
  it('formats in UTC regardless of the offset in the input', () => {
    expect(formatDateUtc('2026-03-04T23:30:00-05:00')).toBe('2026-03-05');
    expect(formatDateUtc('2026-03-04T00:00:00+00:00')).toBe('2026-03-04');
  });

  it('returns a dash for an invalid date', () => {
    expect(formatDateUtc('not a date')).toBe('—');
  });

  it('pluralizes', () => {
    expect(pluralize(1, 'curse')).toBe('1 curse');
    expect(pluralize(0, 'curse')).toBe('0 curses');
    expect(pluralize(4, 'curse')).toBe('4 curses');
  });
});