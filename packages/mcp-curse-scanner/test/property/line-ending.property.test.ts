import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

describe('line endings', () => {
  it('R11.9 replacing every LF by CR LF leaves every field unchanged', () => {
    // Feature: 02-scanner-and-verifier, Property 6: Line-ending invariance
    fc.assert(
      fc.property(injectedProgram, (program) => {
        const crlf = program.source.replaceAll('\n', '\r\n');
        return (
          JSON.stringify(scanCurses(crlf, 'es5-jquery')) === JSON.stringify(scanCurses(program.source, 'es5-jquery')) &&
          JSON.stringify(extractFunctionSignatures(crlf, 'es5-jquery')) ===
            JSON.stringify(extractFunctionSignatures(program.source, 'es5-jquery'))
        );
      }),
      { numRuns: 100 },
    );
  });
});
