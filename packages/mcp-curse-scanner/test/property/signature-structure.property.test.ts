import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

// Independent function count from acorn-walk.
function countFunctions(source: string): number {
  let count = 0;
  walk.full(acorn.parse(source, { ecmaVersion: 5 }), (node) => {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') count++;
  });
  return count;
}

describe('function signature structure', () => {
  it('R13.1 lists exactly the functions of the source, each with a consistent shape', () => {
    // Feature: 02-scanner-and-verifier, Property 11: Function signature structure
    fc.assert(
      fc.property(injectedProgram, (program) => {
        const result = extractFunctionSignatures(program.source, 'es5-jquery');
        if (!result.ok || result.functions.length !== countFunctions(program.source)) return false;
        return result.functions.every(
          (fn) =>
            (fn.kind === 'declaration' || fn.kind === 'expression') &&
            (fn.name === null || typeof fn.name === 'string') &&
            Array.isArray(fn.params) &&
            fn.params.every((param) => typeof param === 'string') &&
            Number.isInteger(fn.nestingDepth) &&
            fn.nestingDepth >= 0 &&
            fn.pureCandidate === (fn.impurityMarkers.length === 0) &&
            new Set(fn.impurityMarkers).size === fn.impurityMarkers.length,
        );
      }),
      { numRuns: 150 },
    );
  });
});
