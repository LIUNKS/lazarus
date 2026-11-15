import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { cleanProgram } from '../support/clean-corpus.ts';

describe('clean programs', () => {
  it('R4.5 programs without any curse have no findings and no impurity markers', () => {
    // Feature: 02-scanner-and-verifier, Property 8: Clean programs have no findings and no impurity markers
    fc.assert(
      fc.property(cleanProgram, fc.constantFrom('es3', 'es5-jquery', 'legacy-node' as const), (program, language) => {
        const source = program.lines.join('\n');
        const curses = scanCurses(source, language);
        const functions = extractFunctionSignatures(source, language);
        return (
          curses.ok &&
          curses.curses.length === 0 &&
          functions.ok &&
          functions.functions.every((fn) => fn.pureCandidate && fn.impurityMarkers.length === 0)
        );
      }),
      { numRuns: 200 },
    );
  });
});
