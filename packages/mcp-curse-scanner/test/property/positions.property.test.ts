import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

describe('positions', () => {
  it('R11.7 every line is in 1..lineCount and every column is at least 1', () => {
    // Feature: 02-scanner-and-verifier, Property 3: Positions stay in range
    fc.assert(
      fc.property(injectedProgram, (program) => {
        const curses = scanCurses(program.source, 'es5-jquery');
        const functions = extractFunctionSignatures(program.source, 'es5-jquery');
        if (!curses.ok || !functions.ok) return false;
        const inRange = (value: number, max: number): boolean => Number.isInteger(value) && value >= 1 && value <= max;
        const column = (value: number): boolean => Number.isInteger(value) && value >= 1;
        return (
          curses.curses.every((c) => inRange(c.lineNumber, curses.lineCount) && column(c.column)) &&
          functions.functions.every(
            (f) =>
              inRange(f.startLine, functions.lineCount) &&
              inRange(f.endLine, functions.lineCount) &&
              f.endLine >= f.startLine &&
              column(f.startColumn),
          )
        );
      }),
      { numRuns: 150 },
    );
  });
});
