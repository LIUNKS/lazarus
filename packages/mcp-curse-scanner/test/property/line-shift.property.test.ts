import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

describe('line shift', () => {
  it('R11.8 prepending N LF characters shifts every line by N and changes nothing else', () => {
    // Feature: 02-scanner-and-verifier, Property 5: Line-shift invariance
    fc.assert(
      fc.property(injectedProgram, fc.integer({ min: 1, max: 1_000 }), (program, shift) => {
        const base = scanCurses(program.source, 'es5-jquery');
        const shifted = scanCurses('\n'.repeat(shift) + program.source, 'es5-jquery');
        if (!base.ok || !shifted.ok) return false;
        if (shifted.lineCount !== base.lineCount + shift) return false;
        const curses = base.curses.map((c) => ({ ...c, lineNumber: c.lineNumber + shift }));
        if (JSON.stringify(shifted.curses) !== JSON.stringify(curses)) return false;

        const baseFunctions = extractFunctionSignatures(program.source, 'es5-jquery');
        const shiftedFunctions = extractFunctionSignatures('\n'.repeat(shift) + program.source, 'es5-jquery');
        if (!baseFunctions.ok || !shiftedFunctions.ok) return false;
        const functions = baseFunctions.functions.map((f) => ({ ...f, startLine: f.startLine + shift, endLine: f.endLine + shift }));
        return JSON.stringify(shiftedFunctions.functions) === JSON.stringify(functions);
      }),
      { numRuns: 100 },
    );
  });
});
