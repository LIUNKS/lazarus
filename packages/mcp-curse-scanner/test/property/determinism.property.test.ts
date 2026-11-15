import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';

const ORDER = ['GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION', 'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'];
const FINDING_KEYS = ['curseType', 'severity', 'lineNumber', 'column', 'description', 'exorcismStrategy'];
const SIGNATURE_KEYS = ['name', 'kind', 'params', 'startLine', 'startColumn', 'endLine', 'nestingDepth', 'pureCandidate', 'impurityMarkers'];
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((key, i) => key === b[i]);

describe('determinism, ordering, and serialization shape', () => {
  it('R11.1 results are byte-identical, ordered, unique, and serialized in the fixed property order', () => {
    // Feature: 02-scanner-and-verifier, Property 2: Determinism, ordering, uniqueness, and serialization shape
    // Programs have 1 to 200 lines and a tree depth of at most 40, so none is a Stack_Limit_Source.
    fc.assert(
      fc.property(injectedProgram, fc.constantFrom('es3', 'es5-jquery', 'legacy-node' as const), (program, language) => {
        const first = scanCurses(program.source, language);
        if (JSON.stringify(first) !== JSON.stringify(scanCurses(program.source, language))) return false;
        const functions = extractFunctionSignatures(program.source, language);
        if (JSON.stringify(functions) !== JSON.stringify(extractFunctionSignatures(program.source, language))) return false;
        if (!first.ok || !functions.ok) return false;
        if (!same(Object.keys(first), ['ok', 'sourceLanguage', 'lineCount', 'curses'])) return false;
        if (!same(Object.keys(functions), ['ok', 'sourceLanguage', 'lineCount', 'functions'])) return false;

        const seen = new Set<string>();
        for (let i = 0; i < first.curses.length; i++) {
          const finding = first.curses[i]!;
          if (!same(Object.keys(finding), FINDING_KEYS)) return false;
          const key = `${finding.curseType}:${finding.lineNumber}:${finding.column}`;
          if (seen.has(key)) return false;
          seen.add(key);
          const previous = first.curses[i - 1];
          if (previous) {
            const order =
              previous.lineNumber - finding.lineNumber ||
              previous.column - finding.column ||
              ORDER.indexOf(previous.curseType) - ORDER.indexOf(finding.curseType);
            if (order > 0) return false;
          }
        }
        for (let i = 0; i < functions.functions.length; i++) {
          const fn = functions.functions[i]!;
          if (!same(Object.keys(fn), SIGNATURE_KEYS)) return false;
          const previous = functions.functions[i - 1];
          if (previous && (previous.startLine - fn.startLine || previous.startColumn - fn.startColumn) > 0) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});
