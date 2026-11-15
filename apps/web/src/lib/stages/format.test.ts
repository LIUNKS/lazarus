import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDuration, formatRetryAfter, formatRunCount } from './format';

describe('R16.3 formatRunCount', () => {
  it.each([
    [0, '0'],
    [100, '100'],
    [999, '999'],
    [1000, '1,000'],
    [12345, '12,345'],
    [1000000, '1,000,000'],
    [1234567, '1,234,567'],
    [Number.MAX_SAFE_INTEGER, '9,007,199,254,740,991'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatRunCount(value)).toBe(expected);
  });

  it('R6.2 puts a comma every three digits and never rounds or abbreviates', () => {
    // Feature: 06-resurrection-ui, Supporting check: run count formatting
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (value) => {
        const formatted = formatRunCount(value);
        const groups = formatted.split(',');
        const shapeOk = groups.every((group, index) => (index === 0 ? /^\d{1,3}$/.test(group) : /^\d{3}$/.test(group)));
        return shapeOk && formatted.replaceAll(',', '') === String(value);
      }),
      { numRuns: 300 },
    );
  });
});

describe('R6.3 formatDuration', () => {
  it.each([
    [0, '0 ms'],
    [842, '842 ms'],
    [1842, '1,842 ms'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatDuration(value)).toBe(expected);
  });
});

describe('R11.4 formatRetryAfter', () => {
  it.each([
    [1, '1 second'],
    [30, '30 seconds'],
    [59, '59 seconds'],
    [60, '1 minute'],
    [61, '2 minutes'],
    [3599, '60 minutes'],
    [3600, '1 hour'],
    [3601, '2 hours'],
    [7200, '2 hours'],
    [86400, '24 hours'],
  ])('formats %d seconds as %s', (seconds, expected) => {
    expect(formatRetryAfter(seconds)).toBe(expected);
  });

  it.each([0, -3, 0.2, Number.NaN, Number.POSITIVE_INFINITY])('shows %s as one second', (seconds) => {
    expect(formatRetryAfter(seconds)).toBe('1 second');
  });
});
