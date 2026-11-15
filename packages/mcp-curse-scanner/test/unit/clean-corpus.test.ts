import * as acorn from 'acorn';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { extractFunctionSignatures, scanCurses } from '../../src/lib.ts';
import { injectedProgram } from '../support/clean-corpus.ts';
import { INJECTABLE_SNIPPETS } from '../support/curse-corpus.ts';
import { measureTree } from '../support/depth-capability.ts';

function identifiers(source: string): string[] {
  const names: string[] = [];
  acorn.parse(source, {
    ecmaVersion: 5,
    onToken: (token) => {
      if (token.type === acorn.tokTypes.name) names.push(source.slice(token.start, token.end));
    },
  });
  return names;
}

describe('Clean_Corpus generators', () => {
  it('R18.6 no injectable snippet uses an identifier of the clean pools f<n>, p<n>, or m<n>', () => {
    for (const snippet of INJECTABLE_SNIPPETS) {
      for (const name of identifiers(snippet.source)) expect(name).not.toMatch(/^(f|p|m)[0-9]+$/);
    }
  });

  it('R18.6 every injectable snippet produces exactly its declared findings on its own', () => {
    for (const snippet of INJECTABLE_SNIPPETS) {
      const result = scanCurses(snippet.source, 'es5-jquery');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.curses.map((c) => ({ curseType: c.curseType, column: c.column }))).toEqual(snippet.expected);
      }
    }
  });

  it('R18.5 generated programs have 1 to 200 lines of at most 100 characters and a tree depth of at most 40', () => {
    const programs = fc.sample(injectedProgram, { numRuns: 1_000, seed: 42 });
    let deepest = 0;
    for (const program of programs) {
      expect(program.lines.length).toBeGreaterThanOrEqual(1);
      expect(program.lines.length).toBeLessThanOrEqual(200);
      for (const line of program.lines) expect(line.length).toBeLessThanOrEqual(100);
      deepest = Math.max(deepest, measureTree(acorn.parse(program.source, { ecmaVersion: 5 })).depth);
    }
    expect(deepest).toBeLessThanOrEqual(40);
  });

  it('R18.5 generated programs scan without an error', () => {
    for (const program of fc.sample(injectedProgram, { numRuns: 300, seed: 7 })) {
      expect(scanCurses(program.source, 'es5-jquery').ok).toBe(true);
      expect(extractFunctionSignatures(program.source, 'es5-jquery').ok).toBe(true);
    }
  });
});
