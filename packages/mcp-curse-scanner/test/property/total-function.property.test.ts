import fc from 'fast-check';
import { describe, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';

const CODES = ['INVALID_INPUT', 'INPUT_TOO_LARGE', 'SYNTAX_ERROR', 'LIMIT_EXCEEDED', 'TIMEOUT'];
const MARKER = 'LzMarker9f3a7c1e';
const LANGUAGES = ['es3', 'es5-jquery', 'legacy-node'] as const;

const fragment = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom('\0', '\u2028', '\u2029', '\ud800', '\udc00', '#!/usr/bin/env node\n', 'var a;', 'function f() {}', MARKER),
  fc.integer({ min: 0, max: 600 }).map((n) => '('.repeat(n) + MARKER + ')'.repeat(n)),
  fc.integer({ min: 0, max: 600 }).map((n) => '['.repeat(n)),
  fc.integer({ min: 0, max: 600 }).map((n) => 'a(function(){'.repeat(n)),
);

const source = fc.oneof(
  fc.string({ maxLength: 10_000 }),
  fc.array(fragment, { maxLength: 30 }).map((parts) => parts.join('')),
);

function maxBracketNesting(text: string): number {
  let depth = 0;
  let max = 0;
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') max = Math.max(max, ++depth);
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
  }
  return max;
}

function isWellFormed(result: unknown): boolean {
  if (typeof result !== 'object' || result === null || result instanceof Promise) return false;
  const value = result as Record<string, unknown>;
  if (value.ok === true) return typeof value.lineCount === 'number' && ('curses' in value || 'functions' in value);
  return (
    value.ok === false &&
    typeof value.code === 'string' &&
    CODES.includes(value.code) &&
    typeof value.message === 'string' &&
    value.message.length <= 500 &&
    !('curses' in value) &&
    !('functions' in value) &&
    !value.message.includes(MARKER)
  );
}

describe('total function and error shape', () => {
  it('R12.5 never throws and returns a success value or a Scan_Error for any input', () => {
    // Feature: 02-scanner-and-verifier, Property 1: Total function and error shape
    fc.assert(
      fc.property(source, fc.constantFrom(...LANGUAGES), (text, language) => {
        const scan = scanCurses(text, language);
        const extract = extractFunctionSignatures(text, language);
        if (!isWellFormed(scan) || !isWellFormed(extract)) return false;
        // The two functions only have to agree far below the parser stack limit.
        if (!scan.ok && maxBracketNesting(text) <= 100) {
          return JSON.stringify(extract) === JSON.stringify(scan);
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('R3.8 any non-string source gives INVALID_INPUT', () => {
    // Feature: 02-scanner-and-verifier, Supporting check: Non-string source gives INVALID_INPUT
    fc.assert(
      fc.property(
        fc.anything().filter((value) => typeof value !== 'string'),
        fc.oneof(fc.constantFrom(...LANGUAGES), fc.anything()),
        (value, language) => {
          const scan = scanCurses(value as never, language as never);
          const extract = extractFunctionSignatures(value as never, language as never);
          return !scan.ok && scan.code === 'INVALID_INPUT' && !extract.ok && extract.code === 'INVALID_INPUT';
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R3.7 any language that is not one of the three names gives INVALID_INPUT', () => {
    // Feature: 02-scanner-and-verifier, Supporting check: Unknown language gives INVALID_INPUT
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }),
        fc.anything().filter((value) => !(LANGUAGES as readonly unknown[]).includes(value)),
        (text, language) => {
          const scan = scanCurses(text, language as never);
          return !scan.ok && scan.code === 'INVALID_INPUT';
        },
      ),
      { numRuns: 200 },
    );
  });
});
