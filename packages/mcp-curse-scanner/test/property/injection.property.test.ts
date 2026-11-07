import fc from 'fast-check';
import { describe, it } from 'vitest';
import { scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

describe('injected curses', () => {
  it('R11.2 are found exactly where they were inserted, and nowhere else', () => {
    // Feature: 02-scanner-and-verifier, Property 9: Injected curses are found exactly where they were inserted
    fc.assert(
      fc.property(injectedProgram, (program) => {
        const result = scanCurses(program.source, 'es5-jquery');
        if (!result.ok) return false;
        const actual = result.curses.map(({ curseType, lineNumber, column }) => ({ curseType, lineNumber, column }));
        return JSON.stringify(actual) === JSON.stringify(program.expected);
      }),
      { numRuns: 200 },
    );
  });
});
