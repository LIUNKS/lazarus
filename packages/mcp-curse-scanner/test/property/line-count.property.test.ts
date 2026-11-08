import fc from 'fast-check';
import { describe, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';

// Built from char codes so the file never holds a raw line separator.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const TERMINATOR = new RegExp(`\\r\\n|[\\n\\r${LS}${PS}]`, 'g');

const piece = fc.constantFrom(
  ' ', '\t', '\n', '\r', '\r\n', LS, PS, '/* a */', '/*\n*/', '/*\r\n*/', `/*${LS}*/`, '// c\n', '// d\r\n',
);

describe('line count', () => {
  it('R3.9 Line_Count is one more than the number of terminators, with CR LF counted once', () => {
    // Feature: 02-scanner-and-verifier, Property 4: Line_Count follows the terminator definition
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 60 }), fc.constantFrom('es3', 'es5-jquery', 'legacy-node' as const), (pieces, language) => {
        const source = pieces.join('');
        const expected = (source.match(TERMINATOR) ?? []).length + 1;
        const result = scanCurses(source, language);
        return result.ok && result.lineCount === expected && result.curses.length === 0;
      }),
      { numRuns: 200 },
    );
  });
});
