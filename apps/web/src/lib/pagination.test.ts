import { describe, expect, it } from 'vitest';
import { pageCount, parsePage } from './pagination';

describe('R12 pagination', () => {
  it.each([
    ['3', 3],
    ['1', 1],
    [undefined, 1],
    ['0', 1],
    ['-2', 1],
    ['abc', 1],
    ['2.5', 1],
    ['1e3', 1],
    ['9999999', 1],
    ['', 1],
  ] as const)('parses %j as %i', (value, expected) => {
    expect(parsePage(value)).toBe(expected);
  });

  it('counts pages with a minimum of one', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(100, 50)).toBe(2);
  });
});