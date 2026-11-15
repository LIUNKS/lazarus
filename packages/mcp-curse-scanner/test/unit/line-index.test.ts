import * as acorn from 'acorn';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createLineIndex } from '../../src/scanner/line-index.ts';

describe('line index', () => {
  it('R3.3 an empty source has a line count of 1', () => {
    expect(createLineIndex('').lineCount).toBe(1);
    expect(createLineIndex('var a;').lineCount).toBe(1);
  });

  it('R3.3 counts LF, CR, CR LF (once), U+2028, and U+2029 as terminators', () => {
    expect(createLineIndex('a\nb').lineCount).toBe(2);
    expect(createLineIndex('a\rb').lineCount).toBe(2);
    expect(createLineIndex('a\r\nb').lineCount).toBe(2);
    expect(createLineIndex('a\u2028b').lineCount).toBe(2);
    expect(createLineIndex('a\u2029b').lineCount).toBe(2);
    expect(createLineIndex('a\n\r\n\n').lineCount).toBe(4);
  });

  it('R11.7 a tab counts as one column unit', () => {
    expect(createLineIndex('\tx').position(1)).toEqual({ line: 1, column: 2 });
  });

  it('R11.7 an astral character counts as two column units', () => {
    // U+1F600 is a surrogate pair, so `x` sits at UTF-16 offset 2.
    expect(createLineIndex('\u{1F600}x').position(2)).toEqual({ line: 1, column: 3 });
  });

  it('R11.7 CR LF counts once for the line number', () => {
    const index = createLineIndex('a\r\nb');
    expect(index.position(3)).toEqual({ line: 2, column: 1 });
  });

  it('R13.5 positions are 1-based on the first line and after every terminator', () => {
    const index = createLineIndex('ab\ncd');
    expect(index.position(0)).toEqual({ line: 1, column: 1 });
    expect(index.position(2)).toEqual({ line: 1, column: 3 });
    expect(index.position(3)).toEqual({ line: 2, column: 1 });
  });

  it('R11.9 agrees with acorn locations for sources with all five terminators', () => {
    // Feature: 02-scanner-and-verifier, Supporting check: Line index agrees with acorn locations
    const terminator = fc.constantFrom('\n', '\r', '\r\n', '\u2028', '\u2029');
    const piece = fc.oneof(fc.constantFrom('a;', 'bb;', '1;', '\t', ' ', '/*x*/'), terminator);
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 40 }), (pieces) => {
        const source = pieces.join('') + ';';
        const index = createLineIndex(source);
        const tokens: { start: number; line: number; column: number }[] = [];
        acorn.parse(source, {
          ecmaVersion: 5,
          locations: true,
          onToken: (token) => {
            const loc = token.loc!.start;
            tokens.push({ start: token.start, line: loc.line, column: loc.column + 1 });
          },
        });
        return tokens.every((token) => {
          const position = index.position(token.start);
          return position.line === token.line && position.column === token.column;
        });
      }),
      { numRuns: 100 },
    );
  });
});
