import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { containsForbiddenPhrase, FORBIDDEN_PHRASES } from './forbidden';

// Independent oracle: the pattern is written out here, not taken from the implementation.
const ORACLE = /100%|mathematical proof|mathematically proven|guaranteed/i;

type Tree = string | number | boolean | null | Tree[] | { [key: string]: Tree };

const safeString = fc.string({ maxLength: 40 }).filter((text) => !ORACLE.test(text));

const tree: fc.Arbitrary<Tree> = fc.letrec<{ node: Tree }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    safeString,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('node'), { maxLength: 4 }),
    fc.dictionary(fc.string({ maxLength: 8 }), tie('node'), { maxKeys: 4 }),
  ),
})).node;

function stringsIn(node: Tree): string[] {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(stringsIn);
  if (node !== null && typeof node === 'object') return Object.values(node).flatMap(stringsIn);
  return [];
}

function recase(text: string, mask: boolean[]): string {
  return [...text].map((char, index) => (mask[index % mask.length] ? char.toUpperCase() : char.toLowerCase())).join('');
}

describe('R19.2 Forbidden_Phrase detector (Requirement 19)', () => {
  it('R19.2 returns true when any string holds a phrase and false otherwise, for nested values', () => {
    // Feature: 05-llm-pipeline-api, Property 14: Forbidden phrase detector
    fc.assert(
      fc.property(tree, (value) => {
        const expected = stringsIn(value).some((text) => ORACLE.test(text));
        expect(containsForbiddenPhrase(value)).toBe(expected);
        expect(expected).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('R10.5 R13.9 R19.6 detects each phrase in any letter case at any position, as in the rejection of Forbidden_Phrases (Requirement 10, 13, 19)', () => {
    // Feature: 05-llm-pipeline-api, Property 14: Forbidden phrase detector
    fc.assert(
      fc.property(
        tree,
        fc.constantFrom(...FORBIDDEN_PHRASES),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        safeString,
        safeString,
        fc.constantFrom('array', 'object', 'nested', 'plain'),
        (base, phrase, mask, prefix, suffix, container) => {
          const inserted = `${prefix}${recase(phrase, mask)}${suffix}`;
          const value: Tree =
            container === 'array'
              ? [base, inserted]
              : container === 'object'
                ? { first: base, second: inserted }
                : container === 'nested'
                  ? { list: [base, { deep: [inserted] }] }
                  : inserted;
          expect(containsForbiddenPhrase(value)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R19.6 returns false for near misses of the phrases (Requirement 19)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: near misses
    for (const text of ['100 %', '100', 'proof', 'a proof of work', 'mathematical  proof', 'guarantee', 'guarante ed', 'proven']) {
      expect(containsForbiddenPhrase(text), text).toBe(false);
    }
  });

  it('R19.6 never throws for cycles, null, numbers, symbols, functions, or exotic objects (Requirement 19)', () => {
    // Feature: 05-llm-pipeline-api, Supporting check: robustness
    const cyclic: Record<string, unknown> = { name: 'plain' };
    cyclic['self'] = cyclic;
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    for (const value of [cyclic, null, undefined, 7, Symbol('x'), () => 1, new Date(), new Map([['a', 'guaranteed']]), throwing]) {
      expect(() => containsForbiddenPhrase(value)).not.toThrow();
    }
    expect(containsForbiddenPhrase(cyclic)).toBe(false);
  });
});
