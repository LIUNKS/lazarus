import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures } from '../../src/lib.ts';
import type { ImpurityMarker } from '../../src/lib.ts';
import { cleanProgram } from '../support/clean-corpus.ts';

interface Injection {
  /** Lines placed before the target function (declarations outside it). */
  before: string[];
  statement: string;
  /** The exact marker list of the target function, in the fixed marker order. */
  markers: ImpurityMarker[];
}

const INJECTIONS: Injection[] = [
  { before: [], statement: 'zzCounter = 1;', markers: ['GLOBAL_WRITE'] },
  { before: [], statement: 'zzCounter++;', markers: ['GLOBAL_WRITE'] },
  { before: [], statement: 'window.zzCache = 1;', markers: ['GLOBAL_WRITE', 'ENVIRONMENT_API'] },
  { before: ['var zzOuter;'], statement: 'zzOuter = 1;', markers: ['OUTER_SCOPE_WRITE'] },
  { before: ['var zzOuter;'], statement: 'zzOuter++;', markers: ['OUTER_SCOPE_WRITE'] },
  { before: [], statement: 'zzHandle(new Date());', markers: ['NONDETERMINISTIC_API'] },
  { before: [], statement: 'zzHandle(Math.random());', markers: ['NONDETERMINISTIC_API'] },
  { before: [], statement: 'zzHandle(setTimeout);', markers: ['TIMER_API'] },
  { before: [], statement: 'zzHandle(setInterval);', markers: ['TIMER_API'] },
  { before: [], statement: 'zzHandle(console);', markers: ['ENVIRONMENT_API'] },
  { before: [], statement: 'zzHandle(document);', markers: ['ENVIRONMENT_API'] },
  { before: [], statement: 'eval(zzCode);', markers: ['DYNAMIC_CODE'] },
];

describe('impurity markers', () => {
  it('R13.7 are present exactly for the statement injected into a function', () => {
    // Feature: 02-scanner-and-verifier, Property 12: Impurity markers follow the injected statement
    fc.assert(
      fc.property(cleanProgram, fc.constantFrom(...INJECTIONS), (program, injection) => {
        const lines = [...program.lines, ...injection.before, 'function zzTarget(p0, p1) {', `  ${injection.statement}`, '}'];
        const result = extractFunctionSignatures(lines.join('\n'), 'es5-jquery');
        if (!result.ok) return false;
        const target = result.functions.find((fn) => fn.name === 'zzTarget');
        const others = result.functions.filter((fn) => fn.name !== 'zzTarget');
        return (
          target !== undefined &&
          JSON.stringify(target.impurityMarkers) === JSON.stringify(injection.markers) &&
          others.every((fn) => fn.impurityMarkers.length === 0)
        );
      }),
      { numRuns: 200 },
    );
  });
});
