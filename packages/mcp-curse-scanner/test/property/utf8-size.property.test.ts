import fc from 'fast-check';
import { describe, it } from 'vitest';
import { LIMITS } from '../../src/lib.ts';
import { checkInput } from '../../src/scanner/input.ts';

// A manual UTF-8 byte count that counts every lone surrogate as 3 bytes (U+FFFD).
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

describe('UTF-8 size rule', () => {
  it('R12.2 accepts a source if and only if its UTF-8 size is at most 1,048,576 bytes', () => {
    // Feature: 02-scanner-and-verifier, Property 7: UTF-8 size rule
    const unit = fc.oneof(
      fc.constant('a'),
      fc.constant('\u00e9'),
      fc.constant('€'),
      fc.constant('\u{1F600}'),
      fc.constant('\ud800'),
      fc.constant('\udc00'),
    );
    fc.assert(
      fc.property(unit, fc.integer({ min: 0, max: 1 }), fc.integer({ min: -6, max: 6 }), (piece, _flag, delta) => {
        const size = utf8Length(piece);
        const count = Math.max(0, Math.floor(LIMITS.sourceSizeBytes / size) + delta);
        const source = '//' + piece.repeat(count);
        const expected = utf8Length(source) <= LIMITS.sourceSizeBytes;
        return checkInput(source, 'es3').ok === expected;
      }),
      { numRuns: 100 },
    );
  });
});
